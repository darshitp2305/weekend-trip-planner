import {
  getAddedStopsForDay,
  getCustomStopForKey,
  normalizeSelectionState,
  pickDefaultActivityForStop,
} from "./tripSelections";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  ItineraryStop,
  TripCustomStop,
  TripPlan,
  TripVerificationIssue,
  TripVerificationSummary,
} from "./types";

type ResolvedVerificationStop = {
  dayIndex: number;
  stopIndex?: number;
  title: string;
  kind: NonNullable<ItineraryStop["kind"]> | TripCustomStop["kind"];
  latitude?: number;
  longitude?: number;
  rating?: number;
  hasActionLink: boolean;
  resolved: boolean;
};

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function hasActionLink(value?: string) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAnyActionLink(source: {
  mapsUrl?: string;
  websiteUrl?: string;
  allTrailsUrl?: string;
  bookingLink?: string;
  link?: string;
}) {
  return Boolean(
    hasActionLink(source.mapsUrl) ||
      hasActionLink(source.websiteUrl) ||
      hasActionLink(source.allTrailsUrl) ||
      hasActionLink(source.bookingLink) ||
      hasActionLink(source.link)
  );
}

function distanceBetweenCoordinatesKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
) {
  const averageLatitudeRadians = ((left.latitude + right.latitude) / 2) * (Math.PI / 180);
  const latDistanceKm = (left.latitude - right.latitude) * 111;
  const lonDistanceKm =
    (left.longitude - right.longitude) * 111 * Math.cos(averageLatitudeRadians);

  return Math.sqrt(latDistanceKm ** 2 + lonDistanceKm ** 2);
}

function selectedHotel(plan: TripPlan, preferredHotelName?: string) {
  return (
    plan.hotelOptions.find((hotel) => hotel.name === preferredHotelName) ??
    plan.hotelOptions[0]
  );
}

function titleMatchScore(name?: string, preferredTitle?: string) {
  const optionName = normalized(name);
  const title = normalized(preferredTitle);

  if (!optionName || !title) return 0;
  if (optionName === title) return 100;
  if (optionName.includes(title) || title.includes(optionName)) return 80;
  return 0;
}

function selectedFood(
  foodSpots: FoodSpot[],
  selectedName?: string,
  stopTitle?: string
) {
  const explicit = foodSpots.find((spot) => spot.name === selectedName);
  if (explicit) return explicit;

  return [...foodSpots]
    .sort((left, right) => {
      const scoreDiff =
        titleMatchScore(left.name, stopTitle) - titleMatchScore(right.name, stopTitle);
      if (scoreDiff !== 0) return -scoreDiff;
      return (right.rating ?? 0) - (left.rating ?? 0);
    })
    .at(0);
}

function makeResolvedStop(
  dayIndex: number,
  stopIndex: number | undefined,
  title: string,
  kind: ResolvedVerificationStop["kind"],
  source:
    | Pick<Activity, "latitude" | "longitude" | "rating" | "mapsUrl" | "websiteUrl" | "allTrailsUrl" | "bookingLink">
    | Pick<FoodSpot, "latitude" | "longitude" | "rating" | "mapsUrl" | "websiteUrl" | "link">
    | Pick<HotelOption, "latitude" | "longitude" | "rating" | "mapsUrl" | "websiteUrl" | "bookingLink">
    | Pick<TripCustomStop, "latitude" | "longitude" | "rating" | "mapsUrl" | "websiteUrl" | "allTrailsUrl">
    | null,
  resolved: boolean
): ResolvedVerificationStop {
  return {
    dayIndex,
    stopIndex,
    title,
    kind,
    latitude: source?.latitude,
    longitude: source?.longitude,
    rating: source?.rating,
    hasActionLink: source ? hasAnyActionLink(source) : false,
    resolved,
  };
}

function resolveStop(
  plan: TripPlan,
  selection = normalizeSelectionState(plan.savedSelectionState),
  day: ItineraryDayData,
  dayIndex: number,
  stop: ItineraryStop,
  stopIndex: number
): ResolvedVerificationStop | null {
  const key = stopKey(dayIndex, stopIndex);
  const customStop = getCustomStopForKey(selection, key);

  if (customStop && customStop.kind === stop.kind) {
    return makeResolvedStop(
      dayIndex,
      stopIndex,
      customStop.title || stop.title,
      customStop.kind,
      customStop,
      true
    );
  }

  if (stop.kind === "travel") {
    return null;
  }

  if (stop.kind === "stay") {
    const hotel = selectedHotel(plan, selection.hotelName);
    return makeResolvedStop(
      dayIndex,
      stopIndex,
      hotel?.name ?? stop.title,
      "stay",
      hotel ?? null,
      Boolean(hotel)
    );
  }

  if (stop.kind === "food") {
    const food = selectedFood(plan.foodSpots, selection.foods[key], stop.title);
    return makeResolvedStop(
      dayIndex,
      stopIndex,
      food?.name ?? stop.title,
      "food",
      food ?? null,
      Boolean(food)
    );
  }

  if (stop.kind === "activity") {
    const selectedActivityName =
      selection.activities[key] ??
      pickDefaultActivityForStop(stop, plan.topActivities ?? [], {
        day,
        tripPrompt: plan.tripPrompt,
        hotelName: selection.hotelName,
        hotels: plan.hotelOptions ?? [],
        fallbackCenter: {
          latitude: plan.latitude,
          longitude: plan.longitude,
        },
      })?.name;
    const activity = plan.topActivities.find(
      (candidate) => candidate.name === selectedActivityName
    );

    return makeResolvedStop(
      dayIndex,
      stopIndex,
      activity?.name ?? stop.title,
      "activity",
      activity ?? null,
      Boolean(activity)
    );
  }

  return null;
}

function resolveDayStops(plan: TripPlan, day: ItineraryDayData, dayIndex: number) {
  const selection = normalizeSelectionState(plan.savedSelectionState);
  const addedStops = getAddedStopsForDay(selection, dayIndex);
  const orderedStops: ResolvedVerificationStop[] = [];

  (day.stops ?? []).forEach((stop, stopIndex) => {
    const resolved = resolveStop(plan, selection, day, dayIndex, stop, stopIndex);
    if (resolved) {
      orderedStops.push(resolved);
    }

    addedStops
      .filter((addedStop) => addedStop.insertAfterStopIndex === stopIndex)
      .forEach((addedStop) => {
        orderedStops.push(
          makeResolvedStop(dayIndex, undefined, addedStop.title, addedStop.kind, addedStop, true)
        );
      });
  });

  addedStops
    .filter((addedStop) => {
      const insertAfter = addedStop.insertAfterStopIndex;
      return typeof insertAfter !== "number" || insertAfter >= (day.stops?.length ?? 0);
    })
    .forEach((addedStop) => {
      orderedStops.push(
        makeResolvedStop(dayIndex, undefined, addedStop.title, addedStop.kind, addedStop, true)
      );
    });

  return orderedStops.filter((stop) => stop.kind !== "travel");
}

function dataFreshness(sourceCheckedAt?: string): TripVerificationSummary["freshness"] {
  if (!sourceCheckedAt) return "unknown";

  const checkedAt = new Date(sourceCheckedAt);
  if (Number.isNaN(checkedAt.getTime())) return "unknown";

  const ageDays = Math.floor((Date.now() - checkedAt.getTime()) / 86_400_000);
  if (ageDays <= 7) return "fresh";
  if (ageDays <= 21) return "aging";
  return "stale";
}

function pushIssue(
  issues: TripVerificationIssue[],
  issue: TripVerificationIssue
) {
  issues.push(issue);
}

export function verifyTripPlan(plan: TripPlan): TripVerificationSummary {
  const issues: TripVerificationIssue[] = [];
  const selection = normalizeSelectionState(plan.savedSelectionState);
  const resolvedHotel = selectedHotel(plan, selection.hotelName);
  const routeableStops = (plan.itineraryDays ?? []).flatMap((day, dayIndex) =>
    resolveDayStops(plan, day, dayIndex)
  );
  const checkedStops = routeableStops.length;
  const coordinateStops = routeableStops.filter(
    (stop) =>
      typeof stop.latitude === "number" && typeof stop.longitude === "number"
  ).length;
  const actionLinkStops = routeableStops.filter((stop) => stop.hasActionLink).length;
  const coordinateCoverageRatio =
    checkedStops > 0 ? coordinateStops / checkedStops : 0;
  const actionLinkCoverageRatio =
    checkedStops > 0 ? actionLinkStops / checkedStops : 0;
  const targetBudget = Number(plan.totalBudget ?? 0);
  const estimatedTotal = Number(
    plan.budgetBreakdown?.totalExpected ?? plan.budgetBreakdown?.total ?? 0
  );
  const withinBudget =
    targetBudget > 0 && estimatedTotal > 0 ? estimatedTotal <= targetBudget : undefined;
  const freshness = dataFreshness(plan.sourceCheckedAt);
  const hotelAvailabilityChecked = Boolean(
    plan.tripStartDate &&
      plan.tripEndDate &&
      resolvedHotel?.availabilityStatus &&
      resolvedHotel.availabilityStatus !== "unverified"
  );
  const stayPriceVerified = Boolean(
    resolvedHotel?.totalStayPrice || resolvedHotel?.pricePerNight
  );

  if (resolvedHotel?.availabilityStatus === "sold_out") {
    pushIssue(issues, {
      code: "stay_unavailable",
      severity: "blocking",
      title: "Selected stay is not booking-ready",
      detail: `${resolvedHotel.name} looks sold out or unavailable for the saved trip window.`,
    });
  } else if (
    plan.tripStartDate &&
    plan.tripEndDate &&
    resolvedHotel &&
    resolvedHotel.availabilityStatus !== "available"
  ) {
    pushIssue(issues, {
      code: "stay_unverified",
      severity: "warning",
      title: "Stay availability is still unverified",
      detail: `${resolvedHotel.name} is selected, but live availability has not been confirmed for your dates yet.`,
    });
  }

  if (resolvedHotel && !stayPriceVerified) {
    pushIssue(issues, {
      code: "stay_price_estimated",
      severity: "warning",
      title: "Stay price is still estimated",
      detail: `${resolvedHotel.name} does not have a live stay price yet, so the total budget is still partly estimated.`,
    });
  }

  if (plan.providerStatus?.hotels === "live_unavailable" && plan.tripStartDate && plan.tripEndDate) {
    pushIssue(issues, {
      code: "hotel_inventory_unavailable",
      severity: "risk",
      title: "Live hotel inventory could not be checked",
      detail: "The planner could not confirm hotel inventory from a live provider for the saved dates.",
    });
  }

  if (plan.providerStatus?.places === "live_unavailable") {
    pushIssue(issues, {
      code: "places_live_unavailable",
      severity: "warning",
      title: "Some stop data is using fallback sources",
      detail: "Live place enrichment was unavailable, so parts of this plan may need a manual double-check before booking.",
    });
  }

  if (freshness === "unknown") {
    pushIssue(issues, {
      code: "freshness_unknown",
      severity: "warning",
      title: "Trip freshness is unknown",
      detail: "The app cannot tell when this trip's live data was last checked.",
    });
  } else if (freshness === "aging") {
    pushIssue(issues, {
      code: "freshness_aging",
      severity: "warning",
      title: "Live checks are getting stale",
      detail: "Hotel and place data were checked more than a week ago, so it is worth refreshing before booking.",
    });
  } else if (freshness === "stale") {
    pushIssue(issues, {
      code: "freshness_stale",
      severity: "risk",
      title: "Live checks are stale",
      detail: "This trip's live data is old enough that availability, pricing, or hours may have changed.",
    });
  }

  if (!plan.isStaycation && !plan.routeSummary) {
    pushIssue(issues, {
      code: "route_summary_missing",
      severity: "warning",
      title: "Main route timing is still missing",
      detail: "The destination drive is saved, but route timing has not been checked yet.",
    });
  }

  if (targetBudget > 0 && estimatedTotal > 0 && estimatedTotal > targetBudget) {
    const overageRatio = (estimatedTotal - targetBudget) / targetBudget;
    pushIssue(issues, {
      code: "budget_over_target",
      severity: overageRatio >= 0.2 ? "risk" : "warning",
      title: "Trip is currently over budget",
      detail: `The saved plan is about $${Math.round(estimatedTotal - targetBudget)} over the target total budget.`,
    });
  }

  routeableStops.forEach((stop) => {
    if (!stop.resolved) {
      pushIssue(issues, {
        code: "stop_unresolved",
        severity: "blocking",
        title: "A selected stop could not be verified",
        detail: `The app could not resolve "${stop.title}" to a real place in the current selection.`,
        dayIndex: stop.dayIndex,
        stopIndex: stop.stopIndex,
        stopTitle: stop.title,
      });
      return;
    }

    if (typeof stop.latitude !== "number" || typeof stop.longitude !== "number") {
      pushIssue(issues, {
        code: "stop_missing_coordinates",
        severity: "warning",
        title: "A stop is missing map coordinates",
        detail: `"${stop.title}" cannot be checked cleanly on the route map yet because it has no saved coordinates.`,
        dayIndex: stop.dayIndex,
        stopIndex: stop.stopIndex,
        stopTitle: stop.title,
      });
    }

    if (!stop.hasActionLink) {
      pushIssue(issues, {
        code: "stop_missing_action_link",
        severity: "warning",
        title: "A stop has no direct action link",
        detail: `"${stop.title}" is selected, but there is no saved map, site, or booking link for quick follow-through.`,
        dayIndex: stop.dayIndex,
        stopIndex: stop.stopIndex,
        stopTitle: stop.title,
      });
    }

    if (typeof stop.rating === "number" && stop.rating < 4) {
      pushIssue(issues, {
        code: "stop_low_rating",
        severity: "warning",
        title: "A selected stop has weaker ratings",
        detail: `"${stop.title}" has a rating below 4.0, so it may be worth swapping for a stronger option.`,
        dayIndex: stop.dayIndex,
        stopIndex: stop.stopIndex,
        stopTitle: stop.title,
      });
    }
  });

  let routeLegCount = 0;
  let routeLegIssueCount = 0;
  const maxDriveMinutesBetweenStops = Math.max(
    15,
    Number(plan.maxDriveMinutesBetweenStops ?? 45)
  );
  const maxReasonableKm = maxDriveMinutesBetweenStops * 1.2;

  (plan.itineraryDays ?? []).forEach((day, dayIndex) => {
    const orderedStops = resolveDayStops(plan, day, dayIndex).filter(
      (stop) =>
        typeof stop.latitude === "number" && typeof stop.longitude === "number"
    );

    for (let index = 1; index < orderedStops.length; index += 1) {
      const previous = orderedStops[index - 1];
      const current = orderedStops[index];
      routeLegCount += 1;

      const distanceKm = distanceBetweenCoordinatesKm(
        { latitude: previous.latitude!, longitude: previous.longitude! },
        { latitude: current.latitude!, longitude: current.longitude! }
      );

      if (distanceKm <= maxReasonableKm) {
        continue;
      }

      routeLegIssueCount += 1;
      pushIssue(issues, {
        code: "long_intra_day_transfer",
        severity: distanceKm > maxReasonableKm * 1.5 ? "risk" : "warning",
        title: "One day has a longer transfer than expected",
        detail: `"${previous.title}" to "${current.title}" is roughly ${distanceKm.toFixed(
          distanceKm >= 10 ? 0 : 1
        )} km, which looks longer than the saved intra-day drive target.`,
        dayIndex,
      });
    }
  });

  if (checkedStops > 0 && coordinateCoverageRatio < 0.7) {
    pushIssue(issues, {
      code: "coordinate_coverage_low",
      severity: "risk",
      title: "Too many stops are missing coordinates",
      detail: "Less than 70% of the selected stops have coordinates, so route verification is still weak.",
    });
  }

  if (checkedStops > 0 && actionLinkCoverageRatio < 0.7) {
    pushIssue(issues, {
      code: "action_link_coverage_low",
      severity: "warning",
      title: "Too many stops still lack direct links",
      detail: "Several selected stops still need map, site, or booking links to feel booking-ready.",
    });
  }

  const issueCounts = {
    warning: issues.filter((issue) => issue.severity === "warning").length,
    risk: issues.filter((issue) => issue.severity === "risk").length,
    blocking: issues.filter((issue) => issue.severity === "blocking").length,
  };

  const score = Math.max(
    0,
    100 - issueCounts.warning * 8 - issueCounts.risk * 18 - issueCounts.blocking * 40
  );
  const status =
    issueCounts.blocking > 0
      ? "blocked"
      : issueCounts.warning > 0 || issueCounts.risk > 0
        ? "attention_needed"
        : "verified";

  return {
    status,
    score,
    issueCounts,
    checkedStopCount: checkedStops,
    routeLegCount,
    routeLegIssueCount,
    coordinateCoverageRatio,
    actionLinkCoverageRatio,
    freshness,
    stayPriceVerified,
    hotelAvailabilityChecked,
    budgetTarget: targetBudget > 0 ? targetBudget : undefined,
    estimatedTotal: estimatedTotal > 0 ? estimatedTotal : undefined,
    withinBudget,
    checkedAt: plan.sourceCheckedAt,
    issues,
  };
}
