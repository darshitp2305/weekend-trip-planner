/**
 * Helper module for trust signals concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  ConfidenceLevel,
  DriveTimeConfidence,
  DriveTimeSource,
  LiveDataSummary,
  ProviderOutcome,
  ProviderStatusSummary,
  TripDataSource,
} from "./types";

type TrustSourceLike = {
  source?: TripDataSource;
  dataSource?: TripDataSource;
  liveDataSummary?: LiveDataSummary;
  createdAt?: string;
  sourceCheckedAt?: string;
  providerStatus?: ProviderStatusSummary;
};

type DriveTimeSignalLike = {
  driveTimeSource?: DriveTimeSource;
  driveTimeConfidence?: DriveTimeConfidence;
};

function providerOutcomeLabel(
  label: string,
  outcome?: ProviderOutcome
): string | null {
  switch (outcome) {
    case "live_success":
      return `${label}: live`;
    case "live_unavailable":
      return `${label}: unavailable`;
    case "fallback_used":
      return `${label}: fallback`;
    default:
      return null;
  }
}

export function formatTrustDate(value?: string) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function resolveTripDataSource(item: TrustSourceLike): TripDataSource {
  if (item.dataSource) return item.dataSource;
  if (item.source) return item.source;
  if (item.liveDataSummary?.usedPlacesData) return "live-google-places";
  if (item.liveDataSummary?.usedFallbackData) return "static-fallback";
  return "static-ranking";
}

export function tripSourceLabel(item: TrustSourceLike) {
  const source = resolveTripDataSource(item);

  switch (source) {
    case "live-google-places":
      return "Live Google Places";
    case "static-fallback":
      return "Fallback data";
    case "static-ranking":
    default:
      return "Static ranking";
  }
}

export function tripSourceTone(item: TrustSourceLike) {
  const source = resolveTripDataSource(item);

  if (source === "live-google-places") return "green" as const;
  if (source === "static-fallback") return "violet" as const;
  return "slate" as const;
}

export function tripConfidenceLabel(confidence?: ConfidenceLevel) {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Lower confidence";
    default:
      return "Trip plan";
  }
}

export function driveTimeSourceLabel(item: DriveTimeSignalLike) {
  switch (item.driveTimeSource) {
    case "catalog_exact":
      return "Exact route";
    case "catalog_hub":
      return "Hub-based route";
    case "estimated_coordinates":
      return "Estimated route";
    default:
      return "Drive time";
  }
}

export function driveTimeTrustNote(item: DriveTimeSignalLike) {
  switch (item.driveTimeSource) {
    case "catalog_exact":
      return "Catalog drive baseline.";
    case "catalog_hub":
      return "Hub-based drive baseline.";
    case "estimated_coordinates":
      return "Estimated from map coordinates.";
    default:
      return null;
  }
}

export function tripFreshnessLabel(item: TrustSourceLike) {
  const source = resolveTripDataSource(item);
  const checkedAtLabel = formatTrustDate(item.sourceCheckedAt);
  const createdAtLabel = formatTrustDate(item.createdAt);

  if (source === "live-google-places") {
    return checkedAtLabel
      ? `Live place data checked ${checkedAtLabel}`
      : "Live place data was available when this trip was built.";
  }

  if (source === "static-fallback") {
    return checkedAtLabel
      ? `Fallback recommendation snapshot checked ${checkedAtLabel}`
      : createdAtLabel
        ? `Fallback recommendation snapshot saved ${createdAtLabel}`
        : "This trip is using fallback recommendation data.";
  }

  return createdAtLabel
    ? `Static ranking snapshot saved ${createdAtLabel}`
    : "This trip is based on the static ranking dataset.";
}

export function tripTrustNote(item: TrustSourceLike) {
  const source = resolveTripDataSource(item);

  if (source === "live-google-places") {
    return "Stops are sourced from live place results, but budget, travel timing, and itinerary flow are still planning estimates.";
  }

  if (source === "static-fallback") {
    return "Live provider coverage was thin or unavailable, so this trip relies on fallback recommendation data and estimated pricing.";
  }

  return "This trip comes from the static ranking dataset and uses estimated pricing and itinerary timing.";
}

export function tripProviderStatusText(item: TrustSourceLike) {
  const labels = [
    providerOutcomeLabel("Places", item.providerStatus?.places),
    providerOutcomeLabel("Hotels", item.providerStatus?.hotels),
    providerOutcomeLabel("Trip copy", item.providerStatus?.tripCopy),
  ].filter((value): value is string => Boolean(value));

  return labels.length > 0 ? labels.join(" | ") : null;
}
