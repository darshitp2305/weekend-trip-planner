/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const albertaDestinations = require("../data/destinations.json");
const canadaDestinations = require("../data/destinations-canada.json");
const canadaExpandedDestinations = require("../data/destinations-canada-expanded.json");

const ALBERTA_DATA_FILE = path.join(__dirname, "..", "data", "destinations.json");
const CANADA_DATA_FILE = path.join(
  __dirname,
  "..",
  "data",
  "destinations-canada.json"
);
const CANADA_EXPANDED_DATA_FILE = path.join(
  __dirname,
  "..",
  "data",
  "destinations-canada-expanded.json"
);
const destinations = [
  ...albertaDestinations,
  ...canadaDestinations,
  ...canadaExpandedDestinations,
];
const canadaDestinationIds = new Set(canadaDestinations.map((destination) => destination.id));
const canadaExpandedDestinationIds = new Set(
  canadaExpandedDestinations.map((destination) => destination.id)
);
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
const FORCE_GENERATED_THEME_REFRESH =
  process.env.FORCE_GENERATED_THEME_REFRESH === "1";
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

function isExternalUrl(value) {
  return /^https?:\/\//i.test((value ?? "").trim());
}

function escapeSvg(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createSeededRandom(seed) {
  const hash = crypto.createHash("sha1").update(seed).digest();
  let state = hash.readUInt32BE(0) || 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getSignalText(destination) {
  return [
    destination.name,
    destination.region,
    destination.home_base_city,
    ...(destination.vibes ?? []),
    ...((destination.anchor_experiences ?? []).map((item) => item.title)),
    ...((destination.anchor_experiences ?? []).map((item) => item.type)),
    ...((destination.anchor_experiences ?? []).map((item) => item.description ?? "")),
    ...((destination.neighborhoods ?? []).map((item) => item.name)),
    ...((destination.neighborhoods ?? []).map((item) => item.reason)),
  ]
    .join(" ")
    .toLowerCase();
}

function hasAnySignal(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function getSceneProfile(destination) {
  const text = getSignalText(destination);

  const north = hasAnySignal(text, [
    /\bwhitehorse\b/,
    /\byellowknife\b/,
    /\biqaluit\b/,
    /\bkluane\b/,
    /\bnorth\b/,
    /\barctic\b/,
    /\baurora\b/,
  ]);
  const desert = hasAnySignal(text, [
    /\bbadlands\b/,
    /\bhoodoo\b/,
    /\bcanyon\b/,
    /\bwriting on stone\b/,
    /\bcypress hills\b/,
    /\bdrumheller\b/,
  ]);
  const coast = hasAnySignal(text, [
    /\bcoast\b/,
    /\bocean\b/,
    /\bwaterfront\b/,
    /\bharbour\b/,
    /\bharbor\b/,
    /\bisland\b/,
    /\bbay\b/,
    /\bbeach\b/,
    /\bferry\b/,
    /\bcabot\b/,
    /\bhalifax\b/,
    /\bst john\b/,
    /\bcharlottetown\b/,
    /\bfundy\b/,
    /\bvancouver island\b/,
    /\bvictoria\b/,
  ]);
  const lake = hasAnySignal(text, [
    /\blake\b/,
    /\briver\b/,
    /\bfalls\b/,
    /\bwater\b/,
    /\bokanagan\b/,
    /\bmuskoka\b/,
    /\bprince edward county\b/,
    /\bniagara\b/,
  ]);
  const mountain = hasAnySignal(text, [
    /\bmountain\b/,
    /\bsummit\b/,
    /\balpine\b/,
    /\bpeak\b/,
    /\bridge\b/,
    /\bgondola\b/,
    /\bwhistler\b/,
    /\bbanff\b/,
    /\bjasper\b/,
    /\bgros morne\b/,
    /\bprince george\b/,
    /\bkluane\b/,
  ]);
  const city = destination.is_staycation || hasAnySignal(text, [
    /\bcity\b/,
    /\bdowntown\b/,
    /\bculture\b/,
    /\bmuseum\b/,
    /\bnightlife\b/,
    /\bstaycation\b/,
    /\btoronto\b/,
    /\bmontreal\b/,
    /\bottawa\b/,
    /\bquebec city\b/,
    /\bwinnipeg\b/,
    /\bsaskatoon\b/,
    /\bregina\b/,
    /\bcalgary\b/,
    /\bedmonton\b/,
  ]);
  const prairie = hasAnySignal(text, [
    /\bprairie\b/,
    /\bgrassland\b/,
    /\bfields\b/,
    /\bregina\b/,
    /\bsaskatoon\b/,
    /\bwinnipeg\b/,
    /\bcharlottetown\b/,
  ]);
  const forest = hasAnySignal(text, [
    /\bforest\b/,
    /\bpark\b/,
    /\btrail\b/,
    /\bhike\b/,
    /\btrees\b/,
    /\briding mountain\b/,
    /\bprince albert\b/,
    /\bvancouver island\b/,
    /\bwhistler\b/,
  ]);

  let primary = "forest";
  if (north) primary = "north";
  else if (desert) primary = "desert";
  else if (coast && city) primary = "coastal-city";
  else if (coast) primary = "coast";
  else if (mountain) primary = "mountain";
  else if (lake) primary = "lake";
  else if (prairie) primary = "prairie";
  else if (city) primary = "city";

  return {
    text,
    north,
    desert,
    coast,
    lake,
    mountain,
    city,
    prairie,
    forest,
    primary,
  };
}

function getPalette(profile) {
  switch (profile.primary) {
    case "north":
      return {
        skyTop: "#09182f",
        skyBottom: "#33516e",
        glow: "#d9f3ff",
        horizon: "#54758a",
        mid: "#2e4a59",
        foreground: "#101f2c",
        waterTop: "#1c5e76",
        waterBottom: "#0d2536",
        accent: "#7cf1c4",
        accentSoft: "#9f8dff",
      };
    case "desert":
      return {
        skyTop: "#87c7ff",
        skyBottom: "#ffd4a1",
        glow: "#ffd771",
        horizon: "#d2a277",
        mid: "#a56c4e",
        foreground: "#6d4332",
        waterTop: "#7cb6cf",
        waterBottom: "#355d70",
        accent: "#f1e2c3",
        accentSoft: "#f5b97f",
      };
    case "coastal-city":
      return {
        skyTop: "#8ec7ef",
        skyBottom: "#f4d0aa",
        glow: "#ffe2a0",
        horizon: "#8da3b2",
        mid: "#5e7081",
        foreground: "#1b2937",
        waterTop: "#5a98b5",
        waterBottom: "#254357",
        accent: "#d8f6f5",
        accentSoft: "#f6e7ce",
      };
    case "coast":
      return {
        skyTop: "#97d6ff",
        skyBottom: "#f3dfc4",
        glow: "#ffe9a9",
        horizon: "#7ca5ad",
        mid: "#45646c",
        foreground: "#1c3138",
        waterTop: "#4f97b8",
        waterBottom: "#21465a",
        accent: "#d9fff3",
        accentSoft: "#dbeaf8",
      };
    case "mountain":
      return {
        skyTop: "#9fd3ff",
        skyBottom: "#f6e7d0",
        glow: "#fff1bb",
        horizon: "#8ea8b1",
        mid: "#607a86",
        foreground: "#253944",
        waterTop: "#6ea9c4",
        waterBottom: "#25475a",
        accent: "#edf7ff",
        accentSoft: "#d7efe4",
      };
    case "lake":
      return {
        skyTop: "#93ceff",
        skyBottom: "#f8e1ba",
        glow: "#ffe69a",
        horizon: "#8bad9e",
        mid: "#557667",
        foreground: "#20352f",
        waterTop: "#6aaec8",
        waterBottom: "#244f66",
        accent: "#e8fff8",
        accentSoft: "#d8edf9",
      };
    case "prairie":
      return {
        skyTop: "#84c5ff",
        skyBottom: "#f7d69c",
        glow: "#ffd35f",
        horizon: "#a1bf7f",
        mid: "#6d8f4d",
        foreground: "#3f5d31",
        waterTop: "#79b3cc",
        waterBottom: "#31596f",
        accent: "#f0f6d8",
        accentSoft: "#e8ecfb",
      };
    case "city":
      return {
        skyTop: "#9dc3e8",
        skyBottom: "#f4d2b6",
        glow: "#ffd69a",
        horizon: "#94a5b8",
        mid: "#647285",
        foreground: "#202938",
        waterTop: "#6f9eb7",
        waterBottom: "#284558",
        accent: "#edf8ff",
        accentSoft: "#f0e8d3",
      };
    default:
      return {
        skyTop: "#9bd3ff",
        skyBottom: "#f3dfbf",
        glow: "#ffe29e",
        horizon: "#8baa95",
        mid: "#557161",
        foreground: "#21362f",
        waterTop: "#6aa8c2",
        waterBottom: "#224457",
        accent: "#ebfff3",
        accentSoft: "#dcecf7",
      };
  }
}

function buildMountainLayer(yBase, minHeight, maxHeight, color, opacity, rand) {
  let x = -140;
  let pathData = `M ${x} ${yBase}`;

  while (x < TARGET_WIDTH + 140) {
    const width = 200 + rand() * 260;
    const peakX = x + width * (0.35 + rand() * 0.3);
    const peakY = yBase - (minHeight + rand() * (maxHeight - minHeight));
    const nextX = x + width;
    pathData += ` L ${peakX.toFixed(1)} ${peakY.toFixed(1)} L ${nextX.toFixed(1)} ${yBase.toFixed(1)}`;
    x = nextX;
  }

  pathData += ` L ${TARGET_WIDTH} ${TARGET_HEIGHT} L 0 ${TARGET_HEIGHT} Z`;
  return `<path d="${pathData}" fill="${color}" opacity="${opacity}"/>`;
}

function buildHillLayer(yBase, amplitude, color, opacity, rand) {
  let x = -100;
  let pathData = `M ${x} ${yBase}`;

  while (x < TARGET_WIDTH + 100) {
    const segmentWidth = 210 + rand() * 190;
    const control1X = x + segmentWidth * 0.35;
    const control2X = x + segmentWidth * 0.75;
    const endX = x + segmentWidth;
    const control1Y = yBase - amplitude * (0.25 + rand() * 1.05);
    const control2Y = yBase + amplitude * (0.2 + rand() * 0.45);
    const endY = yBase + amplitude * (rand() * 0.2 - 0.1);
    pathData += ` C ${control1X.toFixed(1)} ${control1Y.toFixed(1)}, ${control2X.toFixed(1)} ${control2Y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    x = endX;
  }

  pathData += ` L ${TARGET_WIDTH} ${TARGET_HEIGHT} L 0 ${TARGET_HEIGHT} Z`;
  return `<path d="${pathData}" fill="${color}" opacity="${opacity}"/>`;
}

function buildMesaLayer(yBase, color, opacity, rand) {
  const mesas = [];
  const mesaCount = 4;

  for (let index = 0; index < mesaCount; index += 1) {
    const width = 150 + rand() * 160;
    const x = index * 340 + 40 + rand() * 40;
    const height = 90 + rand() * 110;
    const inset = width * (0.18 + rand() * 0.12);
    mesas.push(
      `<path d="M ${x.toFixed(1)} ${yBase.toFixed(1)} L ${(x + inset).toFixed(1)} ${(yBase - height).toFixed(1)} L ${(x + width - inset).toFixed(1)} ${(yBase - height * (0.9 + rand() * 0.12)).toFixed(1)} L ${(x + width).toFixed(1)} ${yBase.toFixed(1)} Z" fill="${color}" opacity="${opacity}"/>`
    );
  }

  return mesas.join("");
}

function buildWater(horizonY, palette, rand) {
  const shimmerY = horizonY + 44 + rand() * 18;
  return `
    <rect x="0" y="${horizonY}" width="${TARGET_WIDTH}" height="${TARGET_HEIGHT - horizonY}" fill="url(#waterGradient)"/>
    <path d="M 0 ${shimmerY.toFixed(1)} C 180 ${(shimmerY - 14).toFixed(1)}, 330 ${(shimmerY + 6).toFixed(1)}, 510 ${(shimmerY - 8).toFixed(1)} S 870 ${(shimmerY + 8).toFixed(1)}, 1100 ${(shimmerY - 4).toFixed(1)} S 1430 ${(shimmerY + 10).toFixed(1)}, 1600 ${(shimmerY - 8).toFixed(1)}" fill="none" stroke="${rgba(palette.accent, 0.3)}" stroke-width="4" stroke-linecap="round"/>
    <path d="M 0 ${(shimmerY + 28).toFixed(1)} C 220 ${(shimmerY + 18).toFixed(1)}, 430 ${(shimmerY + 42).toFixed(1)}, 650 ${(shimmerY + 24).toFixed(1)} S 1020 ${(shimmerY + 48).toFixed(1)}, 1280 ${(shimmerY + 26).toFixed(1)} S 1490 ${(shimmerY + 42).toFixed(1)}, 1600 ${(shimmerY + 30).toFixed(1)}" fill="none" stroke="${rgba(palette.accentSoft, 0.16)}" stroke-width="3" stroke-linecap="round"/>
  `;
}

function buildTreeRow(baseY, palette, rand) {
  const trees = [];
  let x = -20;

  while (x < TARGET_WIDTH + 30) {
    const width = 22 + rand() * 36;
    const height = 44 + rand() * 92;
    const trunkWidth = Math.max(5, width * 0.14);
    const topX = x + width / 2;
    trees.push(`
      <path d="M ${x.toFixed(1)} ${baseY.toFixed(1)} L ${topX.toFixed(1)} ${(baseY - height).toFixed(1)} L ${(x + width).toFixed(1)} ${baseY.toFixed(1)} Z" fill="${rgba(palette.foreground, 0.95)}"/>
      <rect x="${(topX - trunkWidth / 2).toFixed(1)}" y="${(baseY - height * 0.08).toFixed(1)}" width="${trunkWidth.toFixed(1)}" height="${(height * 0.12).toFixed(1)}" fill="${rgba(palette.foreground, 0.98)}"/>
    `);
    x += width * (0.75 + rand() * 0.9);
  }

  return trees.join("");
}

function buildSkyline(baseY, palette, rand, text) {
  const buildings = [];
  let x = 40;

  while (x < TARGET_WIDTH - 20) {
    const width = 36 + rand() * 82;
    const height = 70 + rand() * 210;
    const rounded = rand() > 0.82;
    buildings.push(
      rounded
        ? `<rect x="${x.toFixed(1)}" y="${(baseY - height).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${(width * 0.18).toFixed(1)}" fill="${rgba(palette.foreground, 0.72)}"/>`
        : `<rect x="${x.toFixed(1)}" y="${(baseY - height).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${rgba(palette.foreground, 0.72)}"/>`
    );
    x += width + 8 + rand() * 18;
  }

  if (/\btoronto\b/.test(text)) {
    buildings.push(
      `<rect x="1115" y="${(baseY - 275).toFixed(1)}" width="12" height="275" fill="${rgba(palette.foreground, 0.82)}"/>`,
      `<rect x="1104" y="${(baseY - 286).toFixed(1)}" width="34" height="14" rx="5" fill="${rgba(palette.accentSoft, 0.7)}"/>`,
      `<rect x="1119" y="${(baseY - 348).toFixed(1)}" width="4" height="62" fill="${rgba(palette.foreground, 0.9)}"/>`
    );
  }

  return buildings.join("");
}

function buildAurora(palette, rand) {
  const ribbons = [];

  for (let index = 0; index < 3; index += 1) {
    const startY = 120 + index * 65 + rand() * 20;
    const c1 = 240 + rand() * 150;
    const c2 = 620 + rand() * 150;
    const c3 = 1040 + rand() * 120;
    const endY = startY + 50 + rand() * 60;
    ribbons.push(
      `<path d="M -80 ${startY.toFixed(1)} C ${c1.toFixed(1)} ${(startY - 54).toFixed(1)}, ${c2.toFixed(1)} ${(startY + 62).toFixed(1)}, ${c3.toFixed(1)} ${(startY - 26).toFixed(1)} S 1480 ${(endY + 24).toFixed(1)}, 1680 ${endY.toFixed(1)}" fill="none" stroke="${index % 2 === 0 ? rgba(palette.accent, 0.35) : rgba(palette.accentSoft, 0.28)}" stroke-width="${24 - index * 5}" stroke-linecap="round" filter="url(#auroraBlur)"/>`
    );
  }

  return ribbons.join("");
}

function buildScenicSvg(destination) {
  const rand = createSeededRandom(destination.id);
  const profile = getSceneProfile(destination);
  const palette = getPalette(profile);
  const horizonY =
    profile.coast || profile.lake || profile.primary === "coastal-city" ? 515 : 575;
  const cloudCount = 3 + Math.floor(rand() * 3);
  const clouds = [];

  for (let index = 0; index < cloudCount; index += 1) {
    const cx = 180 + rand() * 1240;
    const cy = 110 + rand() * 180;
    const rx = 70 + rand() * 120;
    const ry = 26 + rand() * 40;
    clouds.push(
      `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${rgba("#ffffff", 0.11 + rand() * 0.08)}"/>`
    );
  }

  const backgroundTerrain =
    profile.primary === "desert"
      ? [
          buildHillLayer(610, 38, rgba(palette.horizon, 0.9), 1, rand),
          buildMesaLayer(650, rgba(palette.mid, 0.84), 1, rand),
        ].join("")
      : profile.primary === "prairie" || profile.primary === "city"
        ? [
            buildHillLayer(600, 34, rgba(palette.horizon, 0.96), 1, rand),
            buildHillLayer(660, 28, rgba(palette.mid, 0.88), 1, rand),
          ].join("")
        : [
            buildMountainLayer(585, 120, 250, rgba(palette.horizon, 0.94), 1, rand),
            buildMountainLayer(680, 80, 190, rgba(palette.mid, 0.92), 1, rand),
          ].join("");

  const foregroundTerrain =
    profile.primary === "desert"
      ? `
        <path d="M 0 690 C 140 645, 260 660, 420 698 S 790 724, 980 678 S 1320 642, 1600 702 L 1600 900 L 0 900 Z" fill="${palette.foreground}" opacity="0.96"/>
        ${buildMesaLayer(760, rgba(palette.foreground, 0.96), 1, rand)}
      `
      : profile.primary === "city" || profile.primary === "coastal-city"
        ? `
          <path d="M 0 760 C 180 712, 340 748, 560 726 S 1000 752, 1240 726 S 1470 736, 1600 770 L 1600 900 L 0 900 Z" fill="${palette.foreground}" opacity="0.98"/>
        `
        : `
          <path d="M 0 760 C 140 710, 320 748, 510 720 S 880 750, 1070 718 S 1450 736, 1600 778 L 1600 900 L 0 900 Z" fill="${palette.foreground}" opacity="0.98"/>
        `;

  const skyline =
    profile.primary === "city" || profile.primary === "coastal-city"
      ? buildSkyline(profile.coast ? 610 : 650, palette, rand, profile.text)
      : "";

  const water =
    profile.coast || profile.lake || profile.primary === "coastal-city"
      ? buildWater(horizonY, palette, rand)
      : "";

  const treeRow =
    profile.forest || profile.coast || profile.mountain || profile.north
      ? buildTreeRow(profile.coast || profile.lake ? 760 : 790, palette, rand)
      : "";

  const aurora = profile.north ? buildAurora(palette, rand) : "";

  const coastCliffs =
    profile.coast || profile.primary === "coastal-city"
      ? `
        <path d="M 0 560 L 0 900 L 260 900 L 240 760 L 182 684 L 106 648 Z" fill="${rgba(palette.foreground, 0.9)}"/>
        <path d="M 1600 575 L 1600 900 L 1370 900 L 1392 760 L 1468 700 L 1532 666 Z" fill="${rgba(palette.foreground, 0.9)}"/>
      `
      : "";

  const fieldBands =
    profile.primary === "prairie"
      ? `
        <path d="M 0 700 C 180 680, 420 726, 610 704 S 1010 680, 1240 706 S 1490 712, 1600 696 L 1600 760 L 0 760 Z" fill="${rgba(palette.accent, 0.24)}"/>
        <path d="M 0 742 C 230 720, 450 760, 690 734 S 1100 710, 1340 740 S 1510 746, 1600 730 L 1600 790 L 0 790 Z" fill="${rgba(palette.accentSoft, 0.18)}"/>
      `
      : "";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TARGET_WIDTH} ${TARGET_HEIGHT}" role="img" aria-label="${escapeSvg(destination.name)} scenic artwork">
      <defs>
        <linearGradient id="skyGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${palette.skyTop}"/>
          <stop offset="60%" stop-color="${palette.skyBottom}"/>
          <stop offset="100%" stop-color="${palette.accentSoft}"/>
        </linearGradient>
        <linearGradient id="waterGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${palette.waterTop}"/>
          <stop offset="100%" stop-color="${palette.waterBottom}"/>
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${rgba(palette.glow, 0.92)}"/>
          <stop offset="100%" stop-color="${rgba(palette.glow, 0)}"/>
        </radialGradient>
        <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18"/>
        </filter>
        <filter id="auroraBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16"/>
        </filter>
      </defs>
      <rect width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}" fill="url(#skyGradient)"/>
      <circle cx="${(1180 + rand() * 180).toFixed(1)}" cy="${(150 + rand() * 90).toFixed(1)}" r="${(110 + rand() * 36).toFixed(1)}" fill="url(#sunGlow)" filter="url(#softBlur)"/>
      ${aurora}
      ${clouds.join("")}
      ${backgroundTerrain}
      ${water}
      ${skyline}
      ${fieldBands}
      ${coastCliffs}
      ${foregroundTerrain}
      ${treeRow}
      <rect width="${TARGET_WIDTH}" height="${TARGET_HEIGHT}" fill="${rgba("#04101b", 0.06)}"/>
    </svg>
  `.trim();
}

async function buildGeneratedSourceBuffer(destination) {
  const svg = buildScenicSvg(destination);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function getSourceUrl(destination) {
  const candidates = [
    destination.image_source_url,
    destination.image_url,
    destination.image_url_light,
    destination.image_url_dark,
  ];

  return candidates.find((value) => isExternalUrl(value))?.trim() ?? "";
}

function getOutputPath(destinationId, variant) {
  return path.join(OUTPUT_DIR, `${destinationId}-${variant}.webp`);
}

function getPublicPath(destinationId, variant) {
  return `/destinations/theme/${destinationId}-${variant}.webp`;
}

async function destinationHasThemeAssets(destination) {
  const [hasLight, hasDark] = await Promise.all([
    pathExists(getOutputPath(destination.id, "light")),
    pathExists(getOutputPath(destination.id, "dark")),
  ]);

  return hasLight && hasDark;
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

  if (
    !(FORCE_GENERATED_THEME_REFRESH && !sourceUrl) &&
    destination.image_url_light === getPublicPath(destination.id, "light") &&
    destination.image_url_dark === getPublicPath(destination.id, "dark") &&
    (await destinationHasThemeAssets(destination))
  ) {
    return destination;
  }

  const buffer = sourceUrl
    ? await fetchImageBuffer(sourceUrl, destination.name)
    : await buildGeneratedSourceBuffer(destination);
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
  let generatedCount = 0;
  let reusedCount = 0;

  for (const destination of destinations) {
    const hasExistingAssets = await destinationHasThemeAssets(destination);
    const nextDestination = await refreshDestination(destination);
    nextDestinations.push(nextDestination);

    if (
      !getSourceUrl(destination) &&
      nextDestination.image_url_light === getPublicPath(destination.id, "light")
    ) {
      generatedCount += 1;
    } else if (hasExistingAssets) {
      reusedCount += 1;
    }

    if (getSourceUrl(destination)) {
      await sleep(DOWNLOAD_DELAY_MS);
    }
  }

  const nextAlbertaDestinations = nextDestinations.filter(
    (destination) =>
      !canadaDestinationIds.has(destination.id) &&
      !canadaExpandedDestinationIds.has(destination.id)
  );
  const nextCanadaDestinations = nextDestinations.filter((destination) =>
    canadaDestinationIds.has(destination.id)
  );
  const nextCanadaExpandedDestinations = nextDestinations.filter((destination) =>
    canadaExpandedDestinationIds.has(destination.id)
  );

  await fs.writeFile(
    ALBERTA_DATA_FILE,
    `${JSON.stringify(nextAlbertaDestinations, null, 2)}\n`
  );
  await fs.writeFile(
    CANADA_DATA_FILE,
    `${JSON.stringify(nextCanadaDestinations, null, 2)}\n`
  );
  await fs.writeFile(
    CANADA_EXPANDED_DATA_FILE,
    `${JSON.stringify(nextCanadaExpandedDestinations, null, 2)}\n`
  );

  console.log(`Refreshed ${nextDestinations.length} destination image pairs.`);
  console.log(`Generated scenic fallback art for ${generatedCount} destinations.`);
  console.log(`Reused existing themed assets for ${reusedCount} destinations.`);
  console.log(`Assets written to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
