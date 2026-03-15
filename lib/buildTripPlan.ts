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
    trip.hotelOptions?.length && trip.hotelOptions[0]?.pricePerNight
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

type ReservationState = {
  finalDayFood?: FoodSpot;
  finalDayActivity?: ActivitySpot;
};

type BuildContext = {
  foodQueue: FoodSpot[];
  activityQueue: ActivitySpot[];
  foodFallback: FoodSpot[];
  activityFallback: ActivitySpot[];
  previousDayFoodNames: Set<string>;
  previousDayActivityNames: Set<string>;
  reservations: ReservationState;
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

function setPreviousDayFoods(
  ctx: BuildContext,
  items: Array<FoodSpot | undefined>
) {
  ctx.previousDayFoodNames = new Set(items.map(itemName).filter(Boolean));
}

function setPreviousDayActivities(
  ctx: BuildContext,
  items: Array<ActivitySpot | undefined>
) {
  ctx.previousDayActivityNames = new Set(items.map(itemName).filter(Boolean));
}

function takeFromQueueAvoidingPrevious<T extends { name?: string }>(
  queue: T[],
  previousDayNames: Set<string>
): T | undefined {
  if (queue.length === 0) return undefined;

  const nonRepeatingIndex = queue.findIndex(
    (item) => !previousDayNames.has(itemName(item))
  );

  if (nonRepeatingIndex >= 0) {
    const [picked] = queue.splice(nonRepeatingIndex, 1);
    return picked;
  }

  return queue.shift();
}

function takeFallbackAvoidingPrevious<T extends { name?: string }>(
  pool: T[],
  previousDayNames: Set<string>,
  blockedNames: Set<string> = new Set<string>()
): T | undefined {
  if (pool.length === 0) return undefined;

  const filtered = pool.filter((item) => !blockedNames.has(itemName(item)));
  if (filtered.length === 0) return undefined;

  const nonRepeating = filtered.find(
    (item) => !previousDayNames.has(itemName(item))
  );
  if (nonRepeating) return nonRepeating;

  return filtered[0];
}

function buildContext(
  trip: RankedDestination,
  tripLengthDays: number
): BuildContext {
  const allFoods = dedupeByName(trip.foodSpots);
  const allActivities = dedupeByName(trip.topActivities);

  const foodQueue = [...allFoods];
  const activityQueue = [...allActivities];

  let finalDayFood: FoodSpot | undefined;
  let finalDayActivity: ActivitySpot | undefined;

  if (tripLengthDays > 2) {
    finalDayFood = foodQueue.pop();
    finalDayActivity = activityQueue.pop();
  }

  return {
    foodQueue,
    activityQueue,
    foodFallback: allFoods,
    activityFallback: allActivities,
    previousDayFoodNames: new Set<string>(),
    previousDayActivityNames: new Set<string>(),
    reservations: {
      finalDayFood,
      finalDayActivity,
    },
  };
}

function pickFood(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
): FoodSpot | undefined {
  const availableQueue = ctx.foodQueue.filter(
    (item) => !blockedNames.has(itemName(item))
  );

  const queueCandidate = takeFromQueueAvoidingPrevious(
    availableQueue,
    ctx.previousDayFoodNames
  );

  if (queueCandidate) {
    const key = itemName(queueCandidate);
    const idx = ctx.foodQueue.findIndex((item) => itemName(item) === key);
    if (idx >= 0) ctx.foodQueue.splice(idx, 1);
    return queueCandidate;
  }

  return takeFallbackAvoidingPrevious(
    ctx.foodFallback,
    ctx.previousDayFoodNames,
    blockedNames
  );
}

function pickActivity(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
): ActivitySpot | undefined {
  const availableQueue = ctx.activityQueue.filter(
    (item) => !blockedNames.has(itemName(item))
  );

  const queueCandidate = takeFromQueueAvoidingPrevious(
    availableQueue,
    ctx.previousDayActivityNames
  );

  if (queueCandidate) {
    const key = itemName(queueCandidate);
    const idx = ctx.activityQueue.findIndex((item) => itemName(item) === key);
    if (idx >= 0) ctx.activityQueue.splice(idx, 1);
    return queueCandidate;
  }

  return takeFallbackAvoidingPrevious(
    ctx.activityFallback,
    ctx.previousDayActivityNames,
    blockedNames
  );
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
  const breakfast = ctx.reservations.finalDayFood ?? pickFood(ctx);
  const activity = ctx.reservations.finalDayActivity ?? pickActivity(ctx);

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
        websiteUrl: hotel?.bookingLink ?? hotel?.websiteUrl,
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
  const breakfast = ctx.reservations.finalDayFood ?? pickFood(ctx);
  const finalActivity = ctx.reservations.finalDayActivity ?? pickActivity(ctx);

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
        websiteUrl: finalActivity?.bookingLink ?? finalActivity?.websiteUrl,
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
  const dinner = pickFood(ctx, new Set([itemName(breakfast)]));

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
        websiteUrl: mainActivity?.bookingLink ?? mainActivity?.websiteUrl,
        estimatedCost: mainActivity?.costEstimate ?? 0,
      },
      {
        time: "Afternoon",
        title: secondaryActivity?.name ?? "Flexible second stop",
        description: secondaryActivity
          ? `Add ${secondaryActivity.name} if you still have energy.`
          : "Keep the afternoon flexible instead of overpacking it.",
        websiteUrl:
          secondaryActivity?.bookingLink ?? secondaryActivity?.websiteUrl,
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
  const ctx = buildContext(trip, input.tripLengthDays);

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

  const driveHoursFromStart = trip.isStaycation ? 0 : trip.driveHoursFromStart;
  const driveTimeText = trip.isStaycation ? "0 hours" : makeDriveText(trip);

  return {
    id: crypto.randomUUID(),

    destinationName: trip.name,
    region: trip.province,
    summary: trip.summary,
    imageUrl: trip.imageUrl,

    driveTimeText,
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

    // Extra compatibility fields for the saved trip page / header components
    name: trip.name,
    title: trip.name,
    destination: trip.name,
    province: trip.province,
    driveHoursFromStart,
    rawVibes: trip.rawVibes ?? [],
    source: dataSource,
    isStaycation: trip.isStaycation,
    homeBaseCity: trip.homeBaseCity,
  } as TripPlan;
}