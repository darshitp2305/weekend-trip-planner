const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "dclid",
  "mc_cid",
  "mc_eid",
];

function isBlockedGoogleClickUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (host === "www.google.com" || host === "google.com") && path === "/aclk";
}

export function sanitizeExternalNavigationUrl(value?: string) {
  if (!value) return undefined;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    if (url.username || url.password) {
      return undefined;
    }

    if (isBlockedGoogleClickUrl(url)) {
      return undefined;
    }

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    return url.toString();
  } catch {
    return undefined;
  }
}
