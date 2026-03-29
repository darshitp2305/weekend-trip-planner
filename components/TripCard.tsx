"use client";

/**
 * Reusable UI component for the trip card section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */


import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RankedDestination,
  TripDataSource,
  TripInput,
} from "../lib/types";
import { buildTripPlan, buildTripPlanPreview } from "../lib/buildTripPlan";
import { formatDisplayText } from "../lib/displayText";
import { isStartCity } from "../lib/startCities";
import { deriveTripEndDate } from "../lib/tripDates";
import { saveTripPlan } from "../lib/tripStore";
import {
  buildDefaultSelectionState,
  calculateSelectedBudget,
} from "../lib/tripSelections";
import {
  getPromptAwareTripSummary,
  getRecommendationContextLabel,
} from "../lib/tripSpecificity";
import { trackProductEvent } from "../lib/productAnalytics";
import { getFallbackImageUrl, normalizeTripImageUrl } from "../lib/tripImages";
import {
  tripConfidenceLabel,
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

function budgetFitDetail(total: number, budget?: number) {
  if (typeof budget !== "number" || budget <= 0) {
    return "Budget will update when you swap stops.";
  }

  if (total <= budget * 0.7) {
    return `Estimated total sits comfortably under your $${Math.round(budget)} group budget.`;
  }

  if (total <= budget) {
    return `Estimated total stays within your $${Math.round(budget)} group budget.`;
  }

  return `Estimated total is currently above your $${Math.round(budget)} group budget.`;
}

function cleanItineraryLine(line: string) {
  return line.replace(/^day\s*\d+\s*:\s*/i, "").trim();
}

function getItineraryPreviewItems(trip: RankedDestination, itineraryDays: unknown[]) {
  if (itineraryDays.length) {
    return itineraryDays.slice(0, 2).map((day, index) => {
      const typedDay = day as {
        summary?: string;
        title?: string;
        stops?: Array<{ kind?: string; title?: string }>;
      };
      const firstMeaningfulStop = typedDay.stops?.find(
        (stop) => stop.kind && stop.kind !== "travel"
      );
      const text =
        typedDay.summary?.trim() ||
        firstMeaningfulStop?.title?.trim() ||
        typedDay.title?.trim() ||
        `Day ${index + 1}`;

      return {
        label: `Day ${index + 1}`,
        text: cleanItineraryLine(text),
      };
    });
  }

  if (trip.aiItinerary?.length) {
    return trip.aiItinerary.slice(0, 2).map((line, index) => ({
      label: `Day ${index + 1}`,
      text: cleanItineraryLine(line),
    }));
  }

  return trip.topActivities.slice(0, 2).map((activity, index) => ({
    label: `Stop ${index + 1}`,
    text: activity.name,
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
  const departureTime =
    typeof input.departureTime === "string" ? input.departureTime : undefined;

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
    departureTime,
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

function confidenceTone(confidence?: RankedDestination["confidence"]) {
  return confidence === "high" ? "green" : "slate";
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
  const previewPlan = buildTripPlanPreview(trip, normalizedInput);
  const previewTrip = previewPlan.filteredTrip;
  const travelerCount = Math.max(1, previewPlan.safeInput.travelerCount ?? 1);
  const defaultSelection = buildDefaultSelectionState(
    previewPlan.itineraryDays,
    previewTrip.hotelOptions ?? [],
    previewTrip.foodSpots ?? [],
    previewTrip.topActivities ?? []
  );
  const displayBudget = calculateSelectedBudget({
    tripLengthDays: previewPlan.safeInput.tripLengthDays,
    travelerCount,
    hotelOptions: previewTrip.hotelOptions ?? [],
    foodSpots: previewTrip.foodSpots ?? [],
    activities: previewTrip.topActivities ?? [],
    itineraryDays: previewPlan.itineraryDays,
    selection: defaultSelection,
    fallbackBreakdown: previewPlan.budgetBreakdown,
  });
  const displayCost = displayBudget.totalExpected;
  const perTravelerDisplay = Math.round(displayCost / travelerCount);
  const itineraryPreviewItems = getItineraryPreviewItems(
    previewTrip,
    previewPlan.itineraryDays
  );
  const tripPrompt = previewPlan.safeInput.tripPrompt;
  const displayTitle = previewPlan.recommendedTitle;
  const [heroImageUrl, setHeroImageUrl] = useState(
    normalizeTripImageUrl(previewTrip.imageUrl || trip.imageUrl, displayTitle)
  );
  const displaySummary = getPromptAwareTripSummary({
    summary: previewTrip.aiSummary ?? previewTrip.summary,
    tripPrompt,
    tripLengthDays: previewPlan.safeInput.tripLengthDays,
    destinationName: previewTrip.name,
    destination: previewTrip.name,
    homeBaseCity: previewTrip.homeBaseCity,
    name: previewTrip.name,
  });
  const titleContext = getRecommendationContextLabel(
    {
      name: previewTrip.name,
      destinationName: previewTrip.name,
      destination: previewTrip.name,
      homeBaseCity: previewTrip.homeBaseCity,
      province: previewTrip.province,
    },
    displayTitle
  );

  useEffect(() => {
    setHeroImageUrl(
      normalizeTripImageUrl(previewTrip.imageUrl || trip.imageUrl, displayTitle)
    );
  }, [displayTitle, previewTrip.imageUrl, trip.imageUrl]);

  async function handleSaveTrip() {
    try {
      setSaving(true);

      const source: TripDataSource = trip.liveDataSummary?.usedPlacesData
        ? "live-google-places"
        : trip.liveDataSummary?.usedFallbackData
          ? "static-fallback"
          : "static-ranking";

      const propInput = normalizeTripInput(input);
      const storedInput = getStoredLastInput();
      const effectiveInput = propInput ?? storedInput ?? previewPlan.safeInput;
      const basePlan = buildTripPlan(trip, effectiveInput, source);
      const plan = {
        ...basePlan,
        savedSelectionState: defaultSelection,
        budgetBreakdown: displayBudget,
      };
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
      {heroImageUrl ? (
        <div className="aspect-[16/8.5] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          <Image
            src={heroImageUrl}
            alt={displayTitle}
            width={1600}
            height={900}
            unoptimized
            className="h-full w-full object-cover"
            onError={() => setHeroImageUrl(getFallbackImageUrl(displayTitle))}
          />
        </div>
      ) : null}

      <div className="space-y-6 p-6 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap gap-2">
              <Badge tone={confidenceTone(previewTrip.confidence)}>
                {tripConfidenceLabel(previewTrip.confidence)}
              </Badge>
              <Badge>
                {previewTrip.isStaycation
                  ? "Staycation"
                  : `${previewTrip.province} getaway`}
              </Badge>
              <Badge
                tone={
                  tripSourceTone(previewTrip) === "green" ? "green" : "slate"
                }
              >
                {tripSourceLabel(previewTrip)}
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
              {formatDisplayText(
                displaySummary ?? previewTrip.aiSummary ?? previewTrip.summary
              )}
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
            detail={budgetFitDetail(displayCost, previewPlan.safeInput.budget)}
          />
          <Stat
            label="Drive and fit"
            value={previewPlan.driveTimeText}
            detail={strengthLabel(previewTrip.styleMatchStrength)}
          />
        </div>

        {itineraryPreviewItems.length > 0 ? (
          <section className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Trip shape
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {itineraryPreviewItems.map((item) => (
                <div
                  key={`${item.label}-${item.text}`}
                  className="rounded-[1rem] bg-white px-4 py-3 dark:bg-slate-900"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    {item.label}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {tripPrompt ? (
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            Built around your brief so you can open the builder and adjust the days from there.
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
            Open the builder for day-by-day details and edits.
          </div>
        </div>
      </div>
    </article>
  );
}
