import { ProviderOutcome, RankedDestination, TripInput } from "./types";
import { reportProviderEvent } from "./providerTelemetry";
import { deriveTripIntentFromPrompt } from "./tripIntent";

export type OpenAITripPayload = {
  name: string;
  aiSummary: string;
  aiBestFit: string;
  aiBudgetNote: string;
  aiItinerary: string[];
};

type ResponsesApiOutput = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

type ParsedTripsPayload = {
  trips?: unknown[];
};

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try fenced code block
  }

  const fencedMatch =
    trimmed.match(/```json\s*([\s\S]*?)```/i) ||
    trimmed.match(/```([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      return null;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function getResponseText(data: ResponsesApiOutput): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts: string[] = [];

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const contentItem of item.content) {
        if (typeof contentItem?.text === "string") {
          parts.push(contentItem.text);
        }
      }
    }
  }

  return parts.join("\n").trim();
}

function topActivityNames(trip: RankedDestination): string[] {
  return Array.isArray(trip.topActivities)
    ? trip.topActivities
        .map((item) => item?.name)
        .filter(
          (name): name is string => typeof name === "string" && name.length > 0
        )
    : [];
}

function mergeAiFields(
  rankedTrips: RankedDestination[],
  aiTrips: OpenAITripPayload[]
): RankedDestination[] {
  const aiMap = new Map(
    aiTrips.map((trip) => [trip.name.trim().toLowerCase(), trip])
  );

  return rankedTrips.map((trip) => {
    const match = aiMap.get(trip.name.trim().toLowerCase());
    if (!match) return trip;

    return {
      ...trip,
      aiSummary: safeString(match.aiSummary, trip.aiSummary ?? ""),
      aiBestFit: safeString(match.aiBestFit, trip.aiBestFit ?? ""),
      aiBudgetNote: safeString(match.aiBudgetNote, trip.aiBudgetNote ?? ""),
      aiItinerary: safeStringArray(match.aiItinerary),
    };
  });
}

export async function generateTripCopyWithOpenAI(
  input: TripInput,
  rankedTrips: RankedDestination[]
): Promise<{
  trips: RankedDestination[] | null;
  status: ProviderOutcome;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      trips: null,
      status: "fallback_used",
    };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const compactTrips = rankedTrips.slice(0, 3).map((trip) => ({
    name: trip.name,
    province: trip.province,
    summary: trip.summary,
    driveHoursFromStart: trip.driveHoursFromStart,
    estimatedCost: Math.round(trip.estimatedCost),
    styleMatchStrength: trip.styleMatchStrength,
    rankingReasons: trip.rankingReasons ?? [],
    tags: trip.rawVibes ?? [],
    topActivities: topActivityNames(trip).slice(0, 4),
    foodSpots: Array.isArray(trip.foodSpots)
      ? trip.foodSpots
          .map((item) => item?.name)
          .filter((name): name is string => typeof name === "string")
          .slice(0, 4)
      : [],
    veganFriendly: trip.veganFriendly,
  }));
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);

  const systemPrompt = [
    "You are writing destination-specific trip copy for a trip planning app.",
    "The product delivers one high-conviction trip the traveler can actually act on.",
    "Return ONLY valid JSON.",
    "Do not use markdown fences.",
    "Do not repeat the same wording across all trips.",
    "Make each destination feel distinct.",
    "Use concrete local differences from the provided trip data.",
    "Keep each field concise and natural.",
    "aiItinerary must be an array of short strings that feel realistic and usable.",
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Generate concise trip copy for the ranked trips.",
      required_output_shape: {
        trips: [
          {
            name: "string",
            aiSummary: "string",
            aiBestFit: "string",
            aiBudgetNote: "string",
            aiItinerary: ["string", "string"],
          },
        ],
      },
      input,
      trip_brief: input.tripPrompt ?? null,
      prompt_interpretation: promptIntent,
      trips: compactTrips,
    },
    null,
    2
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        max_output_tokens: 1800,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      reportProviderEvent({
        provider: "openai",
        operation: "generate_trip_copy",
        outcome: "live_unavailable",
        statusCode: response.status,
        detail: `Responses API returned non-OK status: ${errorText.slice(0, 200)}`,
      });
      return {
        trips: null,
        status: "live_unavailable",
      };
    }

    const data = (await response.json()) as ResponsesApiOutput;
    const text = getResponseText(data);
    const parsed = parseJsonFromText(text) as ParsedTripsPayload | null;

    const trips = Array.isArray(parsed?.trips) ? parsed.trips : null;
    if (!trips || trips.length === 0) {
      reportProviderEvent({
        provider: "openai",
        operation: "generate_trip_copy",
        outcome: "live_unavailable",
        detail: "Responses API returned no usable trips payload.",
      });
      return {
        trips: null,
        status: "live_unavailable",
      };
    }

    const aiTrips: OpenAITripPayload[] = trips
      .map((trip: unknown): OpenAITripPayload => {
        const item = trip as Record<string, unknown>;

        return {
          name: safeString(item.name),
          aiSummary: safeString(item.aiSummary),
          aiBestFit: safeString(item.aiBestFit),
          aiBudgetNote: safeString(item.aiBudgetNote),
          aiItinerary: safeStringArray(item.aiItinerary),
        };
      })
      .filter(
        (trip: OpenAITripPayload) => Boolean(trip.name && trip.aiSummary)
      );

    if (aiTrips.length === 0) {
      reportProviderEvent({
        provider: "openai",
        operation: "generate_trip_copy",
        outcome: "fallback_used",
        detail: "Responses API payload parsed but usable trip fields were missing.",
      });
      return {
        trips: null,
        status: "fallback_used",
      };
    }

    return {
      trips: mergeAiFields(rankedTrips, aiTrips),
      status: "live_success",
    };
  } catch (error) {
    reportProviderEvent({
      provider: "openai",
      operation: "generate_trip_copy",
      outcome: "live_unavailable",
      error,
    });
    return {
      trips: null,
      status: "live_unavailable",
    };
  }
}
