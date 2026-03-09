import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { rankDestinations } from "../../../lib/rankDestinations";
import { TripInput, RankedDestination } from "../../../lib/types";
import { buildTripPrompt } from "../../../lib/promptBuilder";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const USE_FAKE_AI = process.env.USE_FAKE_AI === "true";

function formatStyleStrength(strength: RankedDestination["styleMatchStrength"]) {
  switch (strength) {
    case "strong":
      return "strong";
    case "medium":
      return "good";
    case "weak":
      return "light";
    default:
      return "limited";
  }
}

function buildFakeEnrichment(rankedTrips: RankedDestination[]) {
  return {
    trips: rankedTrips.map((trip) => {
      const activity1 = trip.topActivities[0]?.name ?? "a local highlight";
      const activity2 = trip.topActivities[1]?.name ?? "a second local activity";
      const styleTone = formatStyleStrength(trip.styleMatchStrength);

      const cleanedReason =
        trip.matchReasons[0]
          ?.replace(/^Strong /, "")
          ?.replace(/^Good /, "")
          ?.replace(/^Some /, "")
          ?.toLowerCase() ?? "trip fit";

      return {
        name: trip.name,
        aiSummary: `${trip.name} looks like a ${styleTone} fit for this trip based on your selected style, budget, and drive limit.`,
        aiItinerary: [
          `Day 1: Travel to ${trip.name}, settle in near ${trip.homeBaseCity}, and check out ${activity1}.`,
          `Day 2: Spend time at ${activity2} and wrap up the trip before heading back.`,
        ],
        aiBudgetNote:
          trip.budgetBreakdown.total <= 0
            ? "This estimate should be reviewed manually."
            : `This option is estimated at about $${trip.budgetBreakdown.total}, which fits the current prototype budget logic.`,
        aiBestFit: `Best for someone who wants a ${styleTone} ${cleanedReason}.`,
      };
    }),
  };
}

type AITrip = {
  name: string;
  aiSummary: string;
  aiItinerary: string[];
  aiBudgetNote: string;
  aiBestFit: string;
};

type AIResult = {
  trips: AITrip[];
};

function hasAIContent(result: AIResult | null | undefined) {
  return !!result?.trips?.some(
    (trip) =>
      trip.aiSummary?.trim() ||
      trip.aiBudgetNote?.trim() ||
      trip.aiBestFit?.trim() ||
      (Array.isArray(trip.aiItinerary) && trip.aiItinerary.length > 0)
  );
}

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as TripInput;
    const rankedTrips = rankDestinations(input);

    if (rankedTrips.length === 0) {
      return NextResponse.json({
        success: true,
        trips: [],
        mode: USE_FAKE_AI ? "fake-ai" : "real-ai",
      });
    }

    if (USE_FAKE_AI) {
      const enriched = buildFakeEnrichment(rankedTrips);

      const mergedTrips: RankedDestination[] = rankedTrips.map((trip) => {
        const aiTrip = enriched.trips.find((t) => t.name === trip.name);

        return {
          ...trip,
          aiSummary: aiTrip?.aiSummary ?? "",
          aiItinerary: aiTrip?.aiItinerary ?? [],
          aiBudgetNote: aiTrip?.aiBudgetNote ?? "",
          aiBestFit: aiTrip?.aiBestFit ?? "",
        };
      });

      return NextResponse.json({
        success: true,
        trips: mergedTrips,
        mode: "fake-ai",
      });
    }

    const prompt = buildTripPrompt(input, rankedTrips);

    const response = await client.responses.create({
      model: "gpt-4.1",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "trip_enrichment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              trips: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    aiSummary: { type: "string" },
                    aiItinerary: {
                      type: "array",
                      items: { type: "string" },
                    },
                    aiBudgetNote: { type: "string" },
                    aiBestFit: { type: "string" },
                  },
                  required: [
                    "name",
                    "aiSummary",
                    "aiItinerary",
                    "aiBudgetNote",
                    "aiBestFit",
                  ],
                },
              },
            },
            required: ["trips"],
          },
        },
      },
    });

    const rawText = response.output_text;

    let enriched: AIResult | null = null;

    try {
      enriched = JSON.parse(rawText) as AIResult;
    } catch (parseError) {
      console.error("Failed to parse structured AI response:", rawText);
      enriched = null;
    }

    const mergedTrips: RankedDestination[] = rankedTrips.map((trip) => {
      const aiTrip = enriched?.trips?.find((t) => t.name === trip.name);

      return {
        ...trip,
        aiSummary: aiTrip?.aiSummary ?? "",
        aiItinerary: aiTrip?.aiItinerary ?? [],
        aiBudgetNote: aiTrip?.aiBudgetNote ?? "",
        aiBestFit: aiTrip?.aiBestFit ?? "",
      };
    });

    return NextResponse.json({
      success: true,
      trips: mergedTrips,
      mode: hasAIContent(enriched) ? "real-ai" : "real-ai-empty",
    });
  } catch (error: unknown) {
    console.error("Generate trip route failed:", error);

    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}