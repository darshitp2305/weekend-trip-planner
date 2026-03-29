import Image from "next/image";
import { useEffect, useState } from "react";
import { formatDisplayTag, formatDisplayText } from "../lib/displayText";
import { getTripMomentumSummary, getTripUrgencyLevel } from "../lib/tripMomentum";
import { getFallbackImageUrl, normalizeTripImageUrl } from "../lib/tripImages";
import {
  HotelOption,
  LiveDataSummary,
  TripDataSource,
  TripPlan,
  TripSelectionState,
} from "../lib/types";
import {
  getPromptAwareTripSummary,
  getRecommendationContextLabel,
  getRecommendedTripTitle,
} from "../lib/tripSpecificity";
import {
  tripConfidenceLabel,
  tripFreshnessLabel,
  tripProviderStatusText,
  tripSourceLabel,
  tripSourceTone,
  tripTrustNote,
} from "../lib/trustSignals";

type TripHeaderProps = {
  shareMode?: boolean;
  trip: {
    title?: string;
    name?: string;
    destination?: string;
    province?: string;
    imageUrl?: string;
    summary?: string;
    driveHours?: number;
    driveHoursFromStart?: number;
    styleMatchStrength?: TripPlan["styleMatchStrength"];
    score?: number;
    source?: TripDataSource;
    rawVibes?: string[];
    hotelOptions?: Pick<HotelOption, "name" | "shortDescription">[];
    savedSelectionState?: Pick<TripSelectionState, "hotelName">;
    confidence?: TripPlan["confidence"];
    status?: "draft" | "finalized";
    finalizedAt?: string;
    decisionStatus?: "waiting_on_partner" | "needs_changes" | "approved" | "booked";
    routeSummary?: {
      distanceMeters?: number;
      durationSeconds?: number;
      origin?: {
        label?: string;
      };
      destination?: {
        label?: string;
      };
    };
    liveDataSummary?: LiveDataSummary;
    sourceCheckedAt?: string;
    destinationName?: string;
    homeBaseCity?: string;
    providerStatus?: {
      places?: "live_success" | "live_unavailable" | "fallback_used";
      hotels?: "live_success" | "live_unavailable" | "fallback_used";
      tripCopy?: "live_success" | "live_unavailable" | "fallback_used";
    };
    tripPrompt?: string;
    travelerCount?: number;
    budgetPerTraveler?: number;
    totalBudget?: number;
    itineraryDays?: TripPlan["itineraryDays"];
    topActivities?: TripPlan["topActivities"];
    estimatedCost?: number;
    budgetBreakdown?: TripPlan["budgetBreakdown"];
  };
};

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "violet";
}) {
  const toneClass =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
      : tone === "violet"
        ? "border border-[#b2f6df] bg-[#effff8] text-[#048f69] dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10 dark:text-[#b2f6df]"
        : "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium leading-none ${toneClass}`}
    >
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}

function sourceLabel(trip: TripHeaderProps["trip"]) {
  return tripSourceLabel(trip);
}

function decisionLabel(status?: TripHeaderProps["trip"]["decisionStatus"]) {
  switch (status) {
    case "approved":
      return "Approved";
    case "booked":
      return "Booked";
    case "needs_changes":
      return "Needs changes";
    case "waiting_on_partner":
      return "Waiting on partner";
    default:
      return null;
  }
}

function decisionTone(status?: TripHeaderProps["trip"]["decisionStatus"]) {
  switch (status) {
    case "approved":
    case "booked":
      return "green" as const;
    case "needs_changes":
      return "violet" as const;
    case "waiting_on_partner":
    default:
      return "slate" as const;
  }
}

