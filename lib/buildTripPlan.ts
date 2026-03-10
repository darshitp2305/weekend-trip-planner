import { RankedDestination, TripInput, TripPlan, ItineraryDayData, BudgetBreakdown } from "./types";

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
  return `${trip.driveHoursFromStart} hour${trip.driveHoursFromStart === 1 ? "" : "s"}`;
}

function buildBudgetBreakdown(trip: RankedDestination, input: TripInput): BudgetBreakdown {
  const nights = Math.max(input.tripLengthDays - 1, 1);

  const hotelBase =
    trip.hotelOptions?.length > 0
      ? trip.hotelOptions[0].pricePerNight * nights
      : trip.budgetBreakdown?.hotel ?? 0;

  const foodBase =
    trip.budgetBreakdown?.food && trip.budgetBreakdown.food > 0
      ? trip.budgetBreakdown.food
      : input.tripLengthDays * 65;

  const gasBase =
    trip.isStaycation
      ? 0
      : trip.budgetBreakdown?.gas && trip.budgetBreakdown.gas > 0
      ? trip.budgetBreakdown.gas
      : Math.max(40, trip.driveHoursFromStart * 22);

  const activitiesBase =
    trip.topActivities?.reduce((sum, item) => sum + (item.costEstimate || 0), 0) ??
    trip.budgetBreakdown?.activities ??
    0;

  const miscBase = roundMoney((hotelBase + foodBase + gasBase + activitiesBase) * 0.1);

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

function buildDayOne(trip: RankedDestination, input: TripInput): ItineraryDayData {
  const activity1 = trip.topActivities[0];
  const activity2 = trip.topActivities[1];
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
    summary: "Get there, settle in, and avoid wasting day one by cramming too much into it.",
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
        time: "Late afternoon",
        title: activity1?.name ?? "First highlight",
        description: activity1
          ? `Start with ${activity1.name} as the easiest first win.`
          : "Start with one low-friction highlight.",
        websiteUrl: activity1?.bookingLink,
        estimatedCost: activity1?.costEstimate ?? 0,
      },
      {
        time: "Evening",
        title: food1?.name ?? "Dinner",
        description: food1
          ? `Dinner at ${food1.name}, then keep the night relaxed.`
          : "Dinner and an easy evening.",
        websiteUrl: food1?.link,
      },
      {
        time: "Optional",
        title: activity2?.name ?? "Optional extra stop",
        description: "Only do this if you still have energy.",
        websiteUrl: activity2?.bookingLink,
        estimatedCost: activity2?.costEstimate ?? 0,
      },
    ],
  };
}

function buildMiddleDay(trip: RankedDestination): ItineraryDayData {
  const activity1 = trip.topActivities[1] ?? trip.topActivities[0];
  const food1 = trip.foodSpots[0];
  const food2 = trip.foodSpots[1] ?? trip.foodSpots[0];
  const hotel = trip.hotelOptions[0];

  return {
    title: "Main exploration day",
    summary: "Use the strongest activity block here and let the day breathe.",
    stops: [
      {
        time: "Morning",
        title: food1?.name ?? "Breakfast / coffee",
        description: food1
          ? `Start slower around ${food1.name}.`
          : "Start with breakfast and a slower morning.",
        websiteUrl: food1?.link,
      },
      {
        time: "Afternoon",
        title: activity1?.name ?? "Main activity block",
        description: activity1
          ? "This is the anchor activity of the trip."
          : "Use this as the main daytime block.",
        websiteUrl: activity1?.bookingLink,
        estimatedCost: activity1?.costEstimate ?? 0,
      },
      {
        time: "Evening",
        title: food2?.name ?? "Dinner",
        description: food2
          ? `Wrap the day with dinner at ${food2.name}.`
          : "End with a good dinner instead of adding random filler.",
        websiteUrl: food2?.link,
      },
      {
        time: "Optional",
        title: hotel ? `Relax back at ${hotel.name}` : "Slow evening option",
        description: "Leave room for recovery instead of pretending every hour needs to be optimized.",
        websiteUrl: hotel?.bookingLink,
      },
    ],
  };
}

function buildReturnDay(trip: RankedDestination, input: TripInput): ItineraryDayData {
  const food1 = trip.foodSpots[0];
  const activity1 = trip.topActivities[2] ?? trip.topActivities[1] ?? trip.topActivities[0];

  if (trip.isStaycation) {
    return {
      title: "Second local day",
      summary: "Use day two for one more meaningful stop without travel friction.",
      stops: [
        {
          time: "Morning",
          title: food1?.name ?? "Brunch / coffee",
          description: food1
            ? `Start with another good local stop at ${food1.name}.`
            : "Start with brunch or coffee.",
          websiteUrl: food1?.link,
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
        title: food1?.name ?? "Breakfast / last local stop",
        description: "Get one more good local stop before leaving.",
        websiteUrl: food1?.link,
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
        description: "Head back without turning the final day into a scramble.",
      },
    ],
  };
}

export function buildTripPlan(
  trip: RankedDestination,
  input?: Partial<TripInput>
): TripPlan {
  const safeInput = normalizeInput(input);
  const days = Math.max(2, safeInput.tripLengthDays || 2);
  const budgetBreakdown = buildBudgetBreakdown(trip, safeInput);

  const itineraryDays: ItineraryDayData[] = [];
  itineraryDays.push(buildDayOne(trip, safeInput));

  if (days >= 3) {
    itineraryDays.push(buildMiddleDay(trip));
  }

  itineraryDays.push(buildReturnDay(trip, safeInput));

  if (days >= 4) {
    itineraryDays.splice(2, 0, buildMiddleDay(trip));
  }

  return {
    id: crypto.randomUUID(),
    destinationName: trip.name,
    region: trip.province,
    summary: trip.summary,
    driveTimeText: trip.isStaycation ? "0 hours" : makeDriveText(trip),
    score: trip.score,
    styleMatchStrength: trip.styleMatchStrength,
    tags: trip.rawVibes ?? [],
    budgetBreakdown,
    hotelOptions: trip.hotelOptions ?? [],
    foodSpots: trip.foodSpots ?? [],
    topActivities: trip.topActivities ?? [],
    itineraryDays,
    aiSummary: trip.aiSummary ?? "",
    aiBudgetNote: trip.aiBudgetNote ?? "",
    aiBestFit: trip.aiBestFit ?? "",
    createdAt: new Date().toISOString(),
  };
}