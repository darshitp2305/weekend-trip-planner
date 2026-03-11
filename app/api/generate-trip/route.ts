import { NextResponse } from "next/server";
import { rankDestinations } from "../../../lib/rankDestinations";
import { RankedDestination, TripInput } from "../../../lib/types";

type GenerateTripSource = "live-openai" | "fallback-template";

type OpenAITripPayload = {
  name: string;
  aiSummary: string;
  aiBestFit: string;
  aiBudgetNote: string;
  aiItinerary: string[];
};

function isTripInput(value: any): value is TripInput {
  return (
    value &&
    typeof value === "object" &&
    (value.startCity === "Edmonton" || value.startCity === "Calgary") &&
    typeof value.maxDriveHours === "number" &&
    typeof value.budget === "number" &&
    typeof value.tripLengthDays === "number" &&
    typeof value.season === "string" &&
    typeof value.style === "string" &&
    typeof value.veganFriendly === "boolean" &&
    typeof value.includeStaycations === "boolean" &&
    typeof value.strictBudget === "boolean"
  );
}

function normalizeInput(raw: any): TripInput | null {
  if (!raw || typeof raw !== "object") return null;

  const candidate = {
    startCity: raw.startCity,
    maxDriveHours: Number(raw.maxDriveHours),
    budget: Number(raw.budget),
    tripLengthDays: Number(raw.tripLengthDays),
    season: raw.season,
    style: raw.style,
    veganFriendly: Boolean(raw.veganFriendly),
    includeStaycations: Boolean(raw.includeStaycations),
    strictBudget: Boolean(raw.strictBudget),
  };

  if (!isTripInput(candidate)) return null;
  return candidate;
}

function extractInputFromBody(body: any): TripInput | null {
  const nestedInput = normalizeInput(body?.input);
  if (nestedInput) return nestedInput;

  const directInput = normalizeInput(body);
  if (directInput) return directInput;

  return null;
}

function extractRankedTripsFromBody(body: any): RankedDestination[] | null {
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.trips)) return body.trips;
  if (Array.isArray(body?.destinations)) return body.destinations;
  if (Array.isArray(body?.rankings)) return body.rankings;
  return null;
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonFromText(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try fenced code block
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/);
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

function getResponseText(data: any): string {
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

function getBudgetTone(trip: RankedDestination, input: TripInput): string {
  const ratio = trip.estimatedCost / input.budget;

  if (ratio <= 0.65) return "very budget-friendly";
  if (ratio <= 0.85) return "comfortably within budget";
  if (ratio <= 1.0) return "within budget";
  return "a slight budget stretch";
}

function getDriveTone(trip: RankedDestination): string {
  if (trip.driveHoursFromStart <= 1.5) return "an easy drive";
  if (trip.driveHoursFromStart <= 3) return "a manageable drive";
  if (trip.driveHoursFromStart <= 5) return "a worthwhile medium drive";
  return "a longer drive that needs stronger trip value";
}

function topActivityNames(trip: RankedDestination): string[] {
  return Array.isArray(trip.topActivities)
    ? trip.topActivities
        .map((item) => item?.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
}

function buildFallbackAiContent(
  trip: RankedDestination,
  input: TripInput
): RankedDestination {
  const activities = topActivityNames(trip);
  const firstActivity = activities[0];
  const secondActivity = activities[1] ?? activities[0];

  const aiSummary = `${trip.name} is a strong ${input.style} pick from ${input.startCity}, with ${getDriveTone(
    trip
  )} and ${getBudgetTone(trip, input)} pricing for a ${input.tripLengthDays}-day trip.${
    input.veganFriendly && !trip.veganFriendly
      ? " Vegan support may need a bit more planning."
      : ""
  }`;

  const aiBestFit = `Best for a ${input.style}-focused weekend that balances drive time, cost, and trip value.`;

  const aiBudgetNote =
    trip.estimatedCost <= input.budget
      ? `This trip stays within your stated budget at about $${Math.round(trip.estimatedCost)}.`
      : `This trip is estimated around $${Math.round(
          trip.estimatedCost
        )}, so it may stretch your budget slightly.`;

  const aiItinerary =
    input.tripLengthDays > 2
      ? [
          `Day 1: Travel from ${input.startCity} to ${trip.name} and use one anchor stop${
            firstActivity ? ` like ${firstActivity}` : ""
          } to start the trip.`,
          `Day 2: Build the middle of the trip around your most important activity${
            secondActivity ? ` such as ${secondActivity}` : ""
          }.`,
          `Day ${input.tripLengthDays}: Keep the final day lighter and return to ${input.startCity} with enough drive buffer.`,
        ]
      : [
          `Day 1: Travel from ${input.startCity} to ${trip.name} and use one anchor stop${
            firstActivity ? ` like ${firstActivity}` : ""
          } to start the trip.`,
          `Day 2: Center the day on one main activity${
            secondActivity ? ` such as ${secondActivity}` : ""
          }, then return to ${input.startCity}.`,
        ];

  return {
    ...trip,
    aiSummary,
    aiBestFit,
    aiBudgetNote,
    aiItinerary,
  };
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

async function generateWithOpenAI(
  input: TripInput,
  rankedTrips: RankedDestination[]
): Promise<RankedDestination[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

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

  const systemPrompt = [
    "You are writing destination-specific weekend trip copy for a trip planning app.",
    "Return ONLY valid JSON.",
    "Do not use markdown fences.",
    "Do not repeat the same wording across all trips.",
    "Make each destination feel distinct.",
    "Use concrete local differences from the provided trip data.",
    "Keep each field concise and natural.",
    "aiItinerary must be an array of short strings.",
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
      trips: compactTrips,
    },
    null,
    2
  );

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
    console.error("OpenAI responses call failed:", response.status, errorText);
    return null;
  }

  const data = await response.json();
  const text = getResponseText(data);
  const parsed = parseJsonFromText(text);

  const trips = Array.isArray(parsed?.trips) ? parsed.trips : null;
  if (!trips || trips.length === 0) {
    console.error("OpenAI returned no usable trips payload:", parsed ?? text);
    return null;
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
  .filter((trip: OpenAITripPayload) => Boolean(trip.name && trip.aiSummary));

  if (aiTrips.length === 0) {
    console.error("OpenAI payload parsed but fields were unusable:", parsed);
    return null;
  }

  return mergeAiFields(rankedTrips, aiTrips);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = extractInputFromBody(body);

    if (!input) {
      return NextResponse.json(
        { error: "Invalid request body. Could not extract a valid TripInput." },
        { status: 400 }
      );
    }

    let rankedTrips = extractRankedTripsFromBody(body);
    if (!rankedTrips || rankedTrips.length === 0) {
      rankedTrips = rankDestinations(input);
    }

    const openAiTrips = await generateWithOpenAI(input, rankedTrips);
    if (openAiTrips) {
      return NextResponse.json({
        success: true,
        source: "live-openai" satisfies GenerateTripSource,
        results: openAiTrips,
      });
    }

    const fallbackTrips = rankedTrips.map((trip) => buildFallbackAiContent(trip, input));

    return NextResponse.json({
      success: true,
      source: "fallback-template" satisfies GenerateTripSource,
      results: fallbackTrips,
    });
  } catch (error) {
    console.error("Generate trip route failed:", error);

    return NextResponse.json(
      { error: "Failed to generate trip content." },
      { status: 500 }
    );
  }
}