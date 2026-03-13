import {
  BudgetBreakdown,
  ItineraryDayData,
  RankedDestination,
  TripDataSource,
  TripInput,
  TripPlan,
} from "./types";

const defaultInput: TripInput = {
  startCity: "Edmonton",
  maxDriveHours: 5,
  budget: 600,
  tripLengthDays: 2,
  season: "Summer",
  style: "foodie",
  veganFriendly: false,
  includeStaycations: true,
  strictBudget: false,
};

function normalizeInput(input?: Partial<TripInput>): TripInput {
  return {
    ...defaultInput,
    ...input,
  };
}

function roundMoney(value: number) {
  return Math.round(value);
}

function makeDriveText(trip: RankedDestination) {
  return `${trip.driveHoursFromStart} hour${
    trip.driveHoursFromStart === 1 ? "" : "s"
  }`;
}

function buildBudgetBreakdown(
  trip: RankedDestination,
  input: TripInput
): BudgetBreakdown {
  const nights = Math.max(input.tripLengthDays - 1, 1);

  const hotelBase =
    trip.hotelOptions?.length > 0
      ? trip.hotelOptions[0].pricePerNight * nights
      : trip.budgetBreakdown?.hotel ?? 0;

  const foodBase =
    trip.budgetBreakdown?.food && trip.budgetBreakdown.food > 0
      ? trip.budgetBreakdown.food
      : input.tripLengthDays * 65;

  const gasBase = trip.isStaycation
    ? 0
    : trip.budgetBreakdown?.gas && trip.budgetBreakdown.gas > 0
    ? trip.budgetBreakdown.gas
    : Math.max(40, trip.driveHoursFromStart * 22);

  const activitiesBase =
    trip.topActivities?.reduce(
      (sum, item) => sum + (item.costEstimate || 0),
      0
    ) ?? trip.budgetBreakdown?.activities ?? 0;

  const miscBase = roundMoney(
    (hotelBase + foodBase + gasBase + activitiesBase) * 0.1
  );

  const totalExpected = roundMoney(
    hotelBase + foodBase + gasBase + activitiesBase + miscBase
  );

  return {
    hotel: roundMoney(hotelBase),
    food: roundMoney(foodBase),
    gas: roundMoney(gasBase),
    activities: roundMoney(activitiesBase),
    misc: miscBase,
    total: totalExpected,
    totalLow: roundMoney(totalExpected * 0.9),
    totalExpected,
    totalHigh: roundMoney(totalExpected * 1.15),
  };
}

function buildDayOne(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData {
  const activity1 = trip.topActivities[0];
  const food1 = trip.foodSpots[0];
  const hotel = trip.hotelOptions[0];

  if (trip.isStaycation) {
    return {
      title: "Local reset day",
      summary: `Low-friction ${input.style} day with basically no travel overhead.`,
      stops: [
        {
          time: "Morning",
          title: "Brunch / coffee start",
          description: food1
            ? `Start with food at ${food1.name}.`
            : "Start with a strong local brunch or coffee stop.",
          websiteUrl: food1?.link,
        },
        {
          time: "Afternoon",
          title: activity1?.name ?? "Main local activity",
          description: activity1
            ? `Use ${activity1.name} as the anchor activity for the afternoon.`
            : "Pick one anchor activity instead of overplanning the whole day.",
          websiteUrl: activity1?.bookingLink,
          estimatedCost: activity1?.costEstimate ?? 0,
        },
        {
          time: "Evening",
          title: "Dinner and relaxed evening",
          description: trip.aiSummary || "Keep the evening easy and enjoyable.",
        },
      ],
    };
  }

  return {
    title: "Arrival and easy first day",
    summary:
      "Get there, settle in, and avoid wasting day one by cramming too much into it.",
    stops: [
      {
        time: "Morning",
        title: `Drive from ${input.startCity} to ${trip.name}`,
        description: `Estimated drive: ${makeDriveText(trip)}.`,
      },
      {
        time: "Afternoon",
        title: hotel ? `Check in at ${hotel.name}` : "Check in and settle in",
        description: hotel
          ? `Use ${hotel.name} as your base, then start light.`
          : `Settle in near ${trip.homeBaseCity}.`,
        websiteUrl: hotel?.bookingLink,
      },
      {
        time: "Evening",
        title: food1?.name ?? "Dinner",
        description: food1
          ? `Dinner at ${food1.name}, then keep the night relaxed.`
          : "Dinner and an easy evening.",
        websiteUrl: food1?.link,
      },
    ],
  };
}

function buildReturnDay(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData {
  const food1 = trip.foodSpots[0];
  const food2 = trip.foodSpots[1] ?? trip.foodSpots[0];
  const activity1 = trip.topActivities[1] ?? trip.topActivities[0];

  if (trip.isStaycation) {
    return {
      title: "Second local day",
      summary:
        "Use day two for one more meaningful stop without travel friction.",
      stops: [
        {
          time: "Morning",
          title: food2?.name ?? "Brunch / coffee",
          description: food2
            ? `Start with another good local stop at ${food2.name}.`
            : "Start with brunch or coffee.",
          websiteUrl: food2?.link,
        },
        {
          time: "Afternoon",
          title: activity1?.name ?? "Flexible local highlight",
          description: activity1
            ? `Use ${activity1.name} as the second-day anchor.`
            : "Choose one more meaningful stop, then keep the rest flexible.",
          websiteUrl: activity1?.bookingLink,
          estimatedCost: activity1?.costEstimate ?? 0,
        },
      ],
    };
  }

  return {
    title: "Final half-day and drive back",
    summary: `Keep the final day lighter so the return to ${input.startCity} does not feel rushed.`,
    stops: [
      {
        time: "Morning",
        title: food2?.name ?? "Breakfast / last local stop",
        description: food2
          ? `Get one more good local stop at ${food2.name} before leaving.`
          : "Get one more good local stop before leaving.",
        websiteUrl: food2?.link,
      },
      {
        time: "Late morning",
        title: activity1?.name ?? "One final highlight",
        description: "Optional final stop before the drive home.",
        websiteUrl: activity1?.bookingLink,
        estimatedCost: activity1?.costEstimate ?? 0,
      },
      {
        time: "Afternoon",
        title: `Drive back to ${input.startCity}`,
        description:
          "Head back without turning the final day into a scramble.",
      },
    ],
  };
}

export function buildTripPlan(
  trip: RankedDestination,
  input?: Partial<TripInput>,
  dataSource: TripDataSource = "static-fallback"
): TripPlan {
  const safeInput = normalizeInput(input);
  const budgetBreakdown = buildBudgetBreakdown(trip, safeInput);

  const itineraryDays: ItineraryDayData[] = [];
  itineraryDays.push(buildDayOne(trip, safeInput));
  itineraryDays.push(buildReturnDay(trip, safeInput));

  return {
    id: crypto.randomUUID(),
    destinationName: trip.name,
    region: trip.province,
    summary: trip.summary,
    imageUrl: trip.imageUrl,
    driveTimeText: trip.isStaycation ? "0 hours" : makeDriveText(trip),
    score: trip.score,
    styleMatchStrength: trip.styleMatchStrength,
    confidence: trip.confidence,
    liveDataSummary: trip.liveDataSummary,
    rankingReasons: trip.rankingReasons ?? [],
    tags: trip.rawVibes ?? [],
    budgetBreakdown,
    hotelOptions: trip.hotelOptions ?? [],
    foodSpots: trip.foodSpots ?? [],
    topActivities: trip.topActivities ?? [],
    itineraryDays,
    aiSummary: trip.aiSummary ?? "",
    aiBudgetNote: trip.aiBudgetNote ?? "",
    aiBestFit: trip.aiBestFit ?? "",
    dataSource,
    createdAt: new Date().toISOString(),
  };
}