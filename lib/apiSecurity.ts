import { createHash } from "crypto";
import { NextResponse } from "next/server";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_STORE_KEY = "__trippify_rate_limit_store__";

function getRateLimitStore() {
  const globalState = globalThis as typeof globalThis & {
    [RATE_LIMIT_STORE_KEY]?: Map<string, RateLimitBucket>;
  };

  if (!globalState[RATE_LIMIT_STORE_KEY]) {
    globalState[RATE_LIMIT_STORE_KEY] = new Map<string, RateLimitBucket>();
  }

  return globalState[RATE_LIMIT_STORE_KEY];
}

function cleanupExpiredBuckets(store: Map<string, RateLimitBucket>, now: number) {
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function jsonNoStore(
  body: unknown,
  init?: ResponseInit & { headers?: HeadersInit }
) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

function privacySafeClientKey(request: Request) {
  const ip = getClientIp(request);
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

export function enforceRateLimit(
  request: Request,
  options: RateLimitOptions
) {
  const now = Date.now();
  const store = getRateLimitStore();
  cleanupExpiredBuckets(store, now);

  const bucketKey = `${options.key}:${privacySafeClientKey(request)}`;
  const bucket = store.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    store.set(bucketKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  if (bucket.count >= options.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    return jsonNoStore(
      {
        success: false,
        error: "Too many requests. Please try again shortly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  }

  bucket.count += 1;
  store.set(bucketKey, bucket);
  return null;
}

export function enforceSameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");

  if (origin && origin !== requestOrigin) {
    return jsonNoStore(
      {
        success: false,
        error: "Cross-site requests are not allowed.",
      },
      { status: 403 }
    );
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !origin &&
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "same-site" &&
    fetchSite !== "none"
  ) {
    return jsonNoStore(
      {
        success: false,
        error: "Cross-site requests are not allowed.",
      },
      { status: 403 }
    );
  }

  return null;
}

export function rejectOversizedJsonRequest(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return jsonNoStore(
      {
        success: false,
        error: "Request body is too large.",
      },
      { status: 413 }
    );
  }

  return null;
}

export function isValidPublicTripId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function isSafeInternalRedirect(value: string | undefined) {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}
