"use client";

import Image from "next/image";
import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { RankedDestination, TripDataSource, TripInput } from "../lib/types";
import { buildTripPlan } from "../lib/buildTripPlan";
import { formatDisplayTag, formatDisplayText } from "../lib/displayText";
import { isStartCity } from "../lib/startCities";
import { deriveTripEndDate } from "../lib/tripDates";
import { saveTripPlan } from "../lib/tripStore";
import {
  getPromptConstraintFitSummary,
  getRecommendationContextLabel,
  getRecommendedTripTitle,
  normalizePlaceDisplayName,
} from "../lib/tripSpecificity";
import { trackProductEvent } from "../lib/productAnalytics";
import {
  tripConfidenceLabel,
  tripFreshnessLabel,
  tripProviderStatusText,
  tripSourceLabel,
  tripSourceTone,
} from "../lib/trustSignals";

const LAST_INPUT_STORAGE_KEY = "weekend-trip-last-input";

type Props = {
  trip: RankedDestination;
  input?: TripInput;
  onSave?: (tripName: string) => void;
  onRemoveSaved?: (tripName: string) => void;
  isSaved?: boolean;
};

type EnrichTripResponse = {
  success?: boolean;
  trip?: RankedDestination | null;
  source?: TripDataSource;
};

function strengthLabel(strength: RankedDestination["styleMatchStrength"]) {
  switch (strength) {
    case "strong":
      return "Strong fit";
    case "medium":
      return "Good fit";
    case "weak":
      return "Partial fit";
    default:
      return "Loose fit";
  }
}

function cleanItineraryLine(line: string) {
  return line.replace(/^day\s*\d+\s*:\s*/i, "").trim();
}

function getItineraryPreviewItems(trip: RankedDestination) {
  if (trip.aiItinerary?.length) {
    return trip.aiItinerary.slice(0, 3).map((line, index) => ({
      label: `Day ${index + 1}`,
      text: cleanItineraryLine(line),
    }));
  }

  return trip.topActivities.slice(0, 3).map((activity, index) => ({
    label: `Stop ${index + 1}`,
    text: normalizePlaceDisplayName(activity.name) || activity.name,
  }));
}

function normalizeTripInput(
  input?: Partial<TripInput> | null
): TripInput | undefined {
  if (!input) return undefined;

  const travelerCount = Number(input.travelerCount ?? 2);
  const budgetPerTraveler = Number(input.budgetPerTraveler ?? 300);
  const computedBudget = travelerCount * budgetPerTraveler;
  const tripLengthDays = Number(input.tripLengthDays ?? 2);
  const tripStartDate =
    typeof input.tripStartDate === "string" ? input.tripStartDate : undefined;

  return {
    startCity: isStartCity(input.startCity) ? input.startCity : "Edmonton",
    season: input.season ?? "Summer",
    style: input.style ?? "adventure",
    tripPrompt:
      typeof input.tripPrompt === "string"
        ? input.tripPrompt.trim() || undefined
        : undefined,
    activityFocus: input.activityFocus,
    veganFriendly: Boolean(input.veganFriendly),
    includeStaycations: Boolean(input.includeStaycations),
    strictBudget: Boolean(input.strictBudget),
    maxDriveHours: Number(input.maxDriveHours ?? 5),
    maxDriveMinutesBetweenStops: Number(
      input.maxDriveMinutesBetweenStops ?? 45
    ),
    budget: Number(input.budget ?? computedBudget),
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    preferredDestination:
      typeof input.preferredDestination === "string"
        ? input.preferredDestination.trim() || undefined
        : undefined,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
  };
}

function getStoredLastInput(): TripInput | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = sessionStorage.getItem(LAST_INPUT_STORAGE_KEY);
    if (!raw) return undefined;
    return normalizeTripInput(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to read stored planner input:", error);
    return undefined;
  }
}

