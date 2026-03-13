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
    maxDriveHours: Number(input?.maxDriveHours ?? defaultInput.maxDriveHours),
    budget: Number(input?.budget ?? defaultInput.budget),
    tripLengthDays: Number(input?.tripLengthDays ?? defaultInput.tripLengthDays),
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

function pickUniqueFoodSpots(trip: RankedDestination) {
  const foods = trip.foodSpots ?? [];
  return {
    first: foods[0],
    second: foods[1] ?? foods[0],
    third: foods[2] ?? foods[1] ?? foods[0],
  };
}

function pickUniqueActivities(trip: RankedDestination) {
  const activities = trip.topActivities ?? [];
  return {
    first: activities[0],
    second: activities[1] ?? activities[0],
    third: activities[2] ?? activities[1] ?? activities[0],
  };
}

function buildStaycationDayOne(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData {
  const foods = pickUniqueFoodSpots(trip);
  const activities = pickUniqueActivities(trip);

  return {
    title: "Local reset day",
    summary: `Low-friction ${input.style} day with basically no travel overhead.`,
    stops: [
      {
        time: "Morning",
        title: foods.first?.name ?? "Brunch / coffee start",
        description: foods.first
          ? `Start with food at ${foods.first.name}.`
          : "Start with a strong local brunch or coffee stop.",
        websiteUrl: foods.first?.link,
      },
      {
        time: "Afternoon",
        title: activities.first?.name ?? "Main local activity",
        description: activities.first
          ? `Use ${activities.first.name} as the anchor activity for the afternoon.`
          : "Pick one anchor activity instead of overplanning the whole day.",
        websiteUrl: activities.first?.bookingLink,
        estimatedCost: activities.first?.costEstimate ?? 0,
      },
      {
        time: "Evening",
        title: foods.second?.name ?? "Dinner and relaxed evening",
        description: foods.second
          ? `Wrap up with food at ${foods.second.name}.`
          : trip.aiSummary || "Keep the evening easy and enjoyable.",
        websiteUrl: foods.second?.link,
      },
    ],
  };
}

function buildStaycationDayTwo(
  trip: RankedDestination
): ItineraryDayData {
  const foods = pickUniqueFoodSpots(trip);
  const activities = pickUniqueActivities(trip);

  return {
    title: "Second local day",
    summary:
      "Use day two for one more meaningful stop without travel friction.",
    stops: [
      {
        time: "Morning",
        title: foods.third?.name ?? "Brunch / coffee",
        description: foods.third
          ? `Start with another good local stop at ${foods.third.name}.`
          : "Start with brunch or coffee.",
        websiteUrl: foods.third?.link,
      },
      {
        time: "Afternoon",
        title: activities.second?.name ?? "Flexible local highlight",
        description: activities.second
          ? `Use ${activities.second.name} as the second-day anchor.`
          : "Choose one more meaningful stop, then keep the rest flexible.",
        websiteUrl: activities.second?.bookingLink,
        estimatedCost: activities.second?.costEstimate ?? 0,
      },
    ],
  };
}

function buildGetawayDayOne(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData {
  const foods = pickUniqueFoodSpots(trip);
  const hotel = trip.hotelOptions?.[0];

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
        title: foods.first?.name ?? "Dinner",
        description: foods.first
          ? `Dinner at ${foods.first.name}, then keep the night relaxed.`
          : "Dinner and an easy evening.",
        websiteUrl: foods.first?.link,
      },
    ],
  };
}

function buildGetawayDayTwo(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData {
  const foods = pickUniqueFoodSpots(trip);
  const activities = pickUniqueActivities(trip);

  return {
    title: "Final half-day and drive back",
    summary: `Keep the final day lighter so the return to ${input.startCity} does not feel rushed.`,
    stops: [
      {
        time: "Morning",
        title: foods.second?.name ?? "Breakfast / last local stop",
        description: foods.second
          ? `Get one more good local stop at ${foods.second.name} before leaving.`
          : "Get one more good local stop before leaving.",
        websiteUrl: foods.second?.link,
      },
      {
        time: "Late morning",
        title: activities.first?.name ?? "One final highlight",
        description: "Optional final stop before the drive home.",
        websiteUrl: activities.first?.bookingLink,
        estimatedCost: activities.first?.costEstimate ?? 0,
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

function buildMiddleDay(
  trip: RankedDestination,
  input: TripInput,
  dayNumber: number
): ItineraryDayData {
  const foods = pickUniqueFoodSpots(trip);
  const activities = pickUniqueActivities(trip);

  const breakfastSpot = foods.second ?? foods.first;
  const lunchSpot = foods.third ?? foods.second ?? foods.first;
  const mainActivity = activities.first;
  const secondActivity = activities.second;

  return {
    title: `Core experience day ${dayNumber}`,
    summary: `Use the middle of the trip for the strongest ${input.style} anchors instead of wasting it on logistics.`,
    stops: [
      {
        time: "Morning",
        title: breakfastSpot?.name ?? "Breakfast / coffee",
        description: breakfastSpot
          ? `Start the day at ${breakfastSpot.name}.`
          : "Start the day with breakfast or coffee.",
        websiteUrl: breakfastSpot?.link,
      },
      {
        time: "Late morning",
        title: mainActivity?.name ?? "Main activity",
        description: mainActivity
          ? `Use ${mainActivity.name} as the main daytime anchor.`
          : "Use one meaningful anchor stop for the morning.",
        websiteUrl: mainActivity?.bookingLink,
        estimatedCost: mainActivity?.costEstimate ?? 0,
      },
      {
        time: "Afternoon",
        title: secondActivity?.name ?? "Flexible second stop",
        description: secondActivity
          ? `Add ${secondActivity.name} if you still have energy.`
          : "Keep the afternoon flexible instead of overpacking it.",
        websiteUrl: secondActivity?.bookingLink,
        estimatedCost: secondActivity?.costEstimate ?? 0,
      },
      {
        time: "Evening",
        title: lunchSpot?.name ?? "Dinner",
        description: lunchSpot
          ? `Finish with dinner at ${lunchSpot.name}.`
          : "Finish with a strong dinner stop.",
        websiteUrl: lunchSpot?.link,
      },
    ],
  };
}

function buildItineraryDays(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData[] {
  if (trip.isStaycation) {
    if (input.tripLengthDays <= 1) {
      return [buildStaycationDayOne(trip, input)];
    }

    if (input.tripLengthDays === 2) {
      return [buildStaycationDayOne(trip, input), buildStaycationDayTwo(trip)];
    }

    const days: ItineraryDayData[] = [buildStaycationDayOne(trip, input)];
    for (let day = 2; day < input.tripLengthDays; day += 1) {
      days.push(buildMiddleDay(trip, input, day));
    }
    days.push(buildStaycationDayTwo(trip));
    return days;
  }

  if (input.tripLengthDays <= 1) {
    return [buildGetawayDayOne(trip, input)];
  }

  if (input.tripLengthDays === 2) {
    return [buildGetawayDayOne(trip, input), buildGetawayDayTwo(trip, input)];
  }

  const days: ItineraryDayData[] = [buildGetawayDayOne(trip, input)];
  for (let day = 2; day < input.tripLengthDays; day += 1) {
    days.push(buildMiddleDay(trip, input, day));
  }
  days.push(buildGetawayDayTwo(trip, input));
  return days;
}

export function buildTripPlan(
  trip: RankedDestination,
  input?: Partial<TripInput>,
  dataSource: TripDataSource = "static-fallback"
): TripPlan {
  const safeInput = normalizeInput(input);
  const budgetBreakdown = buildBudgetBreakdown(trip, safeInput);
  const itineraryDays = buildItineraryDays(trip, safeInput);

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