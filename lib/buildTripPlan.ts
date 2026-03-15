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

  const firstHotelPrice = trip.hotelOptions?.[0]?.pricePerNight;
  const hotelBase =
    typeof firstHotelPrice === "number"
      ? firstHotelPrice * nights
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
  remainingFoods: FoodSpot[];
  remainingActivities: ActivitySpot[];
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

function buildContext(trip: RankedDestination): BuildContext {
  return {
    remainingFoods: dedupeByName(trip.foodSpots),
    remainingActivities: dedupeByName(trip.topActivities),
    previousDayFoodNames: new Set<string>(),
    previousDayActivityNames: new Set<string>(),
  };
}

function normalizedFoodSignals(food?: FoodSpot) {
  return [
    ...(food?.tags ?? []),
    food?.category ?? "",
    food?.name ?? "",
    food?.shortDescription ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function normalizedActivitySignals(activity?: ActivitySpot) {
  return [
    activity?.type ?? "",
    activity?.name ?? "",
    activity?.shortDescription ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function isAdminLikeActivity(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);

  return (
    text.includes("visitor center") ||
    text.includes("visitor centre") ||
    text.includes("information center") ||
    text.includes("information centre") ||
    text.includes("corporate office") ||
    text.includes("tourism office") ||
    text.includes("office") ||
    text.includes("agency") ||
    text.includes("travel agency") ||
    text.includes("operator") ||
    text.includes("administrative") ||
    text.includes("business office")
  );
}

function foodScoreForMorning(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("espresso") ||
    text.includes("waffle")
  ) {
    score += 8;
  }

  if (text.includes("provisions") || text.includes("deli")) score += 4;
  if (text.includes("brew")) score += 2;

  if (
    text.includes("steak") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("tavern") ||
    text.includes("dining")
  ) {
    score -= 6;
  }

  if (text.includes("restaurant")) score -= 3;
  if (text.includes("kitchen")) score -= 2;
  if (text.includes("bistro")) score -= 1;

  return score;
}

function foodScoreForDinner(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (
    text.includes("restaurant") ||
    text.includes("bistro") ||
    text.includes("steak") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("kitchen") ||
    text.includes("tavern") ||
    text.includes("dining") ||
    text.includes("trattoria")
  ) {
    score += 8;
  }

  if (text.includes("cafe")) score += 1;

  if (
    text.includes("coffee") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("waffle")
  ) {
    score -= 7;
  }

  return score;
}

function foodScoreForArrivalDinner(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (
    text.includes("restaurant") ||
    text.includes("bistro") ||
    text.includes("kitchen") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("dining") ||
    text.includes("steak") ||
    text.includes("tavern") ||
    text.includes("trattoria")
  ) {
    score += 10;
  }

  if (text.includes("cafe")) score -= 2;

  if (
    text.includes("coffee") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("waffle") ||
    text.includes("provisions")
  ) {
    score -= 8;
  }

  return score;
}

function foodScoreForFinalLightStop(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("espresso") ||
    text.includes("waffle")
  ) {
    score += 10;
  }

  if (
    text.includes("provisions") ||
    text.includes("deli") ||
    text.includes("brew")
  ) {
    score += 5;
  }

  if (
    text.includes("restaurant") ||
    text.includes("steak") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("tavern") ||
    text.includes("dining") ||
    text.includes("trattoria")
  ) {
    score -= 8;
  }

  if (text.includes("bistro")) score -= 4;
  if (text.includes("kitchen")) score -= 3;

  return score;
}

function activityAnchorScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("national park") ||
    text.includes("museum") ||
    text.includes("planetarium") ||
    text.includes("historic") ||
    text.includes("landmark") ||
    text.includes("gondola") ||
    text.includes("viewpoint") ||
    text.includes("trail") ||
    text.includes("waterfall") ||
    text.includes("lake") ||
    text.includes("hot spring") ||
    text.includes("lookout") ||
    text.includes("canyon") ||
    text.includes("tourist_attraction")
  ) {
    score += 10;
  }

  if (text.includes("park")) score += 5;
  if (text.includes("tour")) score += 4;

  if (text.includes("red chair") || text.includes("totem pole")) {
    score -= 2;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 12;
  }

  return score;
}

function activitySecondaryScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("museum") ||
    text.includes("historic") ||
    text.includes("landmark") ||
    text.includes("viewpoint") ||
    text.includes("trail") ||
    text.includes("park") ||
    text.includes("lake") ||
    text.includes("tour") ||
    text.includes("planetarium") ||
    text.includes("tourist_attraction")
  ) {
    score += 6;
  }

  if (text.includes("red chair") || text.includes("totem pole")) {
    score += 1;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 10;
  }

  return score;
}

function activityFinalLightScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("viewpoint") ||
    text.includes("lake") ||
    text.includes("landmark") ||
    text.includes("historic") ||
    text.includes("trail") ||
    text.includes("park") ||
    text.includes("red chair") ||
    text.includes("totem pole") ||
    text.includes("tourist_attraction")
  ) {
    score += 7;
  }

  if (text.includes("museum") || text.includes("planetarium")) {
    score += 2;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 12;
  }

  return score;
}

function popBestItem<T extends { name?: string }>(
  pool: T[],
  previousDayNames: Set<string>,
  blockedNames: Set<string>,
  scorer: (item: T) => number,
  minScore: number
): T | undefined {
  const candidates = pool
    .map((item, index) => ({
      item,
      index,
      score: scorer(item),
      wasYesterday: previousDayNames.has(itemName(item)),
      key: itemName(item),
    }))
    .filter(({ item }) => !blockedNames.has(itemName(item)));

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.wasYesterday !== b.wasYesterday) return a.wasYesterday ? 1 : -1;
    return a.key.localeCompare(b.key);
  });

  const best = candidates[0];
  if (!best || best.score < minScore) return undefined;

  const [picked] = pool.splice(best.index, 1);
  return picked;
}

function pickMorningFood(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    foodScoreForMorning,
    4
  );
}

function pickDinnerFood(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    foodScoreForDinner,
    4
  );
}

function pickArrivalDinnerFood(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    foodScoreForArrivalDinner,
    6
  );
}

function pickLightFinalFood(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    foodScoreForFinalLightStop,
    5
  );
}

function pickAnchorActivity(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    activityAnchorScore,
    4
  );
}

function pickSecondaryActivity(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    activitySecondaryScore,
    1
  );
}

function pickFinalLightActivity(
  ctx: BuildContext,
  blockedNames: Set<string> = new Set<string>()
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    activityFinalLightScore,
    2
  );
}

function compactStops<T>(items: Array<T | undefined | false | null>): T[] {
  return items.filter(Boolean) as T[];
}

function middleDayTitle(
  dayNumber: number,
  totalDays: number,
  isStaycation: boolean
) {
  if (totalDays <= 3) return `Core experience day ${dayNumber}`;
  if (dayNumber === 2) {
    return isStaycation ? "Best local day" : "Anchor experience day";
  }
  if (dayNumber === totalDays - 1) {
    return isStaycation ? "Flexible local day" : "Recharge and favorites day";
  }
  if (dayNumber % 2 === 0) return `Exploration day ${dayNumber}`;
  return `Core experience day ${dayNumber}`;
}

function middleDaySummary(
  input: TripInput,
  dayNumber: number,
  totalDays: number,
  isStaycation: boolean
) {
  if (totalDays <= 3) {
    return `Use the middle of the trip for the strongest ${input.style} anchors instead of wasting it on logistics.`;
  }

  if (dayNumber === 2) {
    return isStaycation
      ? `Use day two for the strongest local ${input.style} stops while energy is high.`
      : `Use the first full day for the strongest ${input.style} anchors in the destination.`;
  }

  if (dayNumber === totalDays - 1) {
    return isStaycation
      ? "Keep this day flexible and use it for favorites you still have not hit."
      : "Use this day to revisit favorites or add lighter stops before the final return day.";
  }

  if (dayNumber % 2 === 0) {
    return `Mix one anchor stop with lighter exploration so the trip still feels sustainable by day ${dayNumber}.`;
  }

  return `Keep the trip varied by balancing one main anchor with food and flexible exploration on day ${dayNumber}.`;
}

function buildStaycationDayOne(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickMorningFood(ctx);
  const activity = pickAnchorActivity(ctx);
  const dinner = pickDinnerFood(ctx, new Set([itemName(breakfast)]));

  setPreviousDayFoods(ctx, [breakfast, dinner]);
  setPreviousDayActivities(ctx, [activity]);

  return {
    title: "Local reset day",
    summary: `Low-friction ${input.style} day with basically no travel overhead.`,
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: `Start with food at ${breakfast.name}.`,
        websiteUrl: breakfast.link,
      },
      activity && {
        time: "Afternoon",
        title: activity.name,
        description: `Use ${activity.name} as the anchor activity for the afternoon.`,
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activity.costEstimate ?? 0,
      },
      dinner && {
        time: "Evening",
        title: dinner.name,
        description: `Wrap up with food at ${dinner.name}.`,
        websiteUrl: dinner.link,
      },
    ]),
  };
}

function buildStaycationFinalDay(
  trip: RankedDestination,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickLightFinalFood(ctx);
  const activity = pickFinalLightActivity(ctx);

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [activity]);

  return {
    title: "Second local day",
    summary:
      "Use day two for one more meaningful stop without travel friction.",
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: `Start with another good local stop at ${breakfast.name}.`,
        websiteUrl: breakfast.link,
      },
      activity && {
        time: "Afternoon",
        title: activity.name,
        description: `Use ${activity.name} as the second-day anchor.`,
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activity.costEstimate ?? 0,
      },
    ]),
  };
}

function buildGetawayDayOne(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const hotel = trip.hotelOptions?.[0];
  const dinner = pickArrivalDinnerFood(ctx);

  setPreviousDayFoods(ctx, [dinner]);
  setPreviousDayActivities(ctx, []);

  return {
    title: "Arrival and easy first day",
    summary:
      "Get there, settle in, and avoid wasting day one by cramming too much into it.",
    stops: compactStops([
      {
        time: "Morning",
        title: `Drive from ${input.startCity} to ${trip.name}`,
        description: `Estimated drive: ${makeDriveText(trip)}.`,
      },
      hotel && {
        time: "Afternoon",
        title: `Check in at ${hotel.name}`,
        description: `Use ${hotel.name} as your base, then start light.`,
        websiteUrl: hotel.bookingLink ?? hotel.websiteUrl,
      },
      dinner && {
        time: "Evening",
        title: dinner.name,
        description: `Dinner at ${dinner.name}, then keep the night relaxed.`,
        websiteUrl: dinner.link,
      },
    ]),
  };
}

function buildGetawayFinalDay(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickLightFinalFood(ctx);
  const finalActivity = pickFinalLightActivity(ctx);

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [finalActivity]);

  return {
    title: "Final half-day and drive back",
    summary: `Keep the final day lighter so the return to ${input.startCity} does not feel rushed.`,
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: `Get one more good local stop at ${breakfast.name} before leaving.`,
        websiteUrl: breakfast.link,
      },
      finalActivity && {
        time: "Late morning",
        title: finalActivity.name,
        description: `Optional final stop at ${finalActivity.name} before the drive home.`,
        websiteUrl: finalActivity.bookingLink ?? finalActivity.websiteUrl,
        estimatedCost: finalActivity.costEstimate ?? 0,
      },
      {
        time: "Afternoon",
        title: `Drive back to ${input.startCity}`,
        description:
          "Head back without turning the final day into a scramble.",
      },
    ]),
  };
}

function buildMiddleDay(
  trip: RankedDestination,
  input: TripInput,
  dayNumber: number,
  totalDays: number,
  ctx: BuildContext
): ItineraryDayData {
  const breakfast = pickMorningFood(ctx);
  const mainActivity = pickAnchorActivity(ctx);

  const buildLightDay = dayNumber % 2 === 0 && totalDays >= 5;
  const secondaryActivity = buildLightDay
    ? undefined
    : pickSecondaryActivity(ctx, new Set([itemName(mainActivity)]));

  const dinner = pickDinnerFood(ctx, new Set([itemName(breakfast)]));

  setPreviousDayFoods(ctx, [breakfast, dinner]);
  setPreviousDayActivities(ctx, [mainActivity, secondaryActivity]);

  return {
    title: middleDayTitle(dayNumber, totalDays, trip.isStaycation),
    summary: middleDaySummary(
      input,
      dayNumber,
      totalDays,
      trip.isStaycation
    ),
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: `Start the day at ${breakfast.name}.`,
        websiteUrl: breakfast.link,
      },
      mainActivity && {
        time: "Late morning",
        title: mainActivity.name,
        description: `Use ${mainActivity.name} as the main daytime anchor.`,
        websiteUrl: mainActivity.bookingLink ?? mainActivity.websiteUrl,
        estimatedCost: mainActivity.costEstimate ?? 0,
      },
      secondaryActivity && {
        time: "Afternoon",
        title: secondaryActivity.name,
        description: `Add ${secondaryActivity.name} if you still have energy.`,
        websiteUrl:
          secondaryActivity.bookingLink ?? secondaryActivity.websiteUrl,
        estimatedCost: secondaryActivity.costEstimate ?? 0,
      },
      dinner && {
        time: "Evening",
        title: dinner.name,
        description: `Finish with dinner at ${dinner.name}.`,
        websiteUrl: dinner.link,
      },
    ]),
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
      days.push(buildMiddleDay(trip, input, day, input.tripLengthDays, ctx));
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
    days.push(buildMiddleDay(trip, input, day, input.tripLengthDays, ctx));
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