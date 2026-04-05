import {
  TripPlan,
  TripRecheckChangeSummary,
  TripVerificationSummary,
} from "./types";

function selectedHotel(plan: TripPlan) {
  return (
    plan.hotelOptions.find(
      (hotel) => hotel.name === plan.savedSelectionState?.hotelName
    ) ?? plan.hotelOptions[0]
  );
}

function coveredStopCount(
  summary: TripVerificationSummary | undefined,
  ratio: number | undefined
) {
  if (!summary || typeof ratio !== "number") return 0;
  return Math.round(summary.checkedStopCount * ratio);
}

function issueTotal(summary?: TripVerificationSummary) {
  if (!summary) return 0;
  return (
    summary.issueCounts.warning +
    summary.issueCounts.risk +
    summary.issueCounts.blocking
  );
}

function freshnessRank(freshness?: TripVerificationSummary["freshness"]) {
  switch (freshness) {
    case "fresh":
      return 3;
    case "aging":
      return 2;
    case "stale":
      return 1;
    default:
      return 0;
  }
}

function freshnessLabel(freshness?: TripVerificationSummary["freshness"]) {
  switch (freshness) {
    case "fresh":
      return "fresh";
    case "aging":
      return "aging";
    case "stale":
      return "stale";
    default:
      return "unknown";
  }
}

export function buildTripRecheckChangeSummary(
  previousTrip: TripPlan,
  nextTrip: TripPlan
): TripRecheckChangeSummary {
  const previousSummary = previousTrip.verificationSummary;
  const nextSummary = nextTrip.verificationSummary;
  const previousHotel = selectedHotel(previousTrip);
  const nextHotel = selectedHotel(nextTrip);
  const items: string[] = [];
  let improvementSignals = 0;
  let negativeSignals = 0;

  if (
    previousHotel?.availabilityStatus !== "available" &&
    nextHotel?.availabilityStatus === "available"
  ) {
    items.push(`${nextHotel.name} availability is now confirmed for the saved dates.`);
    improvementSignals += 1;
  } else if (
    previousHotel?.availabilityStatus !== "sold_out" &&
    nextHotel?.availabilityStatus === "sold_out"
  ) {
    items.push(`${nextHotel.name} now looks sold out for the saved dates.`);
    negativeSignals += 1;
  }

  if (!previousSummary?.stayPriceVerified && nextSummary?.stayPriceVerified) {
    items.push("Stay pricing is now grounded instead of only estimated.");
    improvementSignals += 1;
  }

  const coordinateDelta =
    coveredStopCount(nextSummary, nextSummary?.coordinateCoverageRatio) -
    coveredStopCount(previousSummary, previousSummary?.coordinateCoverageRatio);
  if (coordinateDelta > 0) {
    items.push(
      `${coordinateDelta} selected stop${
        coordinateDelta === 1 ? "" : "s"
      } gained map coordinates.`
    );
    improvementSignals += 1;
  } else if (coordinateDelta < 0) {
    items.push(
      `${Math.abs(coordinateDelta)} selected stop${
        Math.abs(coordinateDelta) === 1 ? "" : "s"
      } lost map coordinates in the refreshed data.`
    );
    negativeSignals += 1;
  }

  const actionLinkDelta =
    coveredStopCount(nextSummary, nextSummary?.actionLinkCoverageRatio) -
    coveredStopCount(previousSummary, previousSummary?.actionLinkCoverageRatio);
  if (actionLinkDelta > 0) {
    items.push(
      `${actionLinkDelta} selected stop${
        actionLinkDelta === 1 ? "" : "s"
      } gained direct map or site links.`
    );
    improvementSignals += 1;
  } else if (actionLinkDelta < 0) {
    items.push(
      `${Math.abs(actionLinkDelta)} selected stop${
        Math.abs(actionLinkDelta) === 1 ? "" : "s"
      } lost direct map or site links in the refreshed data.`
    );
    negativeSignals += 1;
  }

  if (previousSummary && nextSummary) {
    if (nextSummary.issueCounts.blocking !== previousSummary.issueCounts.blocking) {
      const delta = nextSummary.issueCounts.blocking - previousSummary.issueCounts.blocking;
      items.push(
        delta < 0
          ? `Blocking issues dropped from ${previousSummary.issueCounts.blocking} to ${nextSummary.issueCounts.blocking}.`
          : `Blocking issues increased from ${previousSummary.issueCounts.blocking} to ${nextSummary.issueCounts.blocking}.`
      );
      if (delta < 0) improvementSignals += 1;
      if (delta > 0) negativeSignals += 1;
    }

    const issueDelta = issueTotal(nextSummary) - issueTotal(previousSummary);
    if (issueDelta !== 0) {
      items.push(
        issueDelta < 0
          ? `Overall verification issues fell by ${Math.abs(issueDelta)}.`
          : `Overall verification issues increased by ${issueDelta}.`
      );
      if (issueDelta < 0) improvementSignals += 1;
      if (issueDelta > 0) negativeSignals += 1;
    }

    const previousFreshnessRank = freshnessRank(previousSummary.freshness);
    const nextFreshnessRank = freshnessRank(nextSummary.freshness);
    if (nextFreshnessRank > previousFreshnessRank) {
      items.push(
        `Live checks moved from ${freshnessLabel(previousSummary.freshness)} to ${freshnessLabel(
          nextSummary.freshness
        )}.`
      );
      improvementSignals += 1;
    } else if (nextFreshnessRank < previousFreshnessRank) {
      items.push(
        `Live checks moved from ${freshnessLabel(previousSummary.freshness)} to ${freshnessLabel(
          nextSummary.freshness
        )}.`
      );
      negativeSignals += 1;
    }
  }

  if (items.length === 0) {
    return {
      tone: "unchanged",
      headline: "The re-check completed, but no visible trip fields changed.",
      items: [
        "Live providers were queried again and the current trip version was re-saved without any obvious changes to availability, verification coverage, or selected-stop data.",
      ],
    };
  }

  return {
    tone:
      negativeSignals > 0 && improvementSignals > 0
        ? "mixed"
        : negativeSignals > 0
          ? "mixed"
          : "improved",
    headline:
      negativeSignals > 0
        ? "The re-check found meaningful changes you should review."
        : "The re-check improved the trip's live confidence.",
    items,
  };
}