function formatFinalizedAt(value?: string) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDriveHours(hours?: number) {
  if (hours === undefined || !Number.isFinite(hours)) return "-";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Math.round(hours * 10) / 10} hours`;
}

function formatDurationFromSeconds(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function formatDistanceFromMeters(meters?: number) {
  if (meters === undefined || !Number.isFinite(meters)) return undefined;
  const km = meters / 1000;
  return `${Math.round(km)} km`;
}

function confidenceTone(confidence?: TripHeaderProps["trip"]["confidence"]) {
  if (confidence === "high") return "green" as const;
  if (confidence === "low") return "violet" as const;
  return "slate" as const;
}

export default function TripHeader({ trip, shareMode = false }: TripHeaderProps) {
  const isDraft = trip.status !== "finalized";
  const isShareReviewState = shareMode;
  const title = getRecommendedTripTitle({
    title: trip.title,
    name: trip.name,
    destination: trip.destination,
    destinationName: trip.destinationName,
    homeBaseCity: trip.homeBaseCity,
    province: trip.province,
    hotelOptions: trip.hotelOptions as HotelOption[] | undefined,
    savedSelectionState: trip.savedSelectionState,
  }, {
    tripPrompt: trip.tripPrompt,
  });
  const titleContext = getRecommendationContextLabel(
    {
      homeBaseCity: trip.homeBaseCity,
      destinationName: trip.destinationName,
      destination: trip.destination,
      name: trip.name,
      province: trip.province,
    },
    title
  );
  const vibes = Array.isArray(trip.rawVibes) ? trip.rawVibes.slice(0, 5) : [];
  const momentumTrip: TripPlan = {
    id: trip.name ?? trip.title ?? trip.destination ?? "trip",
    destinationName:
      trip.destinationName ?? trip.destination ?? trip.name ?? trip.title ?? "Trip",
    summary: trip.summary ?? "",
    driveTimeText: "",
    tags: [],
    budgetBreakdown: {
      hotel: 0,
      food: 0,
      gas: 0,
      activities: 0,
      misc: 0,
      total: 0,
      totalLow: 0,
      totalExpected: 0,
      totalHigh: 0,
    },
    hotelOptions: (trip.hotelOptions as HotelOption[] | undefined) ?? [],
    foodSpots: [],
    topActivities: [],
    itineraryDays: [],
    dataSource: trip.source ?? "static-ranking",
    createdAt: trip.finalizedAt ?? trip.sourceCheckedAt ?? new Date().toISOString(),
    title: trip.title,
    name: trip.name,
    destination: trip.destination,
    savedSelectionState: trip.savedSelectionState
      ? {
          hotelName: trip.savedSelectionState.hotelName,
          foods: {},
          activities: {},
        }
      : undefined,
    province: trip.province,
    imageUrl: trip.imageUrl,
    confidence: trip.confidence,
    styleMatchStrength: trip.styleMatchStrength,
    score: trip.score,
    rawVibes: trip.rawVibes,
    source: trip.source,
    status: trip.status,
    finalizedAt: trip.finalizedAt,
    decisionStatus: trip.decisionStatus,
    sourceCheckedAt: trip.sourceCheckedAt,
    liveDataSummary: trip.liveDataSummary,
    providerStatus: trip.providerStatus,
    routeSummary:
      typeof trip.routeSummary?.distanceMeters === "number" &&
      typeof trip.routeSummary?.durationSeconds === "number"
        ? {
            distanceMeters: trip.routeSummary.distanceMeters,
            durationSeconds: trip.routeSummary.durationSeconds,
            origin: trip.routeSummary.origin?.label
              ? { lat: 0, lon: 0, label: trip.routeSummary.origin.label }
              : undefined,
            destination: trip.routeSummary.destination?.label
              ? { lat: 0, lon: 0, label: trip.routeSummary.destination.label }
              : undefined,
          }
        : undefined,
  };
  const momentumSummary = getTripMomentumSummary({
    ...momentumTrip,
  });
  const followUpUrgency = getTripUrgencyLevel(momentumTrip);

  const fallbackDriveHours =
    trip.driveHours !== undefined
      ? trip.driveHours
      : trip.driveHoursFromStart !== undefined
        ? trip.driveHoursFromStart
        : undefined;

  const routedDuration = formatDurationFromSeconds(
    trip.routeSummary?.durationSeconds
  );

  const driveTimeValue = routedDuration ?? formatDriveHours(fallbackDriveHours);

  const distanceValue =
    formatDistanceFromMeters(trip.routeSummary?.distanceMeters) ??
    (fallbackDriveHours !== undefined ? "Approx only" : "-");
  const summaryText = getPromptAwareTripSummary({
    summary: trip.summary,
    tripPrompt: trip.tripPrompt,
    tripLengthDays: trip.itineraryDays?.length,
    destinationName: trip.destinationName,
    destination: trip.destination,
    homeBaseCity: trip.homeBaseCity,
    name: trip.name,
  });
  const [heroImageUrl, setHeroImageUrl] = useState(
    normalizeTripImageUrl(trip.imageUrl, title)
  );

  useEffect(() => {
    setHeroImageUrl(normalizeTripImageUrl(trip.imageUrl, title));
  }, [trip.imageUrl, title]);

  const finalizedDateLabel = formatFinalizedAt(trip.finalizedAt);
  const tripDecisionLabel = decisionLabel(trip.decisionStatus);

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {heroImageUrl ? (
        <div className="aspect-[16/4.5] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          <Image
            src={heroImageUrl}
            alt={title}
            width={1600}
            height={450}
            unoptimized
            className="h-full w-full object-cover"
            onError={() => setHeroImageUrl(getFallbackImageUrl(title))}
          />
        </div>
      ) : null}

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{trip.province ?? "Alberta"}</Badge>
          <Badge tone={trip.status === "finalized" ? "green" : "slate"}>
            {trip.status === "finalized" ? "Finalized trip" : "Draft trip"}
          </Badge>
          {!isDraft && tripDecisionLabel ? (
            <Badge tone={decisionTone(trip.decisionStatus)}>
              {tripDecisionLabel}
            </Badge>
          ) : null}
          <Badge tone={confidenceTone(trip.confidence)}>
            {tripConfidenceLabel(trip.confidence)}
          </Badge>
          <Badge tone={tripSourceTone(trip)}>{sourceLabel(trip)}</Badge>
          {trip.routeSummary ? <Badge>OpenStreetMap route</Badge> : null}
        </div>

        <div className="mt-3.5">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-[2.15rem]">
            {title}
          </h1>
          {titleContext ? (
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {titleContext}
            </p>
          ) : null}

          {summaryText ? (
            <p className="mt-2.5 max-w-4xl text-[15px] leading-7 text-slate-600 dark:text-slate-300">
              {formatDisplayText(summaryText)}
            </p>
          ) : null}

          {trip.status === "finalized" && finalizedDateLabel ? (
            <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Finalized on {finalizedDateLabel}
            </p>
          ) : null}
          {!isDraft ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {tripFreshnessLabel(trip)}
            </p>
          ) : null}
          {!isDraft ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {tripTrustNote(trip)}
            </p>
          ) : null}
          {!isDraft && tripProviderStatusText(trip) ? (
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {tripProviderStatusText(trip)}
            </p>
          ) : null}
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:max-w-4xl lg:grid-cols-3">
          <Stat label="Drive time" value={driveTimeValue} />
          <Stat label="Route distance" value={distanceValue} />
          <Stat label="Style fit" value={trip.styleMatchStrength ?? "-"} />
        </div>

        {!isDraft && !isShareReviewState ? (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3 lg:max-w-4xl">
            <Stat label="Momentum" value={momentumSummary.label} />
            <Stat
              label="Responses"
              value={String(momentumSummary.responses)}
            />
            <Stat
              label="Checklist"
              value={`${momentumSummary.checklistProgress.completed}/${momentumSummary.checklistProgress.total}`}
            />
          </div>
        ) : null}

        {!isDraft && !isShareReviewState ? (
          <div className="mt-2.5 max-w-4xl">
            <Badge
              tone={
                followUpUrgency === "urgent"
                  ? "violet"
                  : followUpUrgency === "watch"
                    ? "slate"
                    : "green"
              }
            >
              {followUpUrgency === "urgent"
                ? "High follow-up urgency"
                : followUpUrgency === "watch"
                  ? "Medium follow-up urgency"
                  : "Low follow-up urgency"}
            </Badge>
          </div>
        ) : null}

        {!isDraft && !isShareReviewState && momentumSummary.stale ? (
          <div className="mt-4 rounded-[1.1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {momentumSummary.stale.detail}
          </div>
        ) : null}

        {vibes.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {vibes.map((tag) => (
              <span
                key={tag}
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {formatDisplayTag(tag)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
