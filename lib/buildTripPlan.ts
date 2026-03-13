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

type FoodSpot = NonNullable<RankedDestination["foodSpots"]>[number];
type ActivitySpot = NonNullable<RankedDestination["topActivities"]>[number];

type BuildContext = {
  foods: FoodSpot[];
  activities: ActivitySpot[];
  usedFoodNames: Set<string>;
  usedActivityNames: Set<string>;
  previousDayFoodNames: Set<string>;
  previousDayActivityNames: Set<string>;
};

function dedupeByName<T extends { name?: string }>(items: T[] | undefined): T[] {
  if (!items?.length) return [];

  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = (item.name ?? "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function itemName(item?: { name?: string }) {
  return (item?.name ?? "").trim().toLowerCase();
}

function markFoodUsed(ctx: BuildContext, item?: FoodSpot) {
  const key = itemName(item);
  if (key) ctx.usedFoodNames.add(key);
}

function markActivityUsed(ctx: BuildContext, item?: ActivitySpot) {
  const key = itemName(item);
  if (key) ctx.usedActivityNames.add(key);
}

function setPreviousDayFoods(ctx: BuildContext, items: Array<FoodSpot | undefined>) {
  ctx.previousDayFoodNames = new Set(
    items.map(itemName).filter(Boolean)
  );
}

function setPreviousDayActivities(
  ctx: BuildContext,
  items: Array<ActivitySpot | undefined>
) {
  ctx.previousDayActivityNames = new Set(
    items.map(itemName).filter(Boolean)
  );
}

function pickBestItem<T extends { name?: string }>(
  items: T[],
  options: {
    usedNames: Set<string>;
    previousDayNames: Set<string>;
    blockedNames?: Set<string>;
  }
): T | undefined {
  const { usedNames, previousDayNames, blockedNames = new Set<string>() } = options;

  const available = items.filter((item) => {
    const key = itemName(item);
    return Boolean(key) && !blockedNames.has(key);
  });

  if (available.length === 0) return undefined;

  const tiers = [
    available.filter((item) => {
      const key = itemName(item);
      return !usedNames.has(key) && !previousDayNames.has(key);
    }),
    available.filter((item) => {
      const key = itemName(item);
      return !usedNames.has(key);
    }),
    available.filter((item) => {
      const key = itemName(item);
      return !previousDayNames.has(key);
    }),
    available,
  ];

  for (const tier of tiers) {
    if (tier.length > 0) return tier[0];
  }

  return available[0];
}

function pickFood(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
): FoodSpot | undefined {
  const picked = pickBestItem(ctx.foods, {
    usedNames: ctx.usedFoodNames,
    previousDayNames: ctx.previousDayFoodNames,
    blockedNames,
  });

  markFoodUsed(ctx, picked);
  return picked;
}

function pickActivity(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
): ActivitySpot | undefined {
  const picked = pickBestItem(ctx.activities, {
    usedNames: ctx.usedActivityNames,
    previousDayNames: ctx.previousDayActivityNames,
    blockedNames,
  });

  markActivityUsed(ctx, picked);
  return picked;
}

function buildContext(trip: RankedDestination): BuildContext {
  return {
    foods: dedupeByName(trip.foodSpots),
    activities: dedupeByName(trip.topActivities),
    usedFoodNames: new Set<string>(),
    usedActivityNames: new Set<string>(),
    previousDayFoodNames: new Set<string>(),
    previousDayActivityNames: new Set<string>(),
  };
}

function buildStaycationDayOne(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickFood(ctx);
  const activity = pickActivity(ctx);
  const dinner = pickFood(ctx, new Set([itemName(breakfast)]));

  setPreviousDayFoods(ctx, [breakfast, dinner]);
  setPreviousDayActivities(ctx, [activity]);

  return {
    title: "Local reset day",
    summary: `Low-friction ${input.style} day with basically no travel overhead.`,
    stops: [
      {
        time: "Morning",
        title: breakfast?.name ?? "Brunch / coffee start",
        description: breakfast
          ? `Start with food at ${breakfast.name}.`
          : "Start with a strong local brunch or coffee stop.",
        websiteUrl: breakfast?.link,
      },
      {
        time: "Afternoon",
        title: activity?.name ?? "Main local activity",
        description: activity
          ? `Use ${activity.name} as the anchor activity for the afternoon.`
          : "Pick one anchor activity instead of overplanning the whole day.",
        websiteUrl: activity?.bookingLink,
        estimatedCost: activity?.costEstimate ?? 0,
      },
      {
        time: "Evening",
        title: dinner?.name ?? "Dinner and relaxed evening",
        description: dinner
          ? `Wrap up with food at ${dinner.name}.`
          : trip.aiSummary || "Keep the evening easy and enjoyable.",
        websiteUrl: dinner?.link,
      },
    ],
  };
}

function buildStaycationFinalDay(
  trip: RankedDestination,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickFood(ctx);
  const activity = pickActivity(ctx);

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [activity]);

  return {
    title: "Second local day",
    summary:
      "Use day two for one more meaningful stop without travel friction.",
    stops: [
      {
        time: "Morning",
        title: breakfast?.name ?? "Brunch / coffee",
        description: breakfast
          ? `Start with another good local stop at ${breakfast.name}.`
          : "Start with brunch or coffee.",
        websiteUrl: breakfast?.link,
      },
      {
        time: "Afternoon",
        title: activity?.name ?? "Flexible local highlight",
        description: activity
          ? `Use ${activity.name} as the second-day anchor.`
          : "Choose one more meaningful stop, then keep the rest flexible.",
        websiteUrl: activity?.bookingLink,
        estimatedCost: activity?.costEstimate ?? 0,
      },
    ],
  };
}

function buildGetawayDayOne(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const hotel = trip.hotelOptions?.[0];
  const dinner = pickFood(ctx);

  setPreviousDayFoods(ctx, [dinner]);
  setPreviousDayActivities(ctx, []);

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
        title: dinner?.name ?? "Dinner",
        description: dinner
          ? `Dinner at ${dinner.name}, then keep the night relaxed.`
          : "Dinner and an easy evening.",
        websiteUrl: dinner?.link,
      },
    ],
  };
}

function buildGetawayFinalDay(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickFood(ctx);
  const finalActivity = pickActivity(ctx);

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [finalActivity]);

  return {
    title: "Final half-day and drive back",
    summary: `Keep the final day lighter so the return to ${input.startCity} does not feel rushed.`,
    stops: [
      {
        time: "Morning",
        title: breakfast?.name ?? "Breakfast / last local stop",
        description: breakfast
          ? `Get one more good local stop at ${breakfast.name} before leaving.`
          : "Get one more good local stop before leaving.",
        websiteUrl: breakfast?.link,
      },
      {
        time: "Late morning",
        title: finalActivity?.name ?? "One final highlight",
        description: "Optional final stop before the drive home.",
        websiteUrl: finalActivity?.bookingLink,
        estimatedCost: finalActivity?.costEstimate ?? 0,
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
  dayNumber: number,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickFood(ctx);
  const mainActivity = pickActivity(ctx);
  const secondaryActivity = pickActivity(
    ctx,
    new Set([itemName(mainActivity)])
  );
  const dinner = pickFood(
    ctx,
    new Set([itemName(breakfast)])
  );

  setPreviousDayFoods(ctx, [breakfast, dinner]);
  setPreviousDayActivities(ctx, [mainActivity, secondaryActivity]);

  return {
    title: `Core experience day ${dayNumber}`,
    summary: `Use the middle of the trip for the strongest ${input.style} anchors instead of wasting it on logistics.`,
    stops: [
      {
        time: "Morning",
        title: breakfast?.name ?? "Breakfast / coffee",
        description: breakfast
          ? `Start the day at ${breakfast.name}.`
          : "Start the day with breakfast or coffee.",
        websiteUrl: breakfast?.link,
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
        title: secondaryActivity?.name ?? "Flexible second stop",
        description: secondaryActivity
          ? `Add ${secondaryActivity.name} if you still have energy.`
          : "Keep the afternoon flexible instead of overpacking it.",
        websiteUrl: secondaryActivity?.bookingLink,
        estimatedCost: secondaryActivity?.costEstimate ?? 0,
      },
      {
        time: "Evening",
        title: dinner?.name ?? "Dinner",
        description: dinner
          ? `Finish with dinner at ${dinner.name}.`
          : "Finish with a strong dinner stop.",
        websiteUrl: dinner?.link,
      },
    ],
  };
}

function buildItineraryDays(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData[] {
  const ctx = buildContext(trip);

  if (trip.isStaycation) {
    if (input.tripLengthDays <= 1) {
      return [buildStaycationDayOne(trip, input, ctx)];
    }

    if (input.tripLengthDays === 2) {
      return [
        buildStaycationDayOne(trip, input, ctx),
        buildStaycationFinalDay(trip, ctx),
      ];
    }

    const days: ItineraryDayData[] = [buildStaycationDayOne(trip, input, ctx)];
    for (let day = 2; day < input.tripLengthDays; day += 1) {
      days.push(buildMiddleDay(trip, input, day, ctx));
    }
    days.push(buildStaycationFinalDay(trip, ctx));
    return days;
  }

  if (input.tripLengthDays <= 1) {
    return [buildGetawayDayOne(trip, input, ctx)];
  }

  if (input.tripLengthDays === 2) {
    return [
      buildGetawayDayOne(trip, input, ctx),
      buildGetawayFinalDay(trip, input, ctx),
    ];
  }

  const days: ItineraryDayData[] = [buildGetawayDayOne(trip, input, ctx)];
  for (let day = 2; day < input.tripLengthDays; day += 1) {
    days.push(buildMiddleDay(trip, input, day, ctx));
  }
  days.push(buildGetawayFinalDay(trip, input, ctx));
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