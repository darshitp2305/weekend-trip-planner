"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripSelectionState,
} from "../lib/types";
import {
  estimateFoodCostForGroup,
  estimateFoodCostRangeForGroup,
  foodPricingSourceLabel,
} from "../lib/foodPricing";
import { preferredHotelBookingUrl } from "../lib/expediaLinks";

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
};

type StopCoordinate = {
  label: string;
  latitude: number;
  longitude: number;
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

function formatMoney(value: number) {
  return `$${Math.round(value)}`;
}

function timeWindowLabel(time?: string) {
  switch (normalized(time)) {
    case "morning":
      return "8:00-10:00 AM";
    case "late morning":
      return "10:30 AM-12:30 PM";
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

function guessActivityCost(activity: Activity, travelers: number) {
  const base = activity.costEstimate ?? activity.estimatedCost ?? 0;
  return base * Math.max(1, travelers);
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
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
  tone?: "slate" | "green" | "violet";
}) {
  const className =
    tone === "green"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
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

        {option.primaryUrl ? (
          <a
            href={option.primaryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {option.primaryLabel ?? "Visit site"}
          </a>
        ) : null}

        {option.mapsUrl ? (
          <a
            href={option.mapsUrl}
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

      {(primaryUrl || mapsUrl) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {primaryUrl ? (
            <a
              href={primaryUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {primaryLabel ?? "Visit site"}
            </a>
          ) : null}
          {mapsUrl ? (
            <a
              href={mapsUrl}
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
  const defaultSelection = useMemo<TripSelectionState>(() => {
    const initial: TripSelectionState = {
      hotelName: hotels[0]?.name,
      foods: {},
      activities: {},
    };

    days.forEach((day, dayIndex) => {
      (day.stops ?? []).forEach((stop, stopIndex) => {
        const key = stopKey(dayIndex, stopIndex);

        if (stop.kind === "food") {
          const match = foodSpots.find(
            (spot) => normalized(spot.name) === normalized(stop.title)
          );
          if (match?.name) initial.foods[key] = match.name;
        }

        if (stop.kind === "activity") {
          const match = activities.find(
            (item) => normalized(item.name) === normalized(stop.title)
          );
          if (match?.name) initial.activities[key] = match.name;
        }

        if (stop.kind === "stay") {
          const hotelName = stop.title?.replace(/^Check in at\s+/i, "");
          const match = hotels.find(
            (item) => normalized(item.name) === normalized(hotelName)
          );
          if (match?.name) initial.hotelName = match.name;
        }
      });
    });

    return initial;
  }, [activities, days, foodSpots, hotels]);

  const [selection, setSelection] = useState<TripSelectionState>(
    () => initialSelection ?? defaultSelection
  );
  // Keep only one option grid open at a time so the long trip page stays
  // easier to scan and compare.
  const [editingStopKey, setEditingStopKey] = useState<string | null>(null);

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [onSelectionChange, selection]);

  function rankedHotelOptions(stopTitle?: string) {
    return [...hotels]
      .sort((a, b) => {
        const scoreDiff =
          optionSortScore(a.name, stopTitle?.replace(/^Check in at\s+/i, "")) -
          optionSortScore(b.name, stopTitle?.replace(/^Check in at\s+/i, ""));
        if (scoreDiff !== 0) return -scoreDiff;
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
      const selectedFood = foodSpots.find(
        (spot) => spot.name === selection.foods[stopKey(dayIndex, stopIndex)]
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
      const selectedActivity = activities.find(
        (activity) =>
          activity.name === selection.activities[stopKey(dayIndex, stopIndex)]
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

    for (let currentStop = stops.length - 1; currentStop >= 0; currentStop -= 1) {
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
    for (let currentStop = stopIndex - 1; currentStop >= 0; currentStop -= 1) {
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
    return foodSpots.find((spot) => spot.name === selection.foods[key]) ?? options[0];
  }

  function selectedActivityForKey(
    key: string,
    stopTitle?: string,
    previousStop?: StopCoordinate
  ) {
    const options = rankedActivityOptions(stopTitle, previousStop);
    return (
      activities.find((activity) => activity.name === selection.activities[key]) ?? options[0]
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-100">Itinerary</h2>
        <p className="max-w-3xl text-sm leading-5 text-slate-600 dark:text-slate-300">
          Build the trip from the itinerary itself. Each stop starts on the
          recommended pick, and your budget follows the selections.
        </p>
      </div>

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
            const anchorNames: string[] = [];
            let editableStopCount = 0;
            let driveSegmentCount = 0;
            let daySpendEstimate = 0;

            dayStops.forEach((stop, stopIndex) => {
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
                  daySpendEstimate += guessFoodCost(selectedSpot, travelerCount);
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
                  daySpendEstimate += guessActivityCost(selectedActivity, travelerCount);
                  if (!anchorNames.includes(selectedActivity.name)) {
                    anchorNames.push(selectedActivity.name);
                  }
                }
              }
            });

            const tempoLabel =
              editableStopCount <= 2
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
                      {editableStopCount} decision stop{editableStopCount === 1 ? "" : "s"} and {driveSegmentCount} travel leg{driveSegmentCount === 1 ? "" : "s"}.
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
                      Food and activity selections only. Hotel stays remain in the trip budget rail.
                    </p>
                  </div>

                  <div className="rounded-[0.95rem] border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Route note
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {driveBackDistance !== undefined
                        ? `${formatTransferMinutes(
                            estimateTransferMinutes(driveBackDistance)
                          )} back to stay`
                        : dayIndex === 0 && startCityLabel
                          ? `Leaves from ${startCityLabel}`
                          : "Follow selected stop order"}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                      Built from the current hotel and stop choices.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {dayStops.map((stop, stopIndex) => {
                    const key = stopKey(dayIndex, stopIndex);
                    const priorStop = previousStopCoordinate(
                      dayIndex,
                      stopIndex,
                      stop.kind
                    );

                    if (stop.kind === "stay") {
                      const options = rankedHotelOptions(stop.title);
                      const selectedHotel =
                        hotels.find((hotel) => hotel.name === selection.hotelName) ??
                        options[0];
                      const isEditing = editingStopKey === key;

                      return (
                        <div
                          key={key}
                          className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {stop.time ?? "Stay"}
                          </div>
                          {timeWindowLabel(stop.time) ? (
                            <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                              {timeWindowLabel(stop.time)}
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
                                primaryLabel="Hotel site"
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
                                      primaryLabel: "Hotel site",
                                    mapsUrl: hotel.mapsUrl,
                                    photoRef: hotel.photoRef,
                                    photoUrl: hotel.photoUrl,
                                    fallbackPhotoUrl: destinationImageUrl,
                                    latitude: hotel.latitude,
                                    longitude: hotel.longitude,
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
                      );
                    }

                    if (stop.kind === "food") {
                      const options = rankedFoodOptions(stop.title, priorStop);
                      const selectedSpot = selectedFoodForKey(key, stop.title, priorStop);
                      const isEditing = editingStopKey === key;
                      // Show a range instead of a fake exact amount because the
                      // food pricing is heuristic, not live menu data.
                      const selectedSpotRange = selectedSpot
                        ? estimateFoodCostRangeForGroup(selectedSpot, travelerCount)
                        : null;

                      return (
                        <div
                          key={key}
                          className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {stop.time ?? "Food"}
                          </div>
                          {timeWindowLabel(stop.time) ? (
                            <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                              {timeWindowLabel(stop.time)}
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
                                    toStopCoordinate(
                                      selectedSpot.name,
                                      selectedSpot.latitude,
                                      selectedSpot.longitude
                                    )
                                  ) ?? selectedSpot.shortDescription
                                }
                                pills={[
                                  ...(selectedSpot.category ? [selectedSpot.category] : []),
                                  ...(typeof selectedSpot.rating === "number"
                                    ? [`Rating ${selectedSpot.rating}`]
                                    : []),
                                  ...(selectedSpotRange
                                    ? [
                                        `Est. group spend ${formatMoney(selectedSpotRange.low)}-${formatMoney(selectedSpotRange.high)}`,
                                      ]
                                    : []),
                                ]}
                                primaryUrl={selectedSpot.websiteUrl || selectedSpot.link}
                                primaryLabel="Restaurant site"
                                mapsUrl={selectedSpot.mapsUrl}
                                photoRef={selectedSpot.photoRef}
                                photoUrl={selectedSpot.photoUrl}
                                editing={isEditing}
                                onToggleEditing={() => toggleEditing(key)}
                              />
                              <p className="mt-2 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
                                {foodPricingSourceLabel(selectedSpot)}
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
                                    selected={selection.foods[key] === spot.name}
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
                                      setSelection((prev) => ({
                                        ...prev,
                                        foods: {
                                          ...prev.foods,
                                          [key]: spot.name,
                                        },
                                      }));
                                      setEditingStopKey(null);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          ) : null}
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
                        <div
                          key={key}
                          className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {stop.time ?? "Activity"}
                          </div>
                          {timeWindowLabel(stop.time) ? (
                            <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                              {timeWindowLabel(stop.time)}
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
                                title={selectedActivity.name}
                                subtitle={
                                  formatDistanceFromPrevious(
                                    priorStop,
                                    toStopCoordinate(
                                      selectedActivity.name,
                                      selectedActivity.latitude,
                                      selectedActivity.longitude
                                    )
                                  ) ?? selectedActivity.shortDescription
                                }
                                pills={[
                                  selectedActivity.type,
                                  ...(typeof selectedActivity.rating === "number"
                                    ? [`Rating ${selectedActivity.rating}`]
                                    : []),
                                  ...(guessActivityCost(selectedActivity, travelerCount) > 0
                                    ? [
                                        `Est. group spend ${formatMoney(
                                          guessActivityCost(
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
                                    selected={selection.activities[key] === activity.name}
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
                                      setSelection((prev) => ({
                                        ...prev,
                                        activities: {
                                          ...prev.activities,
                                          [key]: activity.name,
                                        },
                                      }));
                                      setEditingStopKey(null);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={key}
                        className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                      >
                        {stop.time ? (
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {stop.time}
                          </div>
                        ) : null}
                        {timeWindowLabel(stop.time) ? (
                          <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                            {timeWindowLabel(stop.time)}
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
