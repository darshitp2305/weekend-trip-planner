"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
} from "../lib/types";

type SelectionState = {
  hotelName?: string;
  foods: Record<string, string>;
  activities: Record<string, string>;
};

type Props = {
  days: ItineraryDayData[];
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  activities: Activity[];
  travelerCount: number;
  destinationImageUrl?: string;
  onSelectionChange?: (selection: SelectionState) => void;
};

type StopOption = {
  name: string;
  subtitle?: string;
  rating?: number;
  estimatedCost?: number;
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

function guessFoodCost(spot: FoodSpot, travelers: number) {
  if (typeof spot.estimatedCost === "number") {
    return spot.estimatedCost * Math.max(1, travelers);
  }

  const text = [spot.category, ...(spot.tags ?? []), spot.name]
    .join(" ")
    .toLowerCase();

  const base =
    text.includes("cafe") || text.includes("coffee") || text.includes("bakery")
      ? 18
      : text.includes("restaurant") ||
          text.includes("steak") ||
          text.includes("bar")
        ? 38
        : 26;

  return base * Math.max(1, travelers);
}

function guessActivityCost(activity: Activity, travelers: number) {
  const base = activity.costEstimate ?? activity.estimatedCost ?? 0;
  return base * Math.max(1, travelers);
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
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

function SelectorCard({
  option,
  selected,
  recommended,
  onSelect,
}: {
  option: StopOption;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const previewImageUrl =
    buildPhotoUrl(option.photoRef) ?? option.photoUrl ?? option.fallbackPhotoUrl;

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
          {recommended ? <OptionPill tone="violet">Recommended</OptionPill> : null}
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
            {option.estimatedCost === 0 ? "Free" : `$${option.estimatedCost}`}
          </OptionPill>
        ) : null}
      </div>

      {previewImageUrl ? (
        <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:mt-3 group-hover:max-h-40 group-hover:opacity-100 group-focus-visible:mt-3 group-focus-visible:max-h-40 group-focus-visible:opacity-100">
          <div className="overflow-hidden rounded-[0.9rem] border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
            <img
              src={previewImageUrl}
              alt={option.name}
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

export default function InteractiveItinerary({
  days,
  hotels,
  foodSpots,
  activities,
  travelerCount,
  destinationImageUrl,
  onSelectionChange,
}: Props) {
  const defaultSelection = useMemo<SelectionState>(() => {
    const initial: SelectionState = {
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

  const [selection, setSelection] = useState<SelectionState>(defaultSelection);

  useEffect(() => {
    setSelection(defaultSelection);
  }, [defaultSelection]);

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

  function rankedFoodOptions(stopTitle?: string) {
    return [...foodSpots]
      .sort((a, b) => {
        const scoreDiff =
          optionSortScore(a.name, stopTitle) - optionSortScore(b.name, stopTitle);
        if (scoreDiff !== 0) return -scoreDiff;
        return (b.rating ?? 0) - (a.rating ?? 0);
      })
      .slice(0, 4);
  }

  function rankedActivityOptions(stopTitle?: string) {
    return [...activities]
      .sort((a, b) => {
        const scoreDiff =
          optionSortScore(a.name, stopTitle) - optionSortScore(b.name, stopTitle);
        if (scoreDiff !== 0) return -scoreDiff;
        return (b.rating ?? 0) - (a.rating ?? 0);
      })
      .slice(0, 4);
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

            <div className="space-y-3">
              {(day.stops ?? []).map((stop, stopIndex) => {
                const key = stopKey(dayIndex, stopIndex);

                if (stop.kind === "stay") {
                  const options = rankedHotelOptions(stop.title);

                  return (
                    <div
                      key={key}
                      className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {stop.time ?? "Stay"}
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        Pick where to stay
                      </h4>
                      {stop.description ? (
                        <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                          {stop.description}
                        </p>
                      ) : null}

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
                              primaryUrl: hotel.bookingLink || hotel.websiteUrl,
                              primaryLabel: "Hotel site",
                              mapsUrl: hotel.mapsUrl,
                              photoRef: hotel.photoRef,
                              photoUrl: hotel.photoUrl,
                              fallbackPhotoUrl: destinationImageUrl,
                            }}
                            selected={selection.hotelName === hotel.name}
                            recommended={optionIndex === 0}
                            onSelect={() =>
                              setSelection((prev) => ({
                                ...prev,
                                hotelName: hotel.name,
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                }

                if (stop.kind === "food") {
                  const options = rankedFoodOptions(stop.title);

                  return (
                    <div
                      key={key}
                      className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {stop.time ?? "Food"}
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        Pick a food stop
                      </h4>
                      {stop.description ? (
                        <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                          {stop.description}
                        </p>
                      ) : null}

                      <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
                        {options.map((spot, optionIndex) => {
                          const estimatedCost = guessFoodCost(spot, travelerCount);

                          return (
                            <SelectorCard
                              key={spot.name}
                              option={{
                                name: spot.name,
                                subtitle: spot.shortDescription,
                                rating: spot.rating,
                                estimatedCost,
                                category: spot.category ?? spot.tags?.[0],
                                primaryUrl: spot.websiteUrl || spot.link,
                                primaryLabel: "Restaurant site",
                                mapsUrl: spot.mapsUrl,
                                photoRef: spot.photoRef,
                                photoUrl: spot.photoUrl,
                              }}
                              selected={selection.foods[key] === spot.name}
                              recommended={optionIndex === 0}
                              onSelect={() =>
                                setSelection((prev) => ({
                                  ...prev,
                                  foods: {
                                    ...prev.foods,
                                    [key]: spot.name,
                                  },
                                }))
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (stop.kind === "activity") {
                  const options = rankedActivityOptions(stop.title);

                  return (
                    <div
                      key={key}
                      className="rounded-[1.1rem] border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {stop.time ?? "Activity"}
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        Pick an activity
                      </h4>
                      {stop.description ? (
                        <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                          {stop.description}
                        </p>
                      ) : null}

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
                                category: activity.type,
                                primaryUrl:
                                  activity.websiteUrl || activity.bookingLink,
                                primaryLabel: "Activity site",
                                mapsUrl: activity.mapsUrl,
                                photoRef: activity.photoRef,
                                photoUrl: activity.photoUrl,
                              }}
                              selected={selection.activities[key] === activity.name}
                              recommended={optionIndex === 0}
                              onSelect={() =>
                                setSelection((prev) => ({
                                  ...prev,
                                  activities: {
                                    ...prev.activities,
                                    [key]: activity.name,
                                  },
                                }))
                              }
                            />
                          );
                        })}
                      </div>
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
                    <h4 className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {stop.title}
                    </h4>
                    {stop.description ? (
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                        {stop.description}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
