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
      ? "border-emerald-300/24 bg-emerald-400/10 text-emerald-100"
      : tone === "accent"
        ? "border-[#d9b57c]/28 bg-[#d9b57c]/12 text-[#f6e1be]"
        : "border-white/12 bg-white/8 text-white/82";

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
    <div className="rounded-[1.45rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-5 backdrop-blur-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/48">
        {label}
      </div>
      <div className="mt-3 text-[1.9rem] font-semibold tracking-[-0.04em] text-white">
        {value}
      </div>
      {detail ? (
        <p className="mt-2 text-sm leading-6 text-white/64">{detail}</p>
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
  const [imageFailed, setImageFailed] = useState(false);

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
  const primaryHeroImageUrl = normalizeTripImageUrl(
    previewTrip.imageUrl || trip.imageUrl,
    displayTitle
  );
  const heroImageUrl = imageFailed
    ? getFallbackImageUrl(displayTitle)
    : primaryHeroImageUrl;
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
    <article className="overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#0b1420] text-white shadow-[0_32px_90px_rgba(0,0,0,0.28)]">
      <div className="relative aspect-[16/8.6] overflow-hidden bg-[#121c29]">
        <Image
          key={heroImageUrl}
          src={heroImageUrl}
          alt={displayTitle}
          width={1600}
          height={900}
          unoptimized
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,8,14,0.06)_0%,rgba(5,10,16,0.28)_42%,rgba(5,10,16,0.88)_100%)]" />

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
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e6c895]">
                {titleContext}
              </div>
            ) : null}
            <h3 className="mt-3 font-serif text-[2.5rem] leading-[0.96] tracking-[-0.05em] text-white sm:text-[3.3rem]">
              {displayTitle}
            </h3>
            <p className="mt-4 max-w-3xl text-base leading-7 text-white/78">
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
          <section className="rounded-[1.6rem] border border-white/10 bg-white/4 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/46">
              Trip shape
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {itineraryPreviewItems.map((item) => (
                <div
                  key={`${item.label}-${item.text}`}
                  className="rounded-[1.25rem] border border-white/8 bg-[#121c29] px-4 py-4"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d9b57c]">
                    {item.label}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/76">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {tripPrompt ? (
          <div className="rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(217,181,124,0.09),rgba(255,255,255,0.03))] px-4 py-3 text-sm leading-6 text-white/74">
            Built around your brief so you can open the builder and refine the days from there.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          {isSaved ? (
            <button
              type="button"
              onClick={() => onRemoveSaved?.(trip.name)}
              className="inline-flex h-12 items-center justify-center rounded-full border border-rose-300/24 bg-rose-400/10 px-5 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/16"
            >
              Remove saved trip
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveTrip}
              disabled={saving}
              className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-slate-950 transition hover:bg-[#f5efe5] disabled:opacity-60"
            >
              {saving ? "Opening builder..." : "Build this trip"}
            </button>
          )}

          <div className="inline-flex min-h-12 items-center rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-white/66">
            Open the builder for day-by-day details, swaps, and final planning.
          </div>
        </div>
      </div>
    </article>
  );
}
