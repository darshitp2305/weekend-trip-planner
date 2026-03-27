import { NextRequest } from "next/server";
import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";

type Coordinate = {
  lat: number;
  lon: number;
  label?: string;
};

type LocationInput =
  | string
  | {
      label?: string;
      lat?: number;
      lon?: number;
      latitude?: number;
      longitude?: number;
    };

type Body = {
  origin: LocationInput;
  destination: LocationInput;
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asCoordinate(input: LocationInput): Coordinate | null {
  if (!input || typeof input === "string") return null;

  const lat =
    isFiniteNumber(input.lat) ? input.lat : isFiniteNumber(input.latitude) ? input.latitude : null;

  const lon =
    isFiniteNumber(input.lon) ? input.lon : isFiniteNumber(input.longitude) ? input.longitude : null;

  if (
    !isFiniteNumber(lat) ||
    !isFiniteNumber(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  return {
    lat,
    lon,
    label: typeof input.label === "string" ? input.label : undefined,
  };
}

function asQuery(input: LocationInput): string | null {
  if (typeof input === "string" && input.trim()) {
    const cleaned = input.trim();
    return cleaned.length <= 160 ? cleaned : null;
  }

  if (input && typeof input === "object" && typeof input.label === "string" && input.label.trim()) {
    const cleaned = input.label.trim();
    return cleaned.length <= 160 ? cleaned : null;
  }

  return null;
}

async function geocodeWithNominatim(input: LocationInput): Promise<Coordinate | null> {
  const direct = asCoordinate(input);
  if (direct) return direct;

  const query = asQuery(input);
  if (!query) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "TrippifyTripPlanner/1.0",
      "Accept-Language": "en-CA,en;q=0.9",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const results = (await response.json()) as NominatimResult[];
  const top = Array.isArray(results) ? results[0] : null;

  if (!top) return null;

  const lat = Number(top.lat);
  const lon = Number(top.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat,
    lon,
    label: top.display_name,
  };
}

export async function POST(req: NextRequest) {
  const sameOriginViolation = enforceSameOrigin(req);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(req, {
    key: "osm-route",
    limit: 40,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(req, 16_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = (await req.json()) as Body;

    if (!body?.origin || !body?.destination) {
      return jsonNoStore(
        {
          success: false,
          error: "Missing origin or destination in request body.",
        },
        { status: 400 }
      );
    }

    const [origin, destination] = await Promise.all([
      geocodeWithNominatim(body.origin),
      geocodeWithNominatim(body.destination),
    ]);

    if (!origin || !destination) {
      return jsonNoStore(
        {
          success: false,
          error: "Could not geocode origin or destination.",
        },
        { status: 400 }
      );
    }

    const osrmUrl = new URL(
      `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}`
    );
    osrmUrl.searchParams.set("overview", "full");
    osrmUrl.searchParams.set("geometries", "geojson");
    osrmUrl.searchParams.set("steps", "false");

    const routeResponse = await fetch(osrmUrl.toString(), {
      cache: "no-store",
    });

    if (!routeResponse.ok) {
      const text = await routeResponse.text();
      return jsonNoStore(
        {
          success: false,
          error: "Routing request failed.",
          details: text,
        },
        { status: 502 }
      );
    }

    const routeData = await routeResponse.json();
    const route = Array.isArray(routeData?.routes) ? routeData.routes[0] : null;

    if (!route) {
      return jsonNoStore(
        {
          success: false,
          error: "No route found.",
        },
        { status: 404 }
      );
    }

    return jsonNoStore({
      success: true,
      route: {
        distanceMeters: Math.round(route.distance ?? 0),
        durationSeconds: Math.round(route.duration ?? 0),
        geometry: route.geometry ?? null,
        origin,
        destination,
      },
    });
  } catch (error) {
    console.error("osm-route route failed:", error);

    return jsonNoStore(
      {
        success: false,
        error: "Failed to build route.",
      },
      { status: 500 }
    );
  }
}
