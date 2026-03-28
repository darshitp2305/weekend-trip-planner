"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { applyItineraryPrompt, extractDesiredText } from "../lib/itineraryPrompt";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripCustomStop,
  TripSelectionState,
} from "../lib/types";
import {
  estimateFoodCostForGroup,
  estimateFoodCostRangeForGroup,
  foodPricingSourceLabel,
} from "../lib/foodPricing";
import {
  buildDefaultSelectionState,
  getAddedStopsForDay,
  getCustomStopForKey,
  normalizeSelectionState,
} from "../lib/tripSelections";
import { preferredHotelBookingUrl } from "../lib/expediaLinks";
import {
  hotelAvailabilityLabel,
  hotelAvailabilityPriorityFor,
  hotelAvailabilityTone,
} from "../lib/hotelAvailability";
import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

type Props = {
  days: ItineraryDayData[];
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  activities: Activity[];
  travelerCount: number;
  initialSelection?: TripSelectionState;
  destinationImageUrl?: string;
  destinationLabel?: string;
  tripStartDate?: string;
  tripEndDate?: string;
  startCityLabel?: string;
  startCityCoordinate?: {
    latitude: number;
    longitude: number;
  };
  onSelectionChange?: (selection: TripSelectionState) => void;
};

type StopOption = {
  name: string;
  subtitle?: string;
  rating?: number;
  estimatedCost?: number;
  estimatedCostLabel?: string;
  primaryUrl?: string;
  primaryLabel?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  category?: string;
  totalStayPrice?: number;
  pricePerNight?: number;
  photoRef?: string;
  photoUrl?: string;
  fallbackPhotoUrl?: string;
  latitude?: number;
  longitude?: number;
  availabilityLabel?: string;
  availabilityTone?: "slate" | "green" | "violet" | "amber" | "rose";
};

type StopCoordinate = {
  label: string;
  latitude: number;
  longitude: number;
};

type ResolvedStopChoice = {
  name: string;
  shortDescription?: string;
  rating?: number;
  estimatedCost?: number;
  category?: string;
  type?: string;
  websiteUrl?: string;
  mapsUrl?: string;
  bookingLink?: string;
  photoRef?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  source: "catalog" | "custom";
  sourceType?: TripCustomStop["sourceType"];
};

function buildPhotoUrl(photoRef?: string) {
  if (!photoRef) return undefined;
  return `/api/place-photo?ref=${encodeURIComponent(photoRef)}`;
}

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function optionSortScore(name: string, preferredTitle?: string) {
  const optionName = normalized(name);
  const title = normalized(preferredTitle);

  if (!title) return 0;
  if (optionName === title) return 100;
  if (optionName.includes(title) || title.includes(optionName)) return 80;
  return 0;
}

// Keep food pricing consistent with the shared trip budget logic.
function guessFoodCost(spot: FoodSpot, travelers: number) {
  return estimateFoodCostForGroup(spot, travelers);
}

function resolvedFoodCost(choice: ResolvedStopChoice, travelers: number) {
  if (choice.source === "custom") {
    return choice.estimatedCost ?? 0;
  }

  return estimateFoodCostForGroup(
    {
      name: choice.name,
      tags: [],
      category: choice.category,
      estimatedCost: choice.estimatedCost,
    },
    travelers
  );
}

function formatMoney(value: number) {
  return `$${Math.round(value)}`;
}

function timeWindowLabel(time?: string) {
  switch (normalized(time)) {
    case "morning":
      return "8:00-10:00 AM";
    case "late morning":
      return "10:30 AM-12:30 PM";
    case "late morning to afternoon":
      return "10:30 AM-4:00 PM";
    case "afternoon":
      return "1:00-4:00 PM";
    case "late afternoon":
      return "4:00-6:00 PM";
    case "evening":
      return "6:00-8:30 PM";
    case "night":
      return "After 8:00 PM";
    case "anytime":
      return "Flexible timing";
    default:
      return undefined;
  }
}

function shiftTimeLabel(time?: string, steps = 0) {
  if (!time || steps <= 0) return time;

  const orderedTimes = [
    "morning",
    "late morning",
    "afternoon",
    "late afternoon",
    "evening",
    "night",
  ];
  const currentIndex = orderedTimes.indexOf(normalized(time));
  if (currentIndex < 0) return time;

  return orderedTimes[Math.min(orderedTimes.length - 1, currentIndex + steps)];
}

function guessActivityCost(activity: Activity, travelers: number) {
  const base = activity.costEstimate ?? activity.estimatedCost ?? 0;
  return base * Math.max(1, travelers);
}

function resolvedActivityCost(choice: ResolvedStopChoice, travelers: number) {
  if (choice.source === "custom") {
    return choice.estimatedCost ?? 0;
  }

  return (choice.estimatedCost ?? 0) * Math.max(1, travelers);
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function isDemandingHikeText(value?: string) {
  const text = normalized(value);
  if (!text) return false;

  const summitSignal =
    ["summit", "peak", "ridge", "scramble", "alpine", "mountain"].some((term) =>
      text.includes(term)
    );
  const hikeSignal =
    ["trail", "hike", "trailhead", "backcountry"].some((term) =>
      text.includes(term)
    );

  return text.includes("signature summit-style hike") || (summitSignal && hikeSignal);
}

function isDemandingHikeStop(
  stop: { title?: string; description?: string },
  activity?: Pick<Activity, "name" | "type" | "shortDescription"> | ResolvedStopChoice
) {
  return isDemandingHikeText(
    [stop.title, stop.description, activity?.name, activity?.type, activity?.shortDescription]
      .filter(Boolean)
      .join(" ")
  );
}

function activityPlannerLabel(
  stop: { title?: string; description?: string },
  activity?: Pick<Activity, "name">
) {
  const name = activity?.name?.trim();
  if (!name) return "Activity";

  if (isDemandingHikeText([stop.title, stop.description, name].filter(Boolean).join(" "))) {
    return name.replace(/\s*trailhead$/i, "").trim();
  }

  return name;
}

function toStopCoordinate(
  label: string,
  latitude?: number,
  longitude?: number
): StopCoordinate | undefined {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return undefined;
  }

  return { label, latitude, longitude };
}

function customStopChoice(stop: TripCustomStop): ResolvedStopChoice {
  return {
    name: stop.title,
    shortDescription: stop.description,
    rating: stop.rating,
    estimatedCost: stop.estimatedCost,
    category: stop.category,
    websiteUrl: stop.websiteUrl,
    mapsUrl: stop.mapsUrl,
    photoRef: stop.photoRef,
    photoUrl: stop.photoUrl,
    latitude: stop.latitude,
    longitude: stop.longitude,
    source: "custom",
    sourceType: stop.sourceType,
  };
}

function choiceCoordinate(choice?: ResolvedStopChoice) {
  if (!choice) return undefined;
  return toStopCoordinate(choice.name, choice.latitude, choice.longitude);
}

function customChoiceLabel(choice?: ResolvedStopChoice) {
  if (!choice || choice.source !== "custom") return null;

  return choice.sourceType === "catalog_match"
    ? "Matched from builder prompt"
    : "Traveler-requested stop";
}

function foodChoice(spot: FoodSpot): ResolvedStopChoice {
  return {
    name: spot.name,
    shortDescription: spot.shortDescription,
    rating: spot.rating,
    category: spot.category ?? spot.tags?.[0] ?? "Food stop",
    websiteUrl: spot.websiteUrl || spot.link,
    mapsUrl: spot.mapsUrl,
    photoRef: spot.photoRef,
    photoUrl: spot.photoUrl,
    latitude: spot.latitude,
    longitude: spot.longitude,
    source: "catalog",
  };
}

function activityChoice(activity: Activity): ResolvedStopChoice {
  return {
    name: activity.name,
    shortDescription: activity.shortDescription,
    rating: activity.rating,
    estimatedCost: activity.costEstimate ?? activity.estimatedCost ?? 0,
    type: activity.type,
    category: activity.type,
    websiteUrl: activity.websiteUrl,
    mapsUrl: activity.mapsUrl,
    bookingLink: activity.bookingLink,
    photoRef: activity.photoRef,
    photoUrl: activity.photoUrl,
    latitude: activity.latitude,
    longitude: activity.longitude,
    source: "catalog",
  };
}

function haversineDistanceKm(from: StopCoordinate, to: StopCoordinate) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceKmFromCoordinate(
  base: StopCoordinate | undefined,
  latitude?: number,
  longitude?: number
) {
  const candidate = toStopCoordinate("candidate", latitude, longitude);
  if (!base || !candidate) return undefined;
  return haversineDistanceKm(base, candidate);
}

function proximitySortScore(distanceKm?: number) {
  // Nearby swaps keep the generated day coherent, so distance heavily shapes
  // the recommended alternatives shown in the picker.
  if (distanceKm === undefined) return 0;
  if (distanceKm <= 0.5) return 140;
  if (distanceKm <= 2) return 110;
  if (distanceKm <= 5) return 80;
  if (distanceKm <= 10) return 45;
  if (distanceKm <= 20) return 10;
  if (distanceKm <= 40) return -40;
  if (distanceKm <= 80) return -120;
  return -260;
}

function formatDistanceFromPrevious(
  previous: StopCoordinate | undefined,
  current: StopCoordinate | undefined
) {
  if (!previous || !current) return undefined;

  const distanceKm = haversineDistanceKm(previous, current);
  const formattedDistance = formatDistanceKm(distanceKm);
  const transferMinutes = estimateTransferMinutes(distanceKm);

  return `${formatTransferMinutes(transferMinutes)} / ${formattedDistance} from ${previous.label}`;
}

function formatDistanceKm(distanceKm: number) {
  return `${distanceKm.toFixed(distanceKm >= 10 ? 0 : 1)} km`;
}

function estimateTransferMinutes(distanceKm: number) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;

  const minutes = Math.round((distanceKm / 55) * 60);
  return Math.max(5, minutes);
}

