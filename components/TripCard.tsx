"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { RankedDestination, TripDataSource, TripInput } from "../lib/types";
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
import {
  getFallbackImageUrl,
  normalizeTripImageSet,
} from "../lib/tripImages";
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
    return `Comfortably under your $${Math.round(budget)} group budget.`;
  }

  if (total <= budget) {
    return `Currently within your $${Math.round(budget)} group budget.`;
  }

  return `Currently above your $${Math.round(budget)} group budget.`;
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

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "accent";
}) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50/78 text-emerald-700 dark:border-emerald-300/24 dark:bg-emerald-400/10 dark:text-emerald-100"
      : tone === "accent"
        ? "border-[#ecd7b7] bg-[#fff8ee]/78 text-[#8a5b18] dark:border-[#d9b57c]/28 dark:bg-[#d9b57c]/12 dark:text-[#f6e1be]"
        : "border-slate-200/80 bg-[#fbf7ef]/62 text-slate-700 dark:border-white/12 dark:bg-white/8 dark:text-white/82";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm ${toneClass}`}
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
    <div className="rounded-[1.45rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(249,245,238,0.74),rgba(240,244,248,0.72))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-sm dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] dark:shadow-none">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-white/48">
        {label}
      </div>
      <div className="mt-3 text-[1.9rem] font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
        {value}
      </div>
      {detail ? (
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-white/64">{detail}</p>
      ) : null}
    </div>
  );
}

function confidenceTone(confidence?: RankedDestination["confidence"]) {
  return confidence === "high" ? "positive" : "neutral";
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
  const [imageFailures, setImageFailures] = useState({
    light: false,
    dark: false,
  });

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
  const heroImageSet = normalizeTripImageSet(
    {
      imageUrl: previewTrip.imageUrl || trip.imageUrl,
      imageUrlLight:
        previewTrip.imageUrlLight ||
        trip.imageUrlLight ||
        previewTrip.imageUrl ||
        trip.imageUrl,
      imageUrlDark:
        previewTrip.imageUrlDark ||
        trip.imageUrlDark ||
        previewTrip.imageUrlLight ||
        trip.imageUrlLight ||
        previewTrip.imageUrl ||
        trip.imageUrl,
    },
    displayTitle
  );
  const lightHeroImageUrl = imageFailures.light
    ? getFallbackImageUrl(displayTitle)
    : heroImageSet.lightUrl;
  const darkHeroImageUrl = imageFailures.dark
    ? getFallbackImageUrl(displayTitle)
    : heroImageSet.darkUrl;
  const displaySummary = getPromptAwareTripSummary({
    summary: previewTrip.aiSummary ?? previewTrip.summary,
    tripPrompt,
    tripLengthDays: previewPlan.safeInput.tripLengthDays,
    destinationName: previewTrip.name,
    destination: previewTrip.name,
    homeBaseCity: previewTrip.homeBaseCity,
    name: previewTrip.name,
    topActivities: previewTrip.topActivities,
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
    <article className="overflow-hidden rounded-[2.2rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(247,244,238,0.78),rgba(238,243,248,0.84))] text-slate-950 shadow-[0_32px_90px_rgba(148,163,184,0.14)] backdrop-blur-sm dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(12,18,30,0.98),rgba(9,15,27,0.95))] dark:text-white dark:shadow-[0_32px_90px_rgba(0,0,0,0.28)]">
      <div className="relative aspect-[16/8.6] overflow-hidden bg-slate-200/70 dark:bg-[#121c29]">
        <Image
          key={`light:${lightHeroImageUrl}`}
          src={lightHeroImageUrl}
          alt={displayTitle}
          width={1600}
          height={900}
          unoptimized
          className="h-full w-full object-cover dark:hidden"
          onError={() =>
            setImageFailures((current) => ({ ...current, light: true }))
          }
        />
        <Image
          key={`dark:${darkHeroImageUrl}`}
          src={darkHeroImageUrl}
          alt={displayTitle}
          width={1600}
          height={900}
          unoptimized
          className="hidden h-full w-full object-cover dark:block"
          onError={() =>
            setImageFailures((current) => ({ ...current, dark: true }))
          }
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(247,244,238,0.08)_36%,rgba(240,236,229,0.52)_100%)] dark:hidden" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(180deg,rgba(4,8,14,0.06)_0%,rgba(5,10,16,0.28)_42%,rgba(5,10,16,0.88)_100%)] dark:block" />

        <div className="absolute left-0 right-0 top-0 flex flex-wrap gap-2 p-5 sm:p-6">
          <Pill tone={confidenceTone(previewTrip.confidence)}>
            {tripConfidenceLabel(previewTrip.confidence)}
          </Pill>
          <Pill tone="accent">
            {previewTrip.isStaycation
              ? "Staycation"
              : `${previewTrip.province} getaway`}
          </Pill>
          <Pill tone={tripSourceTone(previewTrip) === "green" ? "positive" : "neutral"}>
            {tripSourceLabel(previewTrip)}
          </Pill>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
          <div className="max-w-4xl">
            {titleContext ? (
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b9802f] dark:text-[#e6c895]">
                {titleContext}
              </div>
            ) : null}
            <h3 className="mt-3 font-serif text-[2.5rem] leading-[0.96] tracking-[-0.05em] text-slate-950 [text-shadow:0_1px_0_rgba(255,255,255,0.2)] dark:text-white sm:text-[3.3rem]">
              {displayTitle}
            </h3>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-800 [text-shadow:0_1px_0_rgba(255,255,255,0.18)] dark:text-white/78">
              {formatDisplayText(
                displaySummary ?? previewTrip.aiSummary ?? previewTrip.summary
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6 sm:p-7">
        <div className="grid gap-4 md:grid-cols-3">
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
          <section className="rounded-[1.6rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,244,238,0.6),rgba(240,244,248,0.66))] p-5 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(19,28,43,0.78),rgba(11,18,31,0.74))]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-white/46">
              Trip shape
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {itineraryPreviewItems.map((item) => (
                <div
                  key={`${item.label}-${item.text}`}
                  className="rounded-[1.25rem] border border-slate-200 bg-[#fcf8f1]/72 px-4 py-4 dark:border-white/8 dark:bg-[#121c29]"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d9b57c]">
                    {item.label}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-white/76">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {tripPrompt ? (
          <div className="rounded-[1.35rem] border border-[#ecd7b7] bg-[linear-gradient(180deg,rgba(255,248,238,0.82),rgba(249,241,227,0.72))] px-4 py-3 text-sm leading-6 text-slate-700 dark:border-[#d9b57c]/18 dark:bg-[linear-gradient(180deg,rgba(39,33,25,0.68),rgba(16,20,30,0.96))] dark:text-white/74">
            Built around your brief so you can open the builder and refine the days from there.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          {isSaved ? (
            <button
              type="button"
              onClick={() => onRemoveSaved?.(trip.name)}
              className="inline-flex h-12 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-300/24 dark:bg-rose-400/10 dark:text-rose-100 dark:hover:bg-rose-400/16"
            >
              Remove saved trip
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveTrip}
              disabled={saving}
              className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:border dark:border-[#7decc7]/18 dark:bg-[linear-gradient(180deg,rgba(15,42,46,0.96),rgba(8,24,34,0.98))] dark:text-[#ebfff7] dark:hover:bg-[linear-gradient(180deg,rgba(18,50,55,0.98),rgba(10,30,41,0.98))]"
            >
              {saving ? "Opening builder..." : "Build this trip"}
            </button>
          )}

          <div className="inline-flex min-h-12 items-center rounded-full border border-slate-200 bg-[#fbf7ef]/66 px-4 py-2 text-sm text-slate-600 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(22,31,46,0.84),rgba(12,18,31,0.9))] dark:text-white/66">
            Open the builder for day-by-day details, swaps, and final planning.
          </div>
        </div>
      </div>
    </article>
  );
}
