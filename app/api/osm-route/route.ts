import { NextRequest, NextResponse } from "next/server";

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

  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
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
    return input.trim();
  }

  if (input && typeof input === "object" && typeof input.label === "string" && input.label.trim()) {
    return input.label.trim();
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
      "User-Agent": "WeekendTripPlanner/1.0",
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
  try {
    const body = (await req.json()) as Body;

    if (!body?.origin || !body?.destination) {
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
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
      return NextResponse.json(
        {
          success: false,
          error: "No route found.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
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

    return NextResponse.json(
      {
        success: false,
        error: "Failed to build route.",
      },
      { status: 500 }
    );
  }
}