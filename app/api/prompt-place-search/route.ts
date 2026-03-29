/**
 * Next.js API route for 'api/prompt-place-search'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";
import {
  getPromptLimitError,
  isPromptTooLong,
  normalizePromptText,
  PROMPT_PLACE_SEARCH_MAX_CHARS,
} from "../../../lib/promptLimits";
import {
  searchActivitiesByPreference,
  searchRestaurantsByPreference,
} from "../../../lib/googlePlaces";
import {
  mapGooglePlaceToActivity,
  mapGooglePlaceToFoodSpot,
} from "../../../lib/placeMappers";
import { Activity, FoodSpot } from "../../../lib/types";

type SearchKind = "food" | "activity";

type RequestBody = {
  desiredText?: unknown;
  destination?: unknown;
  kind?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  radiusKm?: unknown;
};

function dedupeFoodSpots(spots: FoodSpot[]) {
  const seen = new Set<string>();
  const deduped: FoodSpot[] = [];

  for (const spot of spots) {
    const key = spot.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(spot);
  }

  return deduped;
}

function dedupeActivities(activities: Activity[]) {
  const seen = new Set<string>();
  const deduped: Activity[] = [];

  for (const activity of activities) {
    const key = activity.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(activity);
  }

  return deduped;
}

function isSearchKind(value: unknown): value is SearchKind {
  return value === "food" || value === "activity";
}

export async function POST(request: Request) {
  const sameOriginViolation = enforceSameOrigin(request);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(request, {
    key: "prompt-place-search",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(request, 64_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = (await request.json()) as RequestBody;
    const desiredText = normalizePromptText(body.desiredText);
    const destination = normalizePromptText(body.destination);
    const kind = isSearchKind(body.kind) ? body.kind : null;
    const latitude =
      typeof body.latitude === "number" && Number.isFinite(body.latitude)
        ? body.latitude
        : undefined;
    const longitude =
      typeof body.longitude === "number" && Number.isFinite(body.longitude)
        ? body.longitude
        : undefined;
    const radiusKm =
      typeof body.radiusKm === "number" && Number.isFinite(body.radiusKm)
        ? body.radiusKm
        : undefined;

    if (!desiredText || !destination || !kind) {
      return jsonNoStore(
        {
          success: false,
          error: "Missing desiredText, destination, or supported kind.",
        },
        { status: 400 }
      );
    }

    if (isPromptTooLong(desiredText, PROMPT_PLACE_SEARCH_MAX_CHARS)) {
      return jsonNoStore(
        {
          success: false,
          error: getPromptLimitError(
            "Prompt search text",
            PROMPT_PLACE_SEARCH_MAX_CHARS
          ),
        },
        { status: 400 }
      );
    }

    if (kind === "food") {
      const response = await searchRestaurantsByPreference(destination, desiredText, {
        latitude,
        longitude,
        radiusKm,
      });
      const foodSpots = dedupeFoodSpots(
        (response.places ?? []).map(mapGooglePlaceToFoodSpot)
      );

      return jsonNoStore({
        success: true,
        kind,
        foodSpots,
      });
    }

    const response = await searchActivitiesByPreference(destination, desiredText, {
      latitude,
      longitude,
      radiusKm,
    });
    const activities = dedupeActivities(
      (response.places ?? []).map(mapGooglePlaceToActivity)
    );

    return jsonNoStore({
      success: true,
      kind,
      activities,
    });
  } catch (error) {
    return jsonNoStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Prompt place search failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
