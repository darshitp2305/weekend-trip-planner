/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const destinations = require("../data/destinations.json");

const DATA_FILE = path.join(__dirname, "..", "data", "destinations.json");
const OUTPUT_DIR = path.join(
  __dirname,
  "..",
  "public",
  "destinations",
  "theme"
);
const CACHE_DIR = path.join(os.tmpdir(), "trippify-destination-image-cache");
const TARGET_WIDTH = 1600;
const TARGET_HEIGHT = 900;
const DOWNLOAD_DELAY_MS = 900;
const RETRY_DELAYS_MS = [5000, 10000, 20000, 30000];
const REQUEST_HEADERS = {
  "User-Agent": "TrippifyImageRefresh/1.0 (+local-dev)",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};
const CROP_POSITION_OVERRIDES = {
  crowsnest_pass_ab: "north",
};
const DEFAULT_LIGHT_TREATMENT = {
  brightness: 1.06,
  saturation: 1.01,
  gamma: 1,
  linearA: 1,
  linearB: 0,
};
const LIGHT_TREATMENT_OVERRIDES = {
  banff_ab: {
    brightness: 1.03,
    saturation: 1,
    gamma: 1,
    linearA: 1,
    linearB: 0,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSourceUrl(destination) {
  return (
    destination.image_source_url ||
    destination.image_url ||
    destination.image_url_light ||
    destination.image_url_dark ||
    ""
  ).trim();
}

function getOutputPath(destinationId, variant) {
  return path.join(OUTPUT_DIR, `${destinationId}-${variant}.webp`);
}

function getPublicPath(destinationId, variant) {
  return `/destinations/theme/${destinationId}-${variant}.webp`;
}

function getCachePath(url) {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  return path.join(CACHE_DIR, `${hash}.bin`);
}

function isWikimediaUrl(url) {
  return /(?:commons|upload)\.wikimedia\.org/i.test(url);
}

function getWikimediaFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const rawFileName = pathname.split("/").pop();
    return rawFileName ? decodeURIComponent(rawFileName) : null;
  } catch {
    return null;
  }
}

function buildWikimediaProxyUrl(url) {
  const fileName = getWikimediaFilename(url);
  const normalizedUrl = fileName
    ? `commons.wikimedia.org/wiki/Special:FilePath/${fileName}`
    : url.replace(/^https?:\/\//i, "");
  return `https://wsrv.nl/?url=${encodeURIComponent(
    normalizedUrl
  )}&w=${TARGET_WIDTH}&output=jpg`;
}

function getDownloadCandidates(url) {
  if (isWikimediaUrl(url)) {
    return [buildWikimediaProxyUrl(url), url];
  }

  return [url];
}

async function readCachedFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function fetchImageBuffer(url, destinationName) {
  const candidates = getDownloadCandidates(url);

  for (const candidateUrl of candidates) {
    const cachePath = getCachePath(candidateUrl);
    const cached = await readCachedFile(cachePath);

    if (cached) {
      return cached;
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const response = await fetch(candidateUrl, {
        headers: REQUEST_HEADERS,
        redirect: "follow",
      });

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(cachePath, buffer);
        return buffer;
      }

      if (response.status < 500 && response.status !== 429) {
        break;
      }

      if (attempt === RETRY_DELAYS_MS.length) {
        break;
      }

      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new Error(`${destinationName}: retry limit reached`);
}

function getCropPosition(destinationId) {
  return CROP_POSITION_OVERRIDES[destinationId] ?? sharp.strategy.attention;
}

function getLightTreatment(destinationId) {
  return {
    ...DEFAULT_LIGHT_TREATMENT,
    ...(LIGHT_TREATMENT_OVERRIDES[destinationId] ?? {}),
  };
}

function buildBasePipeline(buffer, destinationId) {
  return sharp(buffer)
    .rotate()
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: "cover",
      position: getCropPosition(destinationId),
    });
}

async function buildLightVariant(buffer, destinationId) {
  const treatment = getLightTreatment(destinationId);
  return buildBasePipeline(buffer, destinationId)
    .modulate({
      brightness: treatment.brightness,
      saturation: treatment.saturation,
    })
    .gamma(treatment.gamma)
    .linear(treatment.linearA, treatment.linearB)
    .webp({ quality: 84 })
    .toBuffer();
}

async function buildDarkVariant(buffer, destinationId) {
  return buildBasePipeline(buffer, destinationId)
    .modulate({
      brightness: 0.9,
      saturation: 1.03,
    })
    .composite([
      {
        input: {
          create: {
            width: TARGET_WIDTH,
            height: TARGET_HEIGHT,
            channels: 4,
            background: {
              r: 7,
              g: 13,
              b: 24,
              alpha: 0.16,
            },
          },
        },
        blend: "over",
      },
    ])
    .gamma(1.04)
    .webp({ quality: 84 })
    .toBuffer();
}

async function refreshDestination(destination) {
  const sourceUrl = getSourceUrl(destination);

  if (!sourceUrl) {
    throw new Error(`${destination.name}: missing source image URL`);
  }

  const buffer = await fetchImageBuffer(sourceUrl, destination.name);
  const lightBuffer = await buildLightVariant(buffer, destination.id);
  const darkBuffer = await buildDarkVariant(buffer, destination.id);

  await fs.writeFile(getOutputPath(destination.id, "light"), lightBuffer);
  await fs.writeFile(getOutputPath(destination.id, "dark"), darkBuffer);

  return {
    ...destination,
    image_url_light: getPublicPath(destination.id, "light"),
    image_url_dark: getPublicPath(destination.id, "dark"),
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const nextDestinations = [];

  for (const destination of destinations) {
    nextDestinations.push(await refreshDestination(destination));
    await sleep(DOWNLOAD_DELAY_MS);
  }

  await fs.writeFile(DATA_FILE, `${JSON.stringify(nextDestinations, null, 2)}\n`);

  console.log(`Refreshed ${nextDestinations.length} destination image pairs.`);
  console.log(`Assets written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