function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "emerald";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
      : tone === "emerald"
        ? "border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-500/30 dark:bg-lime-500/10 dark:text-lime-200"
        : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
        {value}
      </div>
      {detail ? (
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export default function TripCard({
  trip,
  input,
  onSave,
  onRemoveSaved,
  isSaved = false,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const normalizedInput = normalizeTripInput(input);
  const displayCost =
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost;
  const travelerCount = Math.max(1, normalizedInput?.travelerCount ?? 1);
  const perTravelerDisplay = Math.round(displayCost / travelerCount);
  const itineraryPreviewItems = getItineraryPreviewItems(trip);
  const tripPrompt = normalizedInput?.tripPrompt;
  const topWhyRanked =
    trip.rankingReasons?.[0]?.label ??
    trip.matchReasons?.[0] ??
    "This was the strongest overall fit for the trip brief.";
  const promptConstraintNote = getPromptConstraintFitSummary(trip, normalizedInput);
  const whyThisIsTheCall = promptConstraintNote ?? trip.aiBestFit ?? topWhyRanked;
  const trustNote = tripProviderStatusText(trip);
  const tags = Array.isArray(trip.rawVibes) ? trip.rawVibes.slice(0, 4) : [];
  const displayTitle = getRecommendedTripTitle(
    {
      name: trip.name,
      destinationName: trip.name,
      province: trip.province,
      hotelOptions: trip.hotelOptions,
      topActivities: trip.topActivities,
    },
    normalizedInput
  );
  const titleContext = getRecommendationContextLabel(
    {
      name: trip.name,
      destinationName: trip.name,
      province: trip.province,
    },
    displayTitle
  );

  async function handleSaveTrip() {
    try {
      setSaving(true);

      let enrichedTrip = trip;
      let source: TripDataSource = trip.liveDataSummary?.usedPlacesData
        ? "live-google-places"
        : trip.liveDataSummary?.usedFallbackData
          ? "static-fallback"
          : "static-ranking";

      const propInput = normalizeTripInput(input);
      const storedInput = getStoredLastInput();
      const effectiveInput = storedInput ?? propInput;

      if (effectiveInput) {
        try {
          const enrichRes = await fetch("/api/enrich-trip", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              trip,
              input: effectiveInput,
            }),
          });

          const text = await enrichRes.text();
          let enrichData: EnrichTripResponse | null = null;

          if (text) {
            try {
              enrichData = JSON.parse(text);
            } catch (parseError) {
              console.error("Failed to parse enrich-trip response:", parseError, text);
            }
          }

          if (!enrichRes.ok) {
            console.error("enrich-trip request failed:", enrichRes.status, enrichData);
          } else {
            if (enrichData?.success && enrichData?.trip) {
              enrichedTrip = enrichData.trip;
            }

            if (
              enrichData?.source === "live-google-places" ||
              enrichData?.source === "static-fallback" ||
              enrichData?.source === "static-ranking"
            ) {
              source = enrichData.source;
            }
          }
        } catch (enrichError) {
          console.error("enrich-trip fetch failed, using current trip:", enrichError);
        }
      }

      const plan = buildTripPlan(enrichedTrip, effectiveInput, source);
      const saveResult = await saveTripPlan(plan);

      if (!saveResult.success) {
        throw new Error("Trip save failed.");
      }

      trackProductEvent("trip_built", {
        tripId: plan.id,
        destinationName: plan.destinationName,
        status: plan.status,
        decisionStatus: plan.decisionStatus,
        dataSource: plan.dataSource,
        ownerUserId: plan.ownerUserId,
        metadata: {
          accountSaved: saveResult.accountSaved,
          travelerCount: plan.travelerCount,
          totalBudget: plan.totalBudget,
        },
      });

      onSave?.(trip.name);
      router.push(`/trip/${plan.id}`);
    } catch (error) {
      console.error("Failed to save trip:", error);
      alert("Trip save failed. Check terminal/console.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {trip.imageUrl ? (
        <div className="aspect-[16/8.5] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          <Image
            src={trip.imageUrl}
            alt={displayTitle}
            width={1600}
            height={900}
            unoptimized
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="space-y-6 p-6 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">{tripConfidenceLabel(trip.confidence)}</Badge>
              <Badge>{trip.isStaycation ? "Staycation" : `${trip.province} getaway`}</Badge>
              <Badge tone={tripSourceTone(trip) === "green" ? "green" : "slate"}>
                {tripSourceLabel(trip)}
              </Badge>
            </div>

            <h3 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              {displayTitle}
            </h3>
            {titleContext ? (
              <p className="mt-2 text-sm font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                {titleContext}
              </p>
            ) : null}
            <p className="mt-2 text-base leading-7 text-slate-600 dark:text-slate-300">
              {formatDisplayText(trip.aiSummary ?? trip.summary)}
            </p>
            {tripPrompt ? (
              <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                Built for your brief: &quot;{tripPrompt}&quot;
              </p>
            ) : null}
          </div>

          <div className="rounded-[1.4rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100 lg:max-w-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">
              Why This Is The Call
            </div>
            <p className="mt-2 font-semibold text-slate-950 dark:text-slate-100">
              {whyThisIsTheCall}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Stat
            label="Estimated total"
            value={`$${Math.round(displayCost)}`}
            detail={`${travelerCount} traveler${travelerCount === 1 ? "" : "s"}`}
          />
          <Stat
            label="Per traveler"
            value={`$${perTravelerDisplay}`}
            detail={trip.aiBudgetNote ?? "Budget will update when you swap stops."}
          />
          <Stat
            label="Drive and fit"
            value={`${trip.driveHoursFromStart}h`}
            detail={strengthLabel(trip.styleMatchStrength)}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Trip shape
            </div>
            <div className="mt-3 space-y-3">
              {itineraryPreviewItems.length > 0 ? (
                itineraryPreviewItems.map((item) => (
                  <div
                    key={`${item.label}-${item.text}`}
                    className="rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {item.label}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
                      {item.text}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Open the trip builder to see the stop-by-stop itinerary.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Decision notes
            </div>

            <div className="mt-3 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Lead reason
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {topWhyRanked}
              </p>
            </div>

            {promptConstraintNote ? (
              <div className="mt-3 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                  Constraint check
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {promptConstraintNote}
                </p>
              </div>
            ) : null}

            <div className="mt-3 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Builder promise
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Open the builder to change a specific day, swap the stay, or fit
                a different activity into the trip without rebuilding from scratch.
              </p>
            </div>

            <div className="mt-3 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Planning trust
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {tripFreshnessLabel(trip)}
              </p>
              {trustNote ? (
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {trustNote}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {formatDisplayTag(tag)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {isSaved ? (
            <button
              type="button"
              onClick={() => onRemoveSaved?.(trip.name)}
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20"
            >
              Remove saved trip
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveTrip}
              disabled={saving}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
            >
              {saving ? "Opening builder..." : "Build this trip"}
            </button>
          )}

          <div className="inline-flex min-h-12 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Day-level edits happen after you open the builder.
          </div>
        </div>
      </div>
    </article>
  );
}
