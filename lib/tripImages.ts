/**
 * Helper module for trip images concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

function normalized(value?: string) {
  return (value ?? "").trim();
}

const DESTINATION_LOCAL_FALLBACKS: Record<string, string> = {
  crowsnest: "/destinations/crowsnest-pass-hero.svg",
  "crowsnest pass": "/destinations/crowsnest-pass-hero.svg",
  blairmore: "/destinations/crowsnest-pass-hero.svg",
  coleman: "/destinations/crowsnest-pass-hero.svg",
};

const DESTINATION_CURATED_IMAGE_FALLBACKS: Record<string, string> = {
  crowsnest:
    "https://upload.wikimedia.org/wikipedia/commons/d/d3/Crowsnest_Mountain_-_August_2011.JPG",
  "crowsnest pass":
    "https://upload.wikimedia.org/wikipedia/commons/d/d3/Crowsnest_Mountain_-_August_2011.JPG",
  blairmore:
    "https://upload.wikimedia.org/wikipedia/commons/d/d3/Crowsnest_Mountain_-_August_2011.JPG",
  coleman:
    "https://upload.wikimedia.org/wikipedia/commons/d/d3/Crowsnest_Mountain_-_August_2011.JPG",
};

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getDestinationLocalFallback(name?: string) {
  const key = normalized(name).toLowerCase();
  if (!key) return null;

  for (const [pattern, assetPath] of Object.entries(DESTINATION_LOCAL_FALLBACKS)) {
    if (key.includes(pattern)) {
      return assetPath;
    }
  }

  return null;
}

function getDestinationCuratedFallback(name?: string) {
  const key = normalized(name).toLowerCase();
  if (!key) return null;

  for (const [pattern, assetPath] of Object.entries(
    DESTINATION_CURATED_IMAGE_FALLBACKS
  )) {
    if (key.includes(pattern)) {
      return assetPath;
    }
  }

  return null;
}

function isKnownPlaceholderUrl(url?: string) {
  const value = normalized(url).toLowerCase();
  if (!value) return false;

  return (
    value.includes("/destinations/crowsnest-pass-hero.svg") ||
    value.includes("data:image/svg+xml")
  );
}

function isWikimediaRedirectImageUrl(url?: string) {
  const value = normalized(url);
  if (!value) return false;

  return /^https?:\/\/commons\.wikimedia\.org\/wiki\/special:redirect\/file\//i.test(
    value
  );
}

export function getFallbackImageUrl(name?: string) {
  const label = escapeSvgText((name ?? "Trippify").trim() || "Trippify");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-label="${label}">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#dff4ff"/>
          <stop offset="48%" stop-color="#b9d7f0"/>
          <stop offset="100%" stop-color="#f8efe3"/>
        </linearGradient>
        <linearGradient id="ridgeBack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#8ea7a6"/>
          <stop offset="100%" stop-color="#60727b"/>
        </linearGradient>
        <linearGradient id="ridgeFront" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#445b63"/>
          <stop offset="100%" stop-color="#233641"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)"/>
      <circle cx="1270" cy="170" r="74" fill="#fff4c2" opacity="0.8"/>
      <path d="M0 560 L180 420 L320 510 L470 360 L650 520 L850 330 L1020 500 L1190 350 L1380 510 L1600 390 L1600 900 L0 900 Z" fill="url(#ridgeBack)" opacity="0.9"/>
      <path d="M0 650 L220 500 L360 610 L560 430 L760 640 L980 470 L1190 620 L1390 470 L1600 590 L1600 900 L0 900 Z" fill="url(#ridgeFront)"/>
      <rect x="86" y="80" width="620" height="132" rx="28" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.36)"/>
      <text x="120" y="138" font-family="Georgia, serif" font-size="42" fill="#0f172a" opacity="0.8">Weekend Trip</text>
      <text x="120" y="190" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#0f172a">${label}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function isProbablyRenderableImageUrl(value?: string) {
  const url = normalized(value);
  if (!url) return false;

  if (/^\//.test(url)) return true;
  if (/^data:image\//i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  if (isWikimediaRedirectImageUrl(url)) return true;
  if (/commons\.wikimedia\.org\/wiki\//i.test(url)) return false;

  return true;
}

export function normalizeTripImageUrl(value?: string, fallbackName?: string) {
  const url = normalized(value);
  const curatedFallback = getDestinationCuratedFallback(fallbackName);

  if (isKnownPlaceholderUrl(url) && curatedFallback) {
    return curatedFallback;
  }

  if (isProbablyRenderableImageUrl(url)) {
    return url;
  }

  if (curatedFallback) {
    return curatedFallback;
  }

  const destinationFallback = getDestinationLocalFallback(fallbackName);
  if (destinationFallback) {
    return destinationFallback;
  }

  return getFallbackImageUrl(fallbackName);
}
