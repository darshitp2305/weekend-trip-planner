import { NextResponse } from "next/server";
import { generateTripCopyWithOpenAI } from "../../../lib/openAiTripCopy";
import { isStartCity } from "../../../lib/startCities";
import { deriveTripEndDate, isIsoDate } from "../../../lib/tripDates";
import { rankDestinations } from "../../../lib/rankDestinations";
import { RankedDestination, TripInput } from "../../../lib/types";

type GenerateTripSource = "live-openai" | "fallback-template";

type TripInputCandidate = Partial<TripInput> & {
  startCity?: unknown;
  maxDriveHours?: unknown;
  maxDriveMinutesBetweenStops?: unknown;
  budget?: unknown;
  budgetPerTraveler?: unknown;
  travelerCount?: unknown;
  tripLengthDays?: unknown;
  season?: unknown;
  style?: unknown;
  veganFriendly?: unknown;
  includeStaycations?: unknown;
  strictBudget?: unknown;
  preferredDestination?: unknown;
  tripStartDate?: unknown;
  tripEndDate?: unknown;
};

type GenerateTripBody = {
  input?: unknown;
  results?: RankedDestination[];
  trips?: RankedDestination[];
  destinations?: RankedDestination[];
  rankings?: RankedDestination[];
};


function isTripInput(value: unknown): value is TripInput {
  const candidate = value as TripInputCandidate;

  return Boolean(
    value &&
    typeof value === "object" &&
    isStartCity(candidate.startCity) &&
    typeof candidate.maxDriveHours === "number" &&
    typeof candidate.maxDriveMinutesBetweenStops === "number" &&
    typeof candidate.budget === "number" &&
    typeof candidate.budgetPerTraveler === "number" &&
    typeof candidate.travelerCount === "number" &&
    typeof candidate.tripLengthDays === "number" &&
    typeof candidate.season === "string" &&
    typeof candidate.style === "string" &&
    typeof candidate.veganFriendly === "boolean" &&
    typeof candidate.includeStaycations === "boolean" &&
    typeof candidate.strictBudget === "boolean" &&
    (candidate.preferredDestination === undefined ||
      typeof candidate.preferredDestination === "string") &&
    (candidate.tripStartDate === undefined ||
      typeof candidate.tripStartDate === "string") &&
    (candidate.tripEndDate === undefined || typeof candidate.tripEndDate === "string")
  );
}

function normalizeInput(raw: unknown): TripInput | null {
  if (!raw || typeof raw !== "object") return null;
  const candidateInput = raw as TripInputCandidate;

  const travelerCount = Number(candidateInput.travelerCount);
  const budgetPerTraveler = Number(candidateInput.budgetPerTraveler);
  const tripStartDate = isIsoDate(candidateInput.tripStartDate)
    ? candidateInput.tripStartDate
    : undefined;
  const tripLengthDays = Number(candidateInput.tripLengthDays);

  const candidate = {
    startCity: candidateInput.startCity,
    maxDriveHours: Number(candidateInput.maxDriveHours),
    maxDriveMinutesBetweenStops: Number(
      candidateInput.maxDriveMinutesBetweenStops
    ),
    budget: travelerCount * budgetPerTraveler,
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    season: candidateInput.season,
    style: candidateInput.style,
    veganFriendly: Boolean(candidateInput.veganFriendly),
    includeStaycations: Boolean(candidateInput.includeStaycations),
    strictBudget: Boolean(candidateInput.strictBudget),
    preferredDestination:
      typeof candidateInput.preferredDestination === "string"
        ? candidateInput.preferredDestination.trim() || undefined
        : undefined,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
  };

  if (!isTripInput(candidate)) return null;
  return candidate;
}

function extractInputFromBody(
  body: GenerateTripBody | null | undefined
): TripInput | null {
  const nestedInput = normalizeInput(body?.input);
  if (nestedInput) return nestedInput;

  const directInput = normalizeInput(body);
  if (directInput) return directInput;

  return null;
}

function extractRankedTripsFromBody(
  body: GenerateTripBody | null | undefined
): RankedDestination[] | null {
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.trips)) return body.trips;
  if (Array.isArray(body?.destinations)) return body.destinations;
  if (Array.isArray(body?.rankings)) return body.rankings;
  return null;
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
        .filter(
          (name): name is string => typeof name === "string" && name.length > 0
        )
    : [];
}

function buildFallbackAiContent(
  trip: RankedDestination,
  input: TripInput
): RankedDestination {
  const activities = topActivityNames(trip);
  const firstActivity = activities[0];
  const secondActivity = activities[1] ?? activities[0];

  const aiSummary = `${trip.name} is a strong ${input.style} pick from ${
    input.startCity
  }, with ${getDriveTone(trip)} and ${getBudgetTone(
    trip,
    input
  )} pricing for ${input.travelerCount} traveler${
    input.travelerCount === 1 ? "" : "s"
  } over a ${input.tripLengthDays}-day trip.${
    input.veganFriendly && !trip.veganFriendly
      ? " Vegan support may need a bit more planning."
      : ""
  }`;

  const aiBestFit = `Best for a ${input.style}-focused weekend that balances drive time, cost, and trip value for ${input.travelerCount} traveler${
    input.travelerCount === 1 ? "" : "s"
  }.`;

  const estimatedPerTraveler = Math.round(
    trip.estimatedCost / Math.max(1, input.travelerCount)
  );

  const aiBudgetNote =
    trip.estimatedCost <= input.budget
      ? `This trip stays within your stated group budget at about $${Math.round(
          trip.estimatedCost
        )} total, or roughly $${estimatedPerTraveler} per traveler.`
      : `This trip is estimated around $${Math.round(
          trip.estimatedCost
        )} total, or roughly $${estimatedPerTraveler} per traveler, so it may stretch your budget slightly.`;

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateTripBody;
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

    const openAiResult = await generateTripCopyWithOpenAI(input, rankedTrips);
    if (openAiResult.trips) {
      return NextResponse.json({
        success: true,
        source: "live-openai" satisfies GenerateTripSource,
        results: openAiResult.trips.map((trip) => ({
          ...trip,
          providerStatus: {
            ...trip.providerStatus,
            tripCopy: openAiResult.status,
          },
        })),
      });
    }

    const fallbackTrips = rankedTrips.map((trip) =>
      ({
        ...buildFallbackAiContent(trip, input),
        providerStatus: {
          ...trip.providerStatus,
          tripCopy: openAiResult.status,
        },
      })
    );

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
