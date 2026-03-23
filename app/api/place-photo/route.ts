import { NextResponse } from "next/server";
import { enforceRateLimit, jsonNoStore } from "../../../lib/apiSecurity";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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

    const imageResponse = await fetch(photoMeta.photoUri, {
      cache: "force-cache",
    });

    if (!imageResponse.ok) {
      throw new Error(`Photo fetch failed: ${imageResponse.status}`);
    }

    const contentType =
      imageResponse.headers.get("content-type") ?? "image/jpeg";

    return new NextResponse(imageResponse.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Cross-Origin-Resource-Policy": "same-origin",
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