function formatTransferMinutes(minutes: number) {
  if (minutes < 60) {
    return `~${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `~${hours} hr`;
  }

  return `~${hours} hr ${remainingMinutes} min`;
}

function OptionPill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "violet" | "amber" | "rose";
}) {
  const className =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
      : tone === "amber"
        ? "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      : tone === "rose"
        ? "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
      : tone === "violet"
        ? "border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
        : "border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function CampfireBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M5.3 14 8 8.9 10.7 14H5.3Z"
          fill="currentColor"
          opacity="0.9"
        />
        <path
          d="M7.2 8.4c-.7-.6-1.1-1.4-1.1-2.2 0-1.2.7-2.2 1.9-3 .2.8.7 1.3 1.1 1.8.4.4.8.9.8 1.6 0 .8-.5 1.5-1.3 1.8-.2-.7-.7-1.3-1.4-2Z"
          fill="currentColor"
        />
        <path
          d="M4.2 13.9 2.6 11.7M11.8 13.9l1.6-2.2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      Camping
    </span>
  );
}

function BuilderPromptPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {children}
    </span>
  );
}

function isCampingOnlyLikeOption(option: {
  name: string;
  subtitle?: string;
  category?: string;
}) {
  const text = [option.name, option.subtitle, option.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    text.includes("campground") ||
    text.includes("camping") ||
    text.includes("campsite") ||
    text.includes("provincial park") ||
    text.includes("national park") ||
    text.includes("rv park")
  );
}

function SelectorCard({
  option,
  selected,
  recommended,
  distanceFromPrevious,
  selectedElsewhereLabel,
  onSelect,
}: {
  option: StopOption;
  selected: boolean;
  recommended: boolean;
  distanceFromPrevious?: string;
  selectedElsewhereLabel?: string;
  onSelect: () => void;
}) {
  const previewImageUrl =
    buildPhotoUrl(option.photoRef) ?? option.photoUrl ?? option.fallbackPhotoUrl;
  const showCampingBadge = isCampingOnlyLikeOption(option);
  const safePrimaryUrl = sanitizeExternalNavigationUrl(option.primaryUrl);
  const safeMapsUrl = sanitizeExternalNavigationUrl(option.mapsUrl);

  return (
    <div
      className={
        selected
          ? "group rounded-[1rem] border border-violet-300 bg-violet-50 p-3.5 text-left shadow-[inset_0_0_0_1px_rgba(139,92,246,0.06)] dark:border-violet-500/40 dark:bg-violet-500/10"
          : "group rounded-[1rem] border border-slate-200 bg-white p-3.5 text-left hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-6 text-slate-950 dark:text-slate-100">
            {option.name}
          </div>
          {option.subtitle ? (
            <div className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              {option.subtitle}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-1.5">
          {showCampingBadge ? <CampfireBadge /> : null}
          {recommended ? <OptionPill tone="violet">Recommended</OptionPill> : null}
          {selectedElsewhereLabel ? (
            <OptionPill tone="slate">{selectedElsewhereLabel}</OptionPill>
          ) : null}
          {option.availabilityLabel ? (
            <OptionPill tone={option.availabilityTone ?? "amber"}>
              {option.availabilityLabel}
            </OptionPill>
          ) : null}
          {option.rating !== undefined ? (
            <OptionPill tone="green">Rating {option.rating}</OptionPill>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {option.category ? <OptionPill>{option.category}</OptionPill> : null}
        {option.pricePerNight !== undefined ? (
          <OptionPill>${option.pricePerNight}/night</OptionPill>
        ) : null}
        {option.totalStayPrice !== undefined ? (
          <OptionPill>Total ${option.totalStayPrice}</OptionPill>
        ) : null}
        {option.estimatedCost !== undefined ? (
          <OptionPill>
            {option.estimatedCost === 0
              ? "Free"
              : option.estimatedCostLabel ?? `$${option.estimatedCost}`}
          </OptionPill>
        ) : null}
      </div>

      {distanceFromPrevious ? (
        <div className="mt-2 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
          {distanceFromPrevious}
        </div>
      ) : null}

      {previewImageUrl ? (
        <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mt-3 group-hover:max-h-40 group-hover:opacity-100 group-focus-visible:mt-3 group-focus-visible:max-h-40 group-focus-visible:opacity-100">
          <div className="overflow-hidden rounded-[0.9rem] border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
            <Image
              src={previewImageUrl}
              alt={option.name}
              width={800}
              height={288}
              unoptimized
              className="h-36 w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          className={
            selected
              ? "inline-flex h-10 items-center justify-center rounded-full bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
              : "inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
          }
        >
          {selected ? "Selected" : "Choose this"}
        </button>

        {safePrimaryUrl ? (
          <a
            href={safePrimaryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {option.primaryLabel ?? "Visit site"}
          </a>
        ) : null}

        {safeMapsUrl ? (
          <a
            href={safeMapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Open map
          </a>
        ) : null}
      </div>
    </div>
  );
}

function CompactSelectionCard({
  label,
  title,
  subtitle,
  pills,
  primaryUrl,
  primaryLabel,
  mapsUrl,
  photoRef,
  photoUrl,
  fallbackPhotoUrl,
  editing,
  onToggleEditing,
}: {
  label: string;
  title: string;
  subtitle?: string;
  pills?: string[];
  primaryUrl?: string;
  primaryLabel?: string;
  mapsUrl?: string;
  photoRef?: string;
  photoUrl?: string;
  fallbackPhotoUrl?: string;
  editing: boolean;
  onToggleEditing: () => void;
}) {
  const previewImageUrl =
    buildPhotoUrl(photoRef) ?? photoUrl ?? fallbackPhotoUrl;
  const showCampingBadge = isCampingOnlyLikeOption({
    name: title,
    subtitle,
    category: pills?.[0],
  });
  const safePrimaryUrl = sanitizeExternalNavigationUrl(primaryUrl);
  const safeMapsUrl = sanitizeExternalNavigationUrl(mapsUrl);

  return (
    <div className="group rounded-[1rem] border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            {label}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
            {title}
          </div>
          {subtitle ? (
            <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              {subtitle}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onToggleEditing}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {editing ? "Hide options" : "Change"}
        </button>
      </div>

      {showCampingBadge ? (
        <div className="mt-2">
          <CampfireBadge />
        </div>
      ) : null}

      {pills && pills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pills.map((pill) => (
            <OptionPill key={pill}>{pill}</OptionPill>
          ))}
        </div>
      ) : null}

      {(safePrimaryUrl || safeMapsUrl) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {safePrimaryUrl ? (
            <a
              href={safePrimaryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {primaryLabel ?? "Visit site"}
            </a>
          ) : null}
          {safeMapsUrl ? (
            <a
              href={safeMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Open map
            </a>
          ) : null}
        </div>
      ) : null}

      {previewImageUrl ? (
        <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mt-3 group-hover:max-h-40 group-hover:opacity-100 group-focus-within:mt-3 group-focus-within:max-h-40 group-focus-within:opacity-100">
          <div className="overflow-hidden rounded-[0.9rem] border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
            <Image
              src={previewImageUrl}
              alt={title}
              width={800}
              height={288}
              unoptimized
              className="h-36 w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function InteractiveItinerary({
  days,
  hotels,
  foodSpots,
  activities,
  travelerCount,
  initialSelection,
  destinationImageUrl,
  destinationLabel,
  tripStartDate,
  tripEndDate,
  startCityLabel,
  startCityCoordinate,
  onSelectionChange,
}: Props) {
  // Seed the planner from the generated itinerary so each day already has a
  // sensible default hotel, food stop, and activity before the user edits it.
  const defaultSelection = useMemo<TripSelectionState>(
    () => buildDefaultSelectionState(days, hotels, foodSpots, activities),
    [activities, days, foodSpots, hotels]
  );

  const [selection, setSelection] = useState<TripSelectionState>(() =>
    normalizeSelectionState(initialSelection ?? defaultSelection)
  );
  // Keep only one option grid open at a time so the long trip page stays
  // easier to scan and compare.
  const [editingStopKey, setEditingStopKey] = useState<string | null>(null);
  const [builderPrompt, setBuilderPrompt] = useState("");
  const [builderPromptFeedback, setBuilderPromptFeedback] = useState<{
    tone: "success" | "warning";
    title: string;
    detail?: string;
    issues: string[];
  } | null>(null);

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [onSelectionChange, selection]);

  function customStopForKey(key: string) {
    return getCustomStopForKey(selection, key);
  }

  function addedStopsForDay(dayIndex: number) {
    return getAddedStopsForDay(selection, dayIndex);
  }

  function addedStopsInsertedAfter(dayIndex: number, insertAfterStopIndex: number) {
    return addedStopsForDay(dayIndex).filter(
      (stop) => (stop.insertAfterStopIndex ?? Number.MAX_SAFE_INTEGER) === insertAfterStopIndex
    );
  }

  function addedStopsBefore(dayIndex: number, stopIndex: number) {
    return addedStopsForDay(dayIndex).filter(
      (stop) =>
        typeof stop.insertAfterStopIndex === "number" &&
        stop.insertAfterStopIndex < stopIndex
    );
  }

  function addedStopCoordinate(stop: TripCustomStop) {
    return toStopCoordinate(stop.title, stop.latitude, stop.longitude);
  }

  function displayTimeForStop(
    dayIndex: number,
    stopIndex: number,
    stop: ItineraryDayData["stops"][number]
  ) {
    if (stop.kind !== "travel") {
      return stop.time;
    }

    return shiftTimeLabel(stop.time, addedStopsBefore(dayIndex, stopIndex).length);
  }

  function setCatalogSelection(
    kind: "food" | "activity",
    key: string,
    name: string
  ) {
    setSelection((prev) => {
      const next = normalizeSelectionState(prev);
      if (kind === "food") {
        next.foods[key] = name;
      } else {
        next.activities[key] = name;
      }

      if (next.customStops?.[key]) {
        delete next.customStops[key];
      }

      return next;
    });
  }

  function removeAddedStop(dayIndex: number, stopId: string) {
    setSelection((prev) => {
      const next = normalizeSelectionState(prev);
      const key = `day-${dayIndex}`;
      next.addedStops = {
        ...(next.addedStops ?? {}),
        [key]: (next.addedStops?.[key] ?? []).filter((stop) => stop.id !== stopId),
      };
      return next;
    });
  }

  function renderAddedStopCard(dayIndex: number, addedStop: TripCustomStop) {
    const addedChoice = customStopChoice(addedStop);
    const estimatedCost =
      addedStop.kind === "food"
        ? resolvedFoodCost(addedChoice, travelerCount)
        : resolvedActivityCost(addedChoice, travelerCount);
    const previewImageUrl =
      buildPhotoUrl(addedStop.photoRef) ?? addedStop.photoUrl ?? destinationImageUrl;
    const safeAddedStopWebsiteUrl = sanitizeExternalNavigationUrl(
      addedStop.websiteUrl
    );
    const safeAddedStopMapsUrl = sanitizeExternalNavigationUrl(addedStop.mapsUrl);

    return (
      <div
        key={addedStop.id}
        className="group rounded-[1.1rem] border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              {addedStop.time ?? "Added stop"}
            </div>
            {timeWindowLabel(addedStop.time) ? (
              <div className="mt-1 text-[12px] font-medium leading-5 text-emerald-700/80 dark:text-emerald-200/80">
                {timeWindowLabel(addedStop.time)}
              </div>
            ) : null}
            <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
              {addedStop.title}
            </h4>
            {addedStop.description ? (
              <p className="mt-1.5 text-[13px] leading-5 text-slate-700 dark:text-slate-200">
                {addedStop.description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => removeAddedStop(dayIndex, addedStop.id)}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-white px-3.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-200 dark:hover:bg-slate-800"
          >
            Remove
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <OptionPill tone="green">
            {addedStop.kind === "food" ? "Added food stop" : "Added activity"}
          </OptionPill>
          {addedStop.category ? <OptionPill>{addedStop.category}</OptionPill> : null}
          {typeof addedStop.rating === "number" ? (
            <OptionPill tone="green">Rating {addedStop.rating}</OptionPill>
          ) : null}
          {estimatedCost > 0 ? (
            <OptionPill>Est. group spend {formatMoney(estimatedCost)}</OptionPill>
          ) : (
            <OptionPill>
              {addedStop.kind === "activity" ? "Free or custom pricing" : "Custom pricing"}
            </OptionPill>
          )}
        </div>

        {safeAddedStopWebsiteUrl || safeAddedStopMapsUrl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {safeAddedStopWebsiteUrl ? (
              <a
                href={safeAddedStopWebsiteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {addedStop.kind === "food" ? "Restaurant site" : "Activity site"}
              </a>
            ) : null}
            {safeAddedStopMapsUrl ? (
              <a
                href={safeAddedStopMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Open map
              </a>
            ) : null}
          </div>
        ) : null}

        {previewImageUrl ? (
          <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mt-3 group-hover:max-h-40 group-hover:opacity-100 group-focus-within:mt-3 group-focus-within:max-h-40 group-focus-within:opacity-100">
            <div className="overflow-hidden rounded-[0.9rem] border border-emerald-200/70 bg-white/80 dark:border-emerald-500/20 dark:bg-slate-900/70">
              <Image
                src={previewImageUrl}
                alt={addedStop.title}
                width={800}
                height={288}
                unoptimized
                className="h-36 w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderInsertedStops(dayIndex: number, insertAfterStopIndex: number) {
    return addedStopsInsertedAfter(dayIndex, insertAfterStopIndex).map((addedStop) =>
      renderAddedStopCard(dayIndex, addedStop)
    );
  }

  function rankedHotelOptions(stopTitle?: string) {
    return [...hotels]
      .sort((a, b) => {
        const scoreDiff =
          optionSortScore(a.name, stopTitle?.replace(/^Check in at\s+/i, "")) -
          optionSortScore(b.name, stopTitle?.replace(/^Check in at\s+/i, ""));
        if (scoreDiff !== 0) return -scoreDiff;

        const availabilityDiff =
          hotelAvailabilityPriorityFor(b.availabilityStatus) -
          hotelAvailabilityPriorityFor(a.availabilityStatus);
        if (availabilityDiff !== 0) return availabilityDiff;

        const pricedDiff =
          Number(
            typeof b.pricePerNight === "number" ||
              typeof b.totalStayPrice === "number"
          ) -
          Number(
            typeof a.pricePerNight === "number" ||
              typeof a.totalStayPrice === "number"
          );
        if (pricedDiff !== 0) return pricedDiff;

        return (b.rating ?? 0) - (a.rating ?? 0);
      })
      .slice(0, 4);
  }

  function rankedFoodOptions(stopTitle?: string, previousStop?: StopCoordinate) {
    const scored = foodSpots.map((spot) => {
      const distanceKm = distanceKmFromCoordinate(
        previousStop,
        spot.latitude,
        spot.longitude
      );

      return {
        spot,
        distanceKm,
        score:
          optionSortScore(spot.name, stopTitle) * 2 +
          proximitySortScore(distanceKm) +
          (spot.rating ?? 0),
      };
    });

    // If we already have enough nearby choices, prefer local options over
    // highly rated but impractical detours elsewhere in the destination.
    const nearbyCount = scored.filter(
      ({ distanceKm }) => distanceKm !== undefined && distanceKm <= 20
    ).length;

    const candidates =
      previousStop && nearbyCount >= 2
        ? scored.filter(
            ({ distanceKm }) => distanceKm === undefined || distanceKm <= 20
          )
        : scored;

    return candidates
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if ((a.distanceKm ?? Infinity) !== (b.distanceKm ?? Infinity)) {
          return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        }
        return (b.spot.rating ?? 0) - (a.spot.rating ?? 0);
      })
      .slice(0, 4)
      .map(({ spot }) => spot);
  }

  function rankedActivityOptions(
    stopTitle?: string,
    previousStop?: StopCoordinate
  ) {
    const scored = activities.map((activity) => {
      const distanceKm = distanceKmFromCoordinate(
        previousStop,
        activity.latitude,
        activity.longitude
      );

      return {
        activity,
        distanceKm,
        score:
          optionSortScore(activity.name, stopTitle) * 2 +
          proximitySortScore(distanceKm) +
          (activity.rating ?? 0),
      };
    });

    const nearbyCount = scored.filter(
      ({ distanceKm }) => distanceKm !== undefined && distanceKm <= 60
    ).length;

    const candidates =
      previousStop && nearbyCount >= 2
        ? scored.filter(
            ({ distanceKm }) => distanceKm === undefined || distanceKm <= 60
          )
        : scored;

    return candidates
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if ((a.distanceKm ?? Infinity) !== (b.distanceKm ?? Infinity)) {
          return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        }
        return (b.activity.rating ?? 0) - (a.activity.rating ?? 0);
      })
      .slice(0, 4)
      .map(({ activity }) => activity);
  }

  function selectedCoordinateForStop(dayIndex: number, stopIndex: number) {
    const stop = days[dayIndex]?.stops?.[stopIndex];
    if (!stop) return undefined;
    const key = stopKey(dayIndex, stopIndex);

    if (stop.kind === "stay") {
      const selectedHotel = hotels.find(
        (hotel) => hotel.name === selection.hotelName
      );
      return selectedHotel
        ? toStopCoordinate(
            selectedHotel.name,
            selectedHotel.latitude,
            selectedHotel.longitude
          )
        : undefined;
    }

    if (stop.kind === "food") {
      const customStop = customStopForKey(key);
      if (customStop?.kind === "food") {
        return toStopCoordinate(
          customStop.title,
          customStop.latitude,
          customStop.longitude
        );
      }

      const selectedFood = foodSpots.find(
        (spot) => spot.name === selection.foods[key]
      );
      return selectedFood
        ? toStopCoordinate(
            selectedFood.name,
            selectedFood.latitude,
            selectedFood.longitude
          )
        : undefined;
    }

    if (stop.kind === "activity") {
      const customStop = customStopForKey(key);
      if (customStop?.kind === "activity") {
        return toStopCoordinate(
          customStop.title,
          customStop.latitude,
          customStop.longitude
        );
      }

      const selectedActivity = activities.find(
        (activity) => activity.name === selection.activities[key]
      );
      return selectedActivity
        ? toStopCoordinate(
            selectedActivity.name,
            selectedActivity.latitude,
            selectedActivity.longitude
          )
        : undefined;
    }

    return undefined;
  }

  function selectedHotelCoordinate() {
    const selectedHotel = hotels.find((hotel) => hotel.name === selection.hotelName);
    return selectedHotel
      ? toStopCoordinate(
          selectedHotel.name,
          selectedHotel.latitude,
          selectedHotel.longitude
        )
      : undefined;
  }

  function finalDayStopCoordinate(dayIndex: number) {
    const stops = days[dayIndex]?.stops ?? [];

    for (let currentStop = stops.length - 1; currentStop >= -1; currentStop -= 1) {
      const insertedStops = addedStopsInsertedAfter(dayIndex, currentStop);
      for (let insertedIndex = insertedStops.length - 1; insertedIndex >= 0; insertedIndex -= 1) {
        const insertedStop = insertedStops[insertedIndex];
        if (insertedStop.kind === "stay") continue;
        const coordinate = addedStopCoordinate(insertedStop);
        if (coordinate) return coordinate;
      }

      if (currentStop < 0) {
        continue;
      }

      const stop = stops[currentStop];
      if (stop.kind === "stay" || stop.kind === "travel") continue;

      const coordinate = selectedCoordinateForStop(dayIndex, currentStop);
      if (coordinate) return coordinate;
    }

    return undefined;
  }

  function previousStopCoordinate(
    dayIndex: number,
    stopIndex: number,
    stopKind?: ItineraryDayData["stops"][number]["kind"]
  ) {
    for (let currentStop = stopIndex - 1; currentStop >= -1; currentStop -= 1) {
      const insertedStops = addedStopsInsertedAfter(dayIndex, currentStop);
      for (let insertedIndex = insertedStops.length - 1; insertedIndex >= 0; insertedIndex -= 1) {
        const coordinate = addedStopCoordinate(insertedStops[insertedIndex]);
        if (coordinate) return coordinate;
      }

      if (currentStop < 0) {
        continue;
      }

      const coordinate = selectedCoordinateForStop(dayIndex, currentStop);
      if (coordinate) return coordinate;
    }

    if (stopKind !== "stay") {
      return selectedHotelCoordinate();
    }

    return undefined;
  }

  function elsewhereSelectionLabel(
    kind: "food" | "activity",
    optionName: string,
    currentDayIndex: number,
    currentStopIndex: number
  ) {
    const selections =
      kind === "food" ? selection.foods : selection.activities;
    const normalizedOptionName = normalized(optionName);

    for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
      const stops = days[dayIndex]?.stops ?? [];

      for (let stopIndex = 0; stopIndex < stops.length; stopIndex += 1) {
        if (dayIndex === currentDayIndex && stopIndex === currentStopIndex) {
          continue;
        }

        const stop = stops[stopIndex];
        if (stop.kind !== kind) continue;

        const selectedName = selections[stopKey(dayIndex, stopIndex)];
        if (normalized(selectedName) !== normalizedOptionName) continue;

        const dayLabel = `Chosen for day ${dayIndex + 1}`;
        return stop.time ? `${dayLabel} ${stop.time.toLowerCase()}` : dayLabel;
      }
    }

    return undefined;
  }

  function toggleEditing(key: string) {
    setEditingStopKey((current) => (current === key ? null : key));
  }

  function selectedFoodForKey(key: string, stopTitle?: string, previousStop?: StopCoordinate) {
    const options = rankedFoodOptions(stopTitle, previousStop);
    const customStop = customStopForKey(key);
    if (customStop?.kind === "food") {
      return customStopChoice(customStop);
    }

    const selectedSpot =
      foodSpots.find((spot) => spot.name === selection.foods[key]) ?? options[0];
    return selectedSpot ? foodChoice(selectedSpot) : undefined;
  }

  function selectedActivityForKey(
    key: string,
    stopTitle?: string,
    previousStop?: StopCoordinate
  ) {
    const options = rankedActivityOptions(stopTitle, previousStop);
    const customStop = customStopForKey(key);
    if (customStop?.kind === "activity") {
      return customStopChoice(customStop);
    }

    const selectedActivity =
      activities.find((activity) => activity.name === selection.activities[key]) ??
      options[0];
    return selectedActivity ? activityChoice(selectedActivity) : undefined;
  }

  function shouldTryLiveFoodFallback(
    prompt: string,
    result: {
      appliedChanges: Array<{
        kind: "stay" | "food" | "activity";
        source: "catalog" | "custom";
      }>;
      issues: string[];
    }
  ) {
    if (!destinationLabel) return false;

    const foodSignal =
      /\b(food|restaurant|eat|meal|breakfast|brunch|lunch|dinner|coffee|cafe|bakery|greek|mediterranean|italian|mexican|thai|indian|japanese|sushi|korean|chinese|vegan|vegetarian|burger|pizza|bbq)\b/i.test(
        prompt
      );

    if (!foodSignal) return false;

    return (
      result.appliedChanges.some(
        (change) => change.kind === "food" && change.source === "custom"
      ) ||
      result.issues.some((issue) =>
        /\bfood\b|\brestaurant\b|\bmeal\b|\bcafe\b/i.test(issue)
      ) ||
      result.appliedChanges.length === 0
    );
  }

  function shouldTryLiveActivityFallback(
    prompt: string,
    result: {
      appliedChanges: Array<{
        kind: "stay" | "food" | "activity";
        source: "catalog" | "custom";
      }>;
      issues: string[];
    }
  ) {
    if (!destinationLabel) return false;

    const activitySignal =
      /\b(activity|event|swim|swimming|pool|beach|lake|hot spring|hot springs|spa|kayak|canoe|paddle|rafting|float|walk|trail|hike|museum|gallery|lookout|viewpoint|adventure|tour|sightseeing)\b/i.test(
        prompt
      );

    if (!activitySignal) return false;

    return (
      result.appliedChanges.some(
        (change) => change.kind === "activity" && change.source === "custom"
      ) ||
      result.issues.some((issue) =>
        /\bactivity\b|\bswim\b|\btrail\b|\bhike\b|\bwalk\b|\bspa\b|\bmuseum\b/i.test(
          issue
        )
      ) ||
      result.appliedChanges.length === 0
    );
  }

  function promptResultQuality(result: {
    appliedChanges: Array<{
      kind: "stay" | "food" | "activity";
      source: "catalog" | "custom";
    }>;
    issues: string[];
  }) {
    const catalogCount = result.appliedChanges.filter(
      (change) => change.source === "catalog"
    ).length;
    const customCount = result.appliedChanges.filter(
      (change) => change.source === "custom"
    ).length;

    return (
      catalogCount * 14 +
      result.appliedChanges.length * 8 -
      customCount * 3 -
      result.issues.length * 4
    );
  }

  async function fetchLiveFoodFallback(desiredText: string) {
    if (!destinationLabel || !desiredText) {
      return [];
    }

    const hotelCoordinate = selectedHotelCoordinate();

    const response = await fetch("/api/prompt-place-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        desiredText,
        destination: destinationLabel,
        kind: "food",
        latitude: hotelCoordinate?.latitude,
        longitude: hotelCoordinate?.longitude,
        radiusKm: hotelCoordinate ? 28 : undefined,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      success?: boolean;
      foodSpots?: FoodSpot[];
    };

    return Array.isArray(data.foodSpots) ? data.foodSpots : [];
  }

  async function fetchLiveActivityFallback(desiredText: string) {
    if (!destinationLabel || !desiredText) {
      return [];
    }

    const hotelCoordinate = selectedHotelCoordinate();

    const response = await fetch("/api/prompt-place-search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        desiredText,
        destination: destinationLabel,
        kind: "activity",
        latitude: hotelCoordinate?.latitude,
        longitude: hotelCoordinate?.longitude,
        radiusKm: hotelCoordinate ? 30 : undefined,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      success?: boolean;
      activities?: Activity[];
    };

    return Array.isArray(data.activities) ? data.activities : [];
  }

  async function handleBuilderPromptApply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = builderPrompt.trim();
    if (!trimmedPrompt) {
      setBuilderPromptFeedback({
        tone: "warning",
        title: "Add a trip edit first",
        detail:
          "Try a sentence like “Day 2 lunch to Wild Flour Bakery”, “Add a coffee stop on day 3 before we leave”, or “Switch the stay to Rimrock Resort Hotel.”",
        issues: [],
      });
      return;
    }

    let result = applyItineraryPrompt({
      prompt: trimmedPrompt,
      days,
      hotels,
      foodSpots,
      activities,
      selection,
      travelerCount,
    });

    const desiredText = extractDesiredText(trimmedPrompt);
    let externalFoodSpots: FoodSpot[] = [];
    let externalActivities: Activity[] = [];

    if (shouldTryLiveFoodFallback(trimmedPrompt, result)) {
      try {
        externalFoodSpots = await fetchLiveFoodFallback(desiredText);
      } catch {
        // Keep the local parser result if live place search is unavailable.
      }
    }

    if (shouldTryLiveActivityFallback(trimmedPrompt, result)) {
      try {
        externalActivities = await fetchLiveActivityFallback(desiredText);
      } catch {
        // Keep the local parser result if live place search is unavailable.
      }
    }

    if (externalFoodSpots.length > 0 || externalActivities.length > 0) {
      const retriedResult = applyItineraryPrompt({
        prompt: trimmedPrompt,
        days,
        hotels,
        foodSpots,
        externalFoodSpots,
        activities,
        externalActivities,
        selection,
        travelerCount,
      });

      if (promptResultQuality(retriedResult) > promptResultQuality(result)) {
        result = retriedResult;
      }
    }

    if (result.appliedChanges.length > 0) {
      setSelection(result.selection);
      setEditingStopKey(result.appliedChanges[0]?.stopKey ?? null);
      setBuilderPromptFeedback({
        tone: result.issues.length > 0 ? "warning" : "success",
        title:
          result.appliedChanges.length === 1
            ? "1 builder edit applied"
            : `${result.appliedChanges.length} builder edits applied`,
        detail: result.appliedChanges
          .map((change) =>
            change.mode === "added"
              ? `${change.targetLabel}: ${change.selectedName}`
              : `${change.targetLabel} -> ${change.selectedName}`
          )
          .join(" · "),
        issues: result.issues,
      });
      return;
    }

    setBuilderPromptFeedback({
      tone: "warning",
      title: "No itinerary edits were applied",
      detail:
        result.issues[0] ??
        "Use day numbers and either name a place or describe the stop you want added or changed.",
      issues: result.issues,
    });
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-100">
          Edit the itinerary
        </h2>
        <p className="max-w-3xl text-sm leading-5 text-slate-600 dark:text-slate-300">
          Start from the recommended plan, then open any stay, food stop, or
          activity to change a day or fit something else into the trip. Your
          budget follows the selections.
        </p>
      </div>

      <form
        onSubmit={handleBuilderPromptApply}
        className="mt-5 rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(135deg,#f0fdf4,#ecfeff)] p-4 dark:border-slate-700 dark:bg-[linear-gradient(135deg,rgba(6,78,59,0.22),rgba(15,23,42,0.92))]"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
              Builder prompt
            </div>
            <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              Describe the itinerary change in plain English
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-200">
              Use one change per sentence. Mention the day for food or
              activity edits, and say whether you want to swap a stop or add a
              new one. I can use existing picks or create a traveler-requested
              stop when the exact place is not already in the builder.
            </p>
          </div>

          <BuilderPromptPill>Auto-saves with the rest of the builder</BuilderPromptPill>
        </div>

        <textarea
          value={builderPrompt}
          onChange={(event) => setBuilderPrompt(event.target.value)}
          placeholder="Examples: Day 2 lunch to Wild Flour Bakery. Add a coffee stop on day 3 before we leave for Edmonton. Change day 1 activity to a quiet lakeside walk."
          className="mt-4 min-h-[132px] w-full rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <BuilderPromptPill>Day 2 lunch to Wild Flour Bakery</BuilderPromptPill>
          <BuilderPromptPill>Add a coffee stop on day 3 before we leave</BuilderPromptPill>
          <BuilderPromptPill>Day 3 activity to Johnston Canyon</BuilderPromptPill>
          <BuilderPromptPill>Switch the stay to Rimrock Resort Hotel</BuilderPromptPill>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-3xl text-xs leading-5 text-slate-500 dark:text-slate-400">
            Best for traveler-led changes like swapping a stop, adding a meal,
            or introducing a custom activity. The manual cards below are still
            there when you want to fine-tune specific picks.
          </p>

          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
          >
            Apply changes
          </button>
        </div>

        {builderPromptFeedback ? (
          <div
            className={
              builderPromptFeedback.tone === "success"
                ? "mt-4 rounded-[1.1rem] border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                : "mt-4 rounded-[1.1rem] border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10"
            }
          >
            <div
              className={
                builderPromptFeedback.tone === "success"
                  ? "text-sm font-semibold text-emerald-800 dark:text-emerald-200"
                  : "text-sm font-semibold text-amber-800 dark:text-amber-200"
              }
            >
              {builderPromptFeedback.title}
            </div>
            {builderPromptFeedback.detail ? (
              <p
                className={
                  builderPromptFeedback.tone === "success"
                    ? "mt-1 text-sm leading-6 text-emerald-900 dark:text-emerald-100"
                    : "mt-1 text-sm leading-6 text-amber-900 dark:text-amber-100"
                }
              >
                {builderPromptFeedback.detail}
              </p>
            ) : null}
            {builderPromptFeedback.issues.length > 0 ? (
              <div className="mt-2 space-y-1">
                {builderPromptFeedback.issues.map((issue) => (
                  <p
                    key={issue}
                    className={
                      builderPromptFeedback.tone === "success"
                        ? "text-xs leading-5 text-emerald-800/90 dark:text-emerald-100/85"
                        : "text-xs leading-5 text-amber-800/90 dark:text-amber-100/85"
                    }
                  >
                    {issue}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>

      <div className="mt-5 space-y-4">
        {days.map((day, dayIndex) => (
          (() => {
            const hotelCoordinate = selectedHotelCoordinate();
            const lastStopOfDay = finalDayStopCoordinate(dayIndex);
            const driveBackDistance =
              hotelCoordinate && lastStopOfDay
                ? haversineDistanceKm(lastStopOfDay, hotelCoordinate)
                : undefined;
            const dayStops = day.stops ?? [];
            const dayOrderedStops = [
              ...addedStopsInsertedAfter(dayIndex, -1).map((addedStop) => ({
                type: "added" as const,
                addedStop,
              })),
              ...dayStops.flatMap((stop, stopIndex) => [
                {
                  type: "base" as const,
                  stop,
                  stopIndex,
                },
                ...addedStopsInsertedAfter(dayIndex, stopIndex).map((addedStop) => ({
                  type: "added" as const,
                  addedStop,
                })),
              ]),
            ];
            const anchorNames: string[] = [];
            let editableStopCount = 0;
            let driveSegmentCount = 0;
            let daySpendEstimate = 0;
            let hasDemandingHike = false;

            dayOrderedStops.forEach((entry) => {
              if (entry.type === "added") {
                editableStopCount += 1;

                if (entry.addedStop.kind === "food") {
                  const choice = customStopChoice(entry.addedStop);
                  daySpendEstimate += resolvedFoodCost(choice, travelerCount);
                  if (!anchorNames.includes(choice.name)) {
                    anchorNames.push(choice.name);
                  }
                  return;
                }

                if (entry.addedStop.kind === "activity") {
                  const choice = customStopChoice(entry.addedStop);
                  daySpendEstimate += resolvedActivityCost(choice, travelerCount);
                  if (isDemandingHikeStop(entry.addedStop, choice)) {
                    hasDemandingHike = true;
                  }
                  if (!anchorNames.includes(choice.name)) {
                    anchorNames.push(choice.name);
                  }
                }

                return;
              }

              const { stop, stopIndex } = entry;
              const key = stopKey(dayIndex, stopIndex);
              const priorStop = previousStopCoordinate(dayIndex, stopIndex, stop.kind);

              if (stop.kind === "travel") {
                driveSegmentCount += 1;
                return;
              }

              if (stop.kind === "stay") {
                editableStopCount += 1;
                const selectedHotel =
                  hotels.find((hotel) => hotel.name === selection.hotelName) ??
                  rankedHotelOptions(stop.title)[0];

                if (selectedHotel?.name && !anchorNames.includes(selectedHotel.name)) {
                  anchorNames.push(selectedHotel.name);
                }
                return;
              }

              if (stop.kind === "food") {
                editableStopCount += 1;
                const selectedSpot = selectedFoodForKey(key, stop.title, priorStop);
                if (selectedSpot) {
                  daySpendEstimate += resolvedFoodCost(selectedSpot, travelerCount);
                  if (!anchorNames.includes(selectedSpot.name)) {
                    anchorNames.push(selectedSpot.name);
                  }
                }
                return;
              }

              if (stop.kind === "activity") {
                editableStopCount += 1;
                const selectedActivity = selectedActivityForKey(
                  key,
                  stop.title,
                  priorStop
                );
                if (selectedActivity) {
                  daySpendEstimate += resolvedActivityCost(
                    selectedActivity,
                    travelerCount
                  );
                  if (isDemandingHikeStop(stop, selectedActivity)) {
                    hasDemandingHike = true;
                  }
                  const activityLabel = activityPlannerLabel(stop, selectedActivity);
                  if (!anchorNames.includes(activityLabel)) {
                    anchorNames.push(activityLabel);
                  }
                }
              }
            });

            const tempoLabel =
              hasDemandingHike
                ? "Hard hike day"
                : editableStopCount <= 2
                ? "Easy pace"
                : editableStopCount <= 4
                  ? "Balanced pace"
                  : "Full day";
            const routeShape =
              anchorNames.length > 0
                ? anchorNames.slice(0, 3).join(" -> ")
                : "Travel-only day";

            return (
              <section
                key={`day-${dayIndex}`}
                className="rounded-[1.25rem] border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-700 dark:bg-slate-800/70"
              >
                <div className="mb-3">
                  <h3 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                    Day {dayIndex + 1}
                    {day.title ? ` - ${day.title}` : ""}
                  </h3>
                  {day.summary ? (
                    <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                      {day.summary}
                    </p>
                  ) : null}
                </div>

                <div className="mb-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[0.95rem] border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Tempo
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {tempoLabel}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                      {hasDemandingHike
                        ? "Treat the summit hike as the main effort and keep the rest of the day light."
                        : `${editableStopCount} decision stop${editableStopCount === 1 ? "" : "s"} and ${driveSegmentCount} travel leg${driveSegmentCount === 1 ? "" : "s"}.`}
                    </p>
                  </div>

                  <div className="rounded-[0.95rem] border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Day flow
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {routeShape}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                      Current selected anchors for this day.
                    </p>
                  </div>

                  <div className="rounded-[0.95rem] border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Day spend picks
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {daySpendEstimate > 0 ? formatMoney(daySpendEstimate) : "Mostly free"}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                      Food and activity selections only. Stay costs remain in the trip budget rail.
                    </p>
                  </div>

                  <div className="rounded-[0.95rem] border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Route note
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {hasDemandingHike
                        ? "Main effort is the summit hike"
                        : driveBackDistance !== undefined
                        ? `${formatTransferMinutes(
                            estimateTransferMinutes(driveBackDistance)
                          )} back to stay`
                        : dayIndex === 0 && startCityLabel
                          ? `Leaves from ${startCityLabel}`
                          : "Follow selected stop order"}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                      Built from the current stay and stop choices.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {renderInsertedStops(dayIndex, -1)}
                  {dayStops.map((stop, stopIndex) => {
                    const key = stopKey(dayIndex, stopIndex);
                    const priorStop = previousStopCoordinate(
                      dayIndex,
                      stopIndex,
                      stop.kind
                    );
                    const displayedStopTime = displayTimeForStop(dayIndex, stopIndex, stop);

                    if (stop.kind === "stay") {
                      const options = rankedHotelOptions(stop.title);
                      const selectedHotel =
                        hotels.find((hotel) => hotel.name === selection.hotelName) ??
                        options[0];
                      const isEditing = editingStopKey === key;

                      return (
                        <div key={`group-${key}`} className="space-y-3">
                          <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              {displayedStopTime ?? "Stay"}
                            </div>
                            {timeWindowLabel(displayedStopTime) ? (
                              <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                                {timeWindowLabel(displayedStopTime)}
                              </div>
                            ) : null}
                          <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                            Pick where to stay
                          </h4>
                          {stop.description ? (
                            <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                              {stop.description}
                            </p>
                          ) : null}

                          {selectedHotel ? (
                            <div className="mt-3">
                              <CompactSelectionCard
                                label="Current stay"
                                title={selectedHotel.name}
                                subtitle={
                                  formatDistanceFromPrevious(
                                    priorStop,
                                    toStopCoordinate(
                                      selectedHotel.name,
                                      selectedHotel.latitude,
                                      selectedHotel.longitude
                                    )
                                  ) ?? selectedHotel.shortDescription
                                }
                                pills={[
                                  hotelAvailabilityLabel(
                                    selectedHotel,
                                    Boolean(tripStartDate && tripEndDate)
                                  ),
                                  ...(typeof selectedHotel.rating === "number"
                                    ? [`Rating ${selectedHotel.rating}`]
                                    : []),
                                  ...(typeof selectedHotel.pricePerNight === "number"
                                    ? [`$${selectedHotel.pricePerNight}/night`]
                                    : []),
                                  ...(typeof selectedHotel.totalStayPrice === "number"
                                    ? [`Total $${selectedHotel.totalStayPrice}`]
                                    : []),
                                ]}
                                primaryUrl={preferredHotelBookingUrl({
                                  hotel: selectedHotel,
                                  destination: destinationLabel,
                                  tripStartDate,
                                  tripEndDate,
                                  travelerCount,
                                })}
                                primaryLabel="Stay site"
                                mapsUrl={selectedHotel.mapsUrl}
                                photoRef={selectedHotel.photoRef}
                                photoUrl={selectedHotel.photoUrl}
                                fallbackPhotoUrl={destinationImageUrl}
                                editing={isEditing}
                                onToggleEditing={() => toggleEditing(key)}
                              />
                            </div>
                          ) : null}

                            {isEditing ? (
                              <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
                                {options.map((hotel, optionIndex) => (
                                  <SelectorCard
                                    key={hotel.name}
                                      option={{
                                        name: hotel.name,
                                        subtitle: hotel.shortDescription,
                                        rating: hotel.rating,
                                        pricePerNight: hotel.pricePerNight,
                                        totalStayPrice: hotel.totalStayPrice,
                                        primaryUrl: preferredHotelBookingUrl({
                                          hotel,
                                          destination: destinationLabel,
                                          tripStartDate,
                                          tripEndDate,
                                          travelerCount,
                                        }),
                                        primaryLabel: "Stay site",
                                      mapsUrl: hotel.mapsUrl,
                                      photoRef: hotel.photoRef,
                                      photoUrl: hotel.photoUrl,
                                      fallbackPhotoUrl: destinationImageUrl,
                                      latitude: hotel.latitude,
                                      longitude: hotel.longitude,
                                      availabilityLabel: hotelAvailabilityLabel(
                                        hotel,
                                        Boolean(tripStartDate && tripEndDate)
                                      ),
                                      availabilityTone: hotelAvailabilityTone(
                                        hotel.availabilityStatus
                                      ),
                                    }}
                                    selected={selection.hotelName === hotel.name}
                                    recommended={optionIndex === 0}
                                    distanceFromPrevious={formatDistanceFromPrevious(
                                      priorStop,
                                      toStopCoordinate(
                                        hotel.name,
                                        hotel.latitude,
                                        hotel.longitude
                                      )
                                    )}
                                    onSelect={() => {
                                      setSelection((prev) => ({
                                        ...prev,
                                        hotelName: hotel.name,
                                      }));
                                      setEditingStopKey(null);
                                    }}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {renderInsertedStops(dayIndex, stopIndex)}
                        </div>
                      );
                    }

                    if (stop.kind === "food") {
                      const options = rankedFoodOptions(stop.title, priorStop);
                      const selectedSpot = selectedFoodForKey(key, stop.title, priorStop);
                      const isEditing = editingStopKey === key;
                      // Show a range instead of a fake exact amount because the
                      // food pricing is heuristic, not live menu data.
                      const selectedSpotRange = selectedSpot
                        ? selectedSpot.source === "catalog"
                          ? estimateFoodCostRangeForGroup(
                              {
                                name: selectedSpot.name,
                                tags: [],
                                category: selectedSpot.category,
                                estimatedCost: selectedSpot.estimatedCost,
                              },
                              travelerCount
                            )
                          : (selectedSpot.estimatedCost ?? 0) > 0
                            ? {
                                low: Math.round((selectedSpot.estimatedCost ?? 0) * 0.85),
                                high: Math.round((selectedSpot.estimatedCost ?? 0) * 1.15),
                              }
                            : null
                        : null;

                      return (
                        <div key={`group-${key}`} className="space-y-3">
                          <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              {displayedStopTime ?? "Food"}
                            </div>
                            {timeWindowLabel(displayedStopTime) ? (
                              <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                                {timeWindowLabel(displayedStopTime)}
                              </div>
                            ) : null}
                          <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                            Pick a food stop
                          </h4>
                          {stop.description ? (
                            <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                              {stop.description}
                            </p>
                          ) : null}

                          {selectedSpot ? (
                            <div className="mt-3">
                              <CompactSelectionCard
                                label="Current food stop"
                                title={selectedSpot.name}
                                subtitle={
                                  formatDistanceFromPrevious(
                                    priorStop,
                                    choiceCoordinate(selectedSpot)
                                  ) ?? selectedSpot.shortDescription
                                }
                                pills={[
                                  ...(selectedSpot.category ? [selectedSpot.category] : []),
                                  ...(customChoiceLabel(selectedSpot)
                                    ? [customChoiceLabel(selectedSpot) as string]
                                    : []),
                                  ...(typeof selectedSpot.rating === "number"
                                    ? [`Rating ${selectedSpot.rating}`]
                                    : []),
                                  ...(selectedSpotRange
                                    ? [
                                        `Est. group spend ${formatMoney(selectedSpotRange.low)}-${formatMoney(selectedSpotRange.high)}`,
                                      ]
                                    : []),
                                ]}
                                primaryUrl={selectedSpot.websiteUrl}
                                primaryLabel="Restaurant site"
                                mapsUrl={selectedSpot.mapsUrl}
                                photoRef={selectedSpot.photoRef}
                                photoUrl={selectedSpot.photoUrl}
                                editing={isEditing}
                                onToggleEditing={() => toggleEditing(key)}
                              />
                              <p className="mt-2 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
                                {selectedSpot.source === "catalog"
                                  ? foodPricingSourceLabel({
                                      name: selectedSpot.name,
                                      tags: [],
                                      category: selectedSpot.category,
                                      estimatedCost: selectedSpot.estimatedCost,
                                    })
                                  : customChoiceLabel(selectedSpot) ??
                                    "Matched from your builder prompt."}
                              </p>
                            </div>
                          ) : null}

                            {isEditing ? (
                              <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
                                {options.map((spot, optionIndex) => {
                                  const estimatedCost = guessFoodCost(spot, travelerCount);
                                  const estimatedRange = estimateFoodCostRangeForGroup(
                                    spot,
                                    travelerCount
                                  );

                                  return (
                                    <SelectorCard
                                      key={spot.name}
                                      option={{
                                        name: spot.name,
                                        subtitle: `${spot.shortDescription ?? ""}${
                                          spot.shortDescription ? " " : ""
                                        }${foodPricingSourceLabel(spot)}`,
                                        rating: spot.rating,
                                        estimatedCost,
                                        estimatedCostLabel: `Est. ${formatMoney(
                                          estimatedRange.low
                                        )}-${formatMoney(estimatedRange.high)}`,
                                        category:
                                          spot.category ??
                                          spot.tags?.[0] ??
                                          "Food stop",
                                        primaryUrl: spot.websiteUrl || spot.link,
                                        primaryLabel: "Restaurant site",
                                        mapsUrl: spot.mapsUrl,
                                        photoRef: spot.photoRef,
                                        photoUrl: spot.photoUrl,
                                        latitude: spot.latitude,
                                        longitude: spot.longitude,
                                      }}
                                      selected={
                                        selection.foods[key] === spot.name &&
                                        customStopForKey(key)?.kind !== "food"
                                      }
                                      recommended={optionIndex === 0}
                                      distanceFromPrevious={formatDistanceFromPrevious(
                                        priorStop,
                                        toStopCoordinate(
                                          spot.name,
                                          spot.latitude,
                                          spot.longitude
                                        )
                                      )}
                                      selectedElsewhereLabel={elsewhereSelectionLabel(
                                        "food",
                                        spot.name,
                                        dayIndex,
                                        stopIndex
                                      )}
                                      onSelect={() => {
                                        setCatalogSelection("food", key, spot.name);
                                        setEditingStopKey(null);
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                          {renderInsertedStops(dayIndex, stopIndex)}
                        </div>
                      );
                    }

                    if (stop.kind === "activity") {
                      const options = rankedActivityOptions(stop.title, priorStop);
                      const selectedActivity = selectedActivityForKey(
                        key,
                        stop.title,
                        priorStop
                      );
                      const isEditing = editingStopKey === key;

                      return (
                        <div key={`group-${key}`} className="space-y-3">
                          <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              {displayedStopTime ?? "Activity"}
                            </div>
                            {timeWindowLabel(displayedStopTime) ? (
                              <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                                {timeWindowLabel(displayedStopTime)}
                              </div>
                            ) : null}
                          <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                            Pick an activity
                          </h4>
                          {stop.description ? (
                            <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                              {stop.description}
                            </p>
                          ) : null}

                          {selectedActivity ? (
                            <div className="mt-3">
                              <CompactSelectionCard
                                label="Current activity"
                                title={activityPlannerLabel(stop, selectedActivity)}
                                subtitle={
                                  formatDistanceFromPrevious(
                                    priorStop,
                                    choiceCoordinate(selectedActivity)
                                  ) ?? selectedActivity.shortDescription
                                }
                                pills={[
                                  ...(selectedActivity.type ? [selectedActivity.type] : []),
                                  ...(customChoiceLabel(selectedActivity)
                                    ? [customChoiceLabel(selectedActivity) as string]
                                    : []),
                                  ...(typeof selectedActivity.rating === "number"
                                    ? [`Rating ${selectedActivity.rating}`]
                                    : []),
                                  ...(resolvedActivityCost(selectedActivity, travelerCount) > 0
                                    ? [
                                        `Est. group spend ${formatMoney(
                                          resolvedActivityCost(
                                            selectedActivity,
                                            travelerCount
                                          )
                                        )}`,
                                      ]
                                    : ["Free"]),
                                ]}
                                primaryUrl={
                                  selectedActivity.websiteUrl || selectedActivity.bookingLink
                                }
                                primaryLabel="Activity site"
                                mapsUrl={selectedActivity.mapsUrl}
                                photoRef={selectedActivity.photoRef}
                                photoUrl={selectedActivity.photoUrl}
                                editing={isEditing}
                                onToggleEditing={() => toggleEditing(key)}
                              />
                            </div>
                          ) : null}

                            {isEditing ? (
                              <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
                                {options.map((activity, optionIndex) => {
                                  const estimatedCost = guessActivityCost(
                                    activity,
                                    travelerCount
                                  );

                                  return (
                                    <SelectorCard
                                      key={activity.name}
                                      option={{
                                        name: activity.name,
                                        subtitle: activity.shortDescription,
                                        rating: activity.rating,
                                        estimatedCost,
                                        estimatedCostLabel:
                                          estimatedCost > 0
                                            ? `Est. group spend ${formatMoney(estimatedCost)}`
                                            : "Free",
                                        category: activity.type,
                                        primaryUrl:
                                          activity.websiteUrl || activity.bookingLink,
                                        primaryLabel: "Activity site",
                                        mapsUrl: activity.mapsUrl,
                                        photoRef: activity.photoRef,
                                        photoUrl: activity.photoUrl,
                                        latitude: activity.latitude,
                                        longitude: activity.longitude,
                                      }}
                                      selected={
                                        selection.activities[key] === activity.name &&
                                        customStopForKey(key)?.kind !== "activity"
                                      }
                                      recommended={optionIndex === 0}
                                      distanceFromPrevious={formatDistanceFromPrevious(
                                        priorStop,
                                        toStopCoordinate(
                                          activity.name,
                                          activity.latitude,
                                          activity.longitude
                                        )
                                      )}
                                      selectedElsewhereLabel={elsewhereSelectionLabel(
                                        "activity",
                                        activity.name,
                                        dayIndex,
                                        stopIndex
                                      )}
                                      onSelect={() => {
                                        setCatalogSelection("activity", key, activity.name);
                                        setEditingStopKey(null);
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                          {renderInsertedStops(dayIndex, stopIndex)}
                        </div>
                      );
                    }

                    return (
                      <div key={`group-${key}`} className="space-y-3">
                        <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                          {displayedStopTime ? (
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              {displayedStopTime}
                            </div>
                          ) : null}
                          {timeWindowLabel(displayedStopTime) ? (
                            <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                              {timeWindowLabel(displayedStopTime)}
                            </div>
                          ) : null}
                          <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                            {stop.title}
                          </h4>
                          {stop.description ? (
                            <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                              {stop.description}
                            </p>
                          ) : null}
                          {stop.kind === "travel" &&
                          stopIndex === (day.stops?.length ?? 0) - 1 &&
                          dayIndex === days.length - 1 &&
                          priorStop &&
                          startCityCoordinate ? (
                            <div className="mt-2 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                              {(() => {
                                const distanceKm = haversineDistanceKm(priorStop, {
                                  label: startCityLabel ?? "start city",
                                  latitude: startCityCoordinate.latitude,
                                  longitude: startCityCoordinate.longitude,
                                });

                                return `${formatTransferMinutes(
                                  estimateTransferMinutes(distanceKm)
                                )} / ${formatDistanceKm(distanceKm)} from ${priorStop.label} to `;
                              })()}
                              {startCityLabel ?? "your starting city"}
                            </div>
                          ) : null}
                        </div>
                        {renderInsertedStops(dayIndex, stopIndex)}
                      </div>
                    );
                  })}

                  {dayIndex < days.length - 1 &&
                  hotelCoordinate &&
                  lastStopOfDay &&
                  driveBackDistance !== undefined ? (
                    <div className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Night
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        Drive back to {hotelCoordinate.label}
                      </h4>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                        Wrap up the day and head back to your hotel from {lastStopOfDay.label}.
                      </p>
                      <div className="mt-2 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                        {formatTransferMinutes(
                          estimateTransferMinutes(driveBackDistance)
                        )}{" "}
                        / {formatDistanceKm(driveBackDistance)} back to hotel
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })()
        ))}
      </div>
    </section>
  );
}
