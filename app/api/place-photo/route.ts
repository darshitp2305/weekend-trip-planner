/**
 * Next.js API route for 'api/place-photo'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  isAllowedExternalFetchUrl,
  jsonNoStore,
} from "../../../lib/apiSecurity";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ALLOWED_GOOGLE_PHOTO_HOSTS = [
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
];

async function fetchAllowedPhoto(url: string, redirectsRemaining = 2): Promise<Response> {
  if (!isAllowedExternalFetchUrl(url, ALLOWED_GOOGLE_PHOTO_HOSTS)) {
    throw new Error("Blocked photo fetch to untrusted host.");
  }

  const response = await fetch(url, {
    cache: "force-cache",
    redirect: "manual",
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectsRemaining <= 0) {
      throw new Error("Photo fetch exceeded redirect limit.");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Photo fetch redirect missing location.");
    }

    const nextUrl = new URL(location, url).toString();
    return fetchAllowedPhoto(nextUrl, redirectsRemaining - 1);
  }

  return response;
}

export async function GET(request: Request) {
  const rateLimitViolation = enforceRateLimit(request, {
    key: "place-photo",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  try {
    if (!API_KEY) {
      return jsonNoStore(
        { success: false, error: "Missing GOOGLE_MAPS_API_KEY." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const ref = searchParams.get("ref")?.trim();

    if (
      !ref ||
      !/^places\/[^/]+\/photos\/[^/?#]+$/i.test(ref)
    ) {
      return jsonNoStore(
        { success: false, error: "Missing photo reference." },
        { status: 400 }
      );
    }

    const photoMetaResponse = await fetch(
      `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=900&maxHeightPx=560&skipHttpRedirect=true`,
      {
        headers: {
          "X-Goog-Api-Key": API_KEY,
        },
        cache: "force-cache",
      }
    );

    if (!photoMetaResponse.ok) {
      const text = await photoMetaResponse.text();
      throw new Error(`Photo lookup failed: ${photoMetaResponse.status} ${text}`);
    }

    const photoMeta = (await photoMetaResponse.json().catch(() => null)) as
      | { photoUri?: string }
      | null;

    if (!photoMeta?.photoUri) {
      return NextResponse.json(
        { success: false, error: "Photo unavailable." },
        { status: 404 }
      );
    }

    const imageResponse = await fetchAllowedPhoto(photoMeta.photoUri);

    if (!imageResponse.ok) {
      throw new Error(`Photo fetch failed: ${imageResponse.status}`);
    }

    const contentType = imageResponse.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Unexpected photo content type: ${contentType || "unknown"}`);
    }

    return new NextResponse(imageResponse.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("place-photo route error:", error);
    return jsonNoStore(
      { success: false, error: "Failed to load place photo." },
      { status: 500 }
    );
  }
}
