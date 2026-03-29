import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";
import { interpretBuilderPromptWithOpenAI } from "../../../lib/openAiBuilderPrompt";
import { Activity, FoodSpot, HotelOption, ItineraryDayData } from "../../../lib/types";

type RequestBody = {
  prompt?: unknown;
  destinationLabel?: unknown;
  startCityLabel?: unknown;
  days?: unknown;
  hotels?: unknown;
  foodSpots?: unknown;
  activities?: unknown;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const sameOriginViolation = enforceSameOrigin(request);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(request, {
    key: "interpret-builder-prompt",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(request, 256_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = (await request.json()) as RequestBody;
    const prompt = safeString(body.prompt);
    const destinationLabel = safeString(body.destinationLabel);
    const startCityLabel = safeString(body.startCityLabel);
    const days = Array.isArray(body.days) ? (body.days as ItineraryDayData[]) : [];
    const hotels = Array.isArray(body.hotels) ? (body.hotels as HotelOption[]) : [];
    const foodSpots = Array.isArray(body.foodSpots) ? (body.foodSpots as FoodSpot[]) : [];
    const activities = Array.isArray(body.activities) ? (body.activities as Activity[]) : [];

    if (!prompt) {
      return jsonNoStore(
        {
          success: false,
          error: "Missing builder prompt.",
        },
        { status: 400 }
      );
    }

    const result = await interpretBuilderPromptWithOpenAI({
      prompt,
      destinationLabel,
      startCityLabel,
      days,
      hotels,
      foodSpots,
      activities,
    });

    return jsonNoStore({
      success: true,
      rewrittenPrompt: result.interpretation?.rewrittenPrompt ?? null,
      confidence: result.interpretation?.confidence ?? null,
      status: result.status,
    });
  } catch (error) {
    return jsonNoStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Builder prompt interpretation failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
