"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { getTripPlanById, upsertLocalTripPlan } from "../../../lib/tripStore";
import TripHeader from "../../../components/TripHeader";
import BudgetBreakdown from "../../../components/BudgetBreakdown";
import TripActions from "../../../components/TripActions";
import InteractiveItinerary from "../../../components/InteractiveItinerary";
import { formatDateRange } from "../../../lib/tripDates";
import { isStartCity } from "../../../lib/startCities";
import { estimateFoodCostForGroup } from "../../../lib/foodPricing";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripSelectionState,
  TripPlan,
} from "../../../lib/types";

const TripStopMap = dynamic(() => import("../../../components/TripStopMap"), {
  ssr: false,
});

function formatMoney(value: number) {
  return `$${Math.round(value)}`;
}

function formatDistanceMeters(distanceMeters?: number) {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return undefined;
  }

  const distanceKm = distanceMeters / 1000;
  return `${distanceKm.toFixed(distanceKm >= 10 ? 0 : 1)} km`;
}

function formatDurationSeconds(durationSeconds?: number) {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
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

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function emptySelectionState(): TripSelectionState {
  return {
    hotelName: undefined,
    foods: {},
    activities: {},
  };
}

function selectionStatesEqual(a: TripSelectionState, b: TripSelectionState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deriveTripLengthDays(trip: TripPlan | null): number {
  const explicitLength = Number(trip?.tripLengthDays);
  if (Number.isFinite(explicitLength) && explicitLength > 0) {
    return explicitLength;
  }

  if (trip?.tripStartDate && trip?.tripEndDate) {
    const start = new Date(`${trip.tripStartDate}T00:00:00`);
    const end = new Date(`${trip.tripEndDate}T00:00:00`);

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const diffMs = end.getTime() - start.getTime();
      const diffDays = Math.round(diffMs / 86400000) + 1;

      if (Number.isFinite(diffDays) && diffDays > 0) {
        return diffDays;
      }
    }
  }

  return 2;
}

function getStartCityLabel(trip: TripPlan | null): string {
  if (isStartCity(trip?.startCity)) {
    return `${trip.startCity}, Alberta`;
  }

  const raw = `${trip?.routeSummary?.origin?.label ?? ""} ${trip?.summary ?? ""} ${trip?.name ?? ""}`.toLowerCase();

  if (raw.includes("calgary")) return "Calgary, Alberta";
  return "Edmonton, Alberta";
}

function getDestinationLabel(trip: TripPlan | null): string {
  const province = typeof trip?.province === "string" && trip.province.trim()
    ? trip.province.trim()
    : "Alberta";

  const cleanLabel = (value?: string) =>
    typeof value === "string"
      ? value.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim()
      : "";

  const homeBase = cleanLabel(trip?.homeBaseCity);
  if (homeBase) {
    return `${homeBase}, ${province}`;
  }

  const destinationName = cleanLabel(trip?.destinationName);
  if (destinationName) {
    return `${destinationName}, ${province}`;
  }

  const destination = cleanLabel(trip?.destination);
  if (destination) {
    return `${destination}, ${province}`;
  }

  const name = cleanLabel(trip?.name);
  if (name) {
    return `${name}, ${province}`;
  }

  return "Banff, Alberta";
}

function pickMatchedHotel(hotels: HotelOption[], stopTitle?: string) {
  return [...hotels]
    .sort((a, b) => {
      const scoreDiff =
        optionSortScore(a.name, stopTitle?.replace(/^Check in at\s+/i, "")) -
        optionSortScore(b.name, stopTitle?.replace(/^Check in at\s+/i, ""));

      if (scoreDiff !== 0) return -scoreDiff;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .at(0);
}

function pickMatchedFood(foodSpots: FoodSpot[], stopTitle?: string) {
  return [...foodSpots]
    .sort((a, b) => {
      const scoreDiff =
        optionSortScore(a.name, stopTitle) - optionSortScore(b.name, stopTitle);
      if (scoreDiff !== 0) return -scoreDiff;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .at(0);
}

function pickMatchedActivity(activities: Activity[], stopTitle?: string) {
  return [...activities]
    .sort((a, b) => {
      const scoreDiff =
        optionSortScore(a.name, stopTitle) - optionSortScore(b.name, stopTitle);
      if (scoreDiff !== 0) return -scoreDiff;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .at(0);
}

export default function TripPage() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadTrip() {
      if (!params?.tripId) return;

      setLoading(true);
      const found = await getTripPlanById(params.tripId);

      if (!cancelled) {
        setTrip(found);
        setLoading(false);
      }
    }

    loadTrip();

    return () => {
      cancelled = true;
    };
  }, [params?.tripId]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      if (!trip) return;
      if (trip.routeSummary?.distanceMeters && trip.routeSummary?.durationSeconds) return;

      try {
        const origin = getStartCityLabel(trip);
        const destination = getDestinationLabel(trip);

        const response = await fetch("/api/osm-route", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            origin,
            destination,
          }),
        });

        const data = await response.json();

        if (!cancelled && response.ok && data?.success && data?.route) {
          setTrip((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              routeSummary: data.route,
            };
          });
        }
      } catch (error) {
        console.error("Failed to load OpenStreetMap route:", error);
      }
    }

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [trip]);

  const itineraryDays = useMemo(
    () => (Array.isArray(trip?.itineraryDays) ? trip.itineraryDays : []),
    [trip]
  );
  const tripDateRange = formatDateRange(trip?.tripStartDate, trip?.tripEndDate);
  const [selectionState, setSelectionState] = useState<{
    tripId?: string;
    selection: TripSelectionState;
  }>({
    tripId: undefined,
    selection: emptySelectionState(),
  });

  const activeSelectionState = useMemo(() => {
    if (!trip) {
      return emptySelectionState();
    }

    if (selectionState.tripId === trip.id) {
      return selectionState.selection;
    }

    return trip.savedSelectionState ?? emptySelectionState();
  }, [selectionState, trip]);

  const travelerCount = useMemo(() => {
    const value = Number(trip?.travelerCount ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, [trip]);

  const selectedHotel = useMemo(() => {
    if (!trip) return undefined;

    return (trip.hotelOptions ?? []).find(
      (hotel: HotelOption) => hotel.name === activeSelectionState.hotelName
    ) ?? trip.hotelOptions?.[0];
  }, [activeSelectionState.hotelName, trip]);

  const selectedBudget = useMemo(() => {
    if (!trip) return null;

    const tripLengthDays = deriveTripLengthDays(trip);
    const nights = Math.max(1, tripLengthDays - 1);
    const gas = Number(trip?.budgetBreakdown?.gas ?? 0);

    const selectedHotel = (trip.hotelOptions ?? []).find(
      (hotel: HotelOption) => hotel.name === activeSelectionState.hotelName
    );

    const hotel =
      typeof selectedHotel?.totalStayPrice === "number"
        ? selectedHotel.totalStayPrice
        : typeof selectedHotel?.pricePerNight === "number"
          ? selectedHotel.pricePerNight * nights
          : Number(trip?.budgetBreakdown?.hotel ?? 0);

    const food = Object.values(activeSelectionState.foods).reduce((sum, selectedName) => {
      const spot = (trip.foodSpots ?? []).find(
        (item: FoodSpot) => item.name === selectedName
      );

      if (!spot) return sum;

      return sum + estimateFoodCostForGroup(spot, travelerCount);
    }, 0);

    const activities = Object.values(activeSelectionState.activities).reduce(
      (sum, selectedName) => {
        const activity = (trip.topActivities ?? []).find(
          (item: Activity) => item.name === selectedName
        );
        if (!activity) return sum;

        return (
          sum +
          (activity.costEstimate ?? activity.estimatedCost ?? 0) * travelerCount
        );
      },
      0
    );

    const misc = Math.round((hotel + food + gas + activities) * 0.1);
    const totalExpected = Math.round(hotel + food + gas + activities + misc);

    return {
      hotel: Math.round(hotel),
      food: Math.round(food),
      gas: Math.round(gas),
      activities: Math.round(activities),
      misc,
      total: totalExpected,
      totalExpected,
      totalLow: Math.round(totalExpected * 0.9),
      totalHigh: Math.round(totalExpected * 1.15),
    };
  }, [activeSelectionState, travelerCount, trip]);

  const targetTotalBudget = useMemo(() => {
    const fromSavedField = Number(trip?.totalBudget);
    if (Number.isFinite(fromSavedField) && fromSavedField > 0) {
      return fromSavedField;
    }
    return 0;
  }, [trip]);

  const budgetPerTraveler = useMemo(() => {
    const saved = Number(trip?.budgetPerTraveler);
    if (Number.isFinite(saved) && saved > 0) {
      return saved;
    }

    if (targetTotalBudget > 0 && travelerCount > 0) {
      return Math.round(targetTotalBudget / travelerCount);
    }

    return 0;
  }, [trip, targetTotalBudget, travelerCount]);

  const estimatedTotalCost = useMemo(() => {
    const fromBreakdown = Number(
      selectedBudget?.totalExpected ??
        trip?.budgetBreakdown?.totalExpected ??
        trip?.budgetBreakdown?.total
    );
    if (Number.isFinite(fromBreakdown) && fromBreakdown > 0) {
      return fromBreakdown;
    }
    return 0;
  }, [selectedBudget, trip]);

  const estimatedBudgetPerTraveler = useMemo(() => {
    if (estimatedTotalCost > 0 && travelerCount > 0) {
      return Math.round(estimatedTotalCost / travelerCount);
    }

    return 0;
  }, [estimatedTotalCost, travelerCount]);

  const budgetStatus = useMemo(() => {
    if (targetTotalBudget <= 0 || estimatedTotalCost <= 0) {
      return null;
    }

    const delta = estimatedTotalCost - targetTotalBudget;

    if (Math.abs(delta) <= Math.max(50, targetTotalBudget * 0.05)) {
      return {
        label: "On target",
        detail: `Within ${formatMoney(Math.abs(delta))} of your target budget.`,
      };
    }

    if (delta < 0) {
      return {
        label: "Under target",
        detail: `${formatMoney(Math.abs(delta))} under the target total.`,
      };
    }

    return {
      label: "Over target",
      detail: `${formatMoney(delta)} over the target total.`,
    };
  }, [estimatedTotalCost, targetTotalBudget]);

  const itineraryOverview = useMemo(() => {
    const editableStops = itineraryDays.reduce((sum, day) => {
      return (
        sum +
        (day.stops ?? []).filter((stop) =>
          stop.kind === "stay" || stop.kind === "food" || stop.kind === "activity"
        ).length
      );
    }, 0);

    const foodStops = itineraryDays.reduce(
      (sum, day) => sum + (day.stops ?? []).filter((stop) => stop.kind === "food").length,
      0
    );
    const activityStops = itineraryDays.reduce(
      (sum, day) => sum + (day.stops ?? []).filter((stop) => stop.kind === "activity").length,
      0
    );

    return { editableStops, foodStops, activityStops };
  }, [itineraryDays]);

  const tripMapData = useMemo(() => {
    if (!trip) {
      return { pins: [], routePaths: [], missingLocationCount: 0 };
    }

    const hotels = trip.hotelOptions ?? [];
    const foodSpots = trip.foodSpots ?? [];
    const activities = trip.topActivities ?? [];
    const pins: Array<{
      id: string;
      label: string;
      day: number;
      type: "stay" | "food" | "activity";
      latitude: number;
      longitude: number;
      subtitle?: string;
      mapsUrl?: string;
    }> = [];
    const routePaths: Array<{
      day: number;
      points: Array<{
        latitude: number;
        longitude: number;
      }>;
    }> = [];
    let missingLocationCount = 0;
    const selectedHotel =
      hotels.find((hotel) => hotel.name === activeSelectionState.hotelName) ??
      hotels[0];

    itineraryDays.forEach((day: ItineraryDayData, dayIndex) => {
      const dayNumber = dayIndex + 1;
      const routePoints: Array<{
        latitude: number;
        longitude: number;
      }> = [];

      if (
        selectedHotel &&
        typeof selectedHotel.latitude === "number" &&
        typeof selectedHotel.longitude === "number"
      ) {
        routePoints.push({
          latitude: selectedHotel.latitude,
          longitude: selectedHotel.longitude,
        });
      }

      (day.stops ?? []).forEach((stop, stopIndex) => {
        const key = stopKey(dayIndex, stopIndex);

        if (stop.kind === "stay") {
          const selectedHotel =
            hotels.find((hotel) => hotel.name === activeSelectionState.hotelName) ??
            pickMatchedHotel(hotels, stop.title);

          if (!selectedHotel) {
            return;
          }

          if (
            typeof selectedHotel.latitude === "number" &&
            typeof selectedHotel.longitude === "number"
          ) {
            pins.push({
              id: `stay-${key}-${selectedHotel.name}`,
              label: selectedHotel.name,
              day: dayNumber,
              type: "stay",
              latitude: selectedHotel.latitude,
              longitude: selectedHotel.longitude,
              subtitle: selectedHotel.shortDescription,
              mapsUrl: selectedHotel.mapsUrl || selectedHotel.bookingLink,
            });

            const alreadyAddedHotelRoutePoint = routePoints.some(
              (point) =>
                Math.abs(point.latitude - selectedHotel.latitude!) < 0.00001 &&
                Math.abs(point.longitude - selectedHotel.longitude!) < 0.00001
            );

            if (!alreadyAddedHotelRoutePoint) {
              routePoints.push({
                latitude: selectedHotel.latitude,
                longitude: selectedHotel.longitude,
              });
            }
          } else {
            missingLocationCount += 1;
          }

          return;
        }

        if (stop.kind === "food") {
          const selectedName =
            activeSelectionState.foods[key] ??
            pickMatchedFood(foodSpots, stop.title)?.name;
          const selectedFood = foodSpots.find((spot) => spot.name === selectedName);

          if (!selectedFood) {
            return;
          }

          if (
            typeof selectedFood.latitude === "number" &&
            typeof selectedFood.longitude === "number"
          ) {
            pins.push({
              id: `food-${key}-${selectedFood.name}`,
              label: selectedFood.name,
              day: dayNumber,
              type: "food",
              latitude: selectedFood.latitude,
              longitude: selectedFood.longitude,
              subtitle: selectedFood.shortDescription,
              mapsUrl: selectedFood.mapsUrl || selectedFood.websiteUrl || selectedFood.link,
            });

            routePoints.push({
              latitude: selectedFood.latitude,
              longitude: selectedFood.longitude,
            });
          } else {
            missingLocationCount += 1;
          }

          return;
        }

        if (stop.kind === "activity") {
          const selectedName =
            activeSelectionState.activities[key] ??
            pickMatchedActivity(activities, stop.title)?.name;
          const selectedActivity = activities.find(
            (activity) => activity.name === selectedName
          );

          if (!selectedActivity) {
            return;
          }

          if (
            typeof selectedActivity.latitude === "number" &&
            typeof selectedActivity.longitude === "number"
          ) {
            pins.push({
              id: `activity-${key}-${selectedActivity.name}`,
              label: selectedActivity.name,
              day: dayNumber,
              type: "activity",
              latitude: selectedActivity.latitude,
              longitude: selectedActivity.longitude,
              subtitle: selectedActivity.shortDescription,
              mapsUrl:
                selectedActivity.mapsUrl ||
                selectedActivity.websiteUrl ||
                selectedActivity.bookingLink,
            });

            routePoints.push({
              latitude: selectedActivity.latitude,
              longitude: selectedActivity.longitude,
            });
          } else {
            missingLocationCount += 1;
          }
        }
      });

      if (routePoints.length >= 2) {
        routePaths.push({
          day: dayNumber,
          points: routePoints,
        });
      }
    });

    return { pins, routePaths, missingLocationCount };
  }, [activeSelectionState, itineraryDays, trip]);

  const persistedTrip = useMemo(() => {
    if (!trip) return null;

    return {
      ...trip,
      savedSelectionState: activeSelectionState,
      budgetBreakdown: selectedBudget ?? trip.budgetBreakdown,
    } satisfies TripPlan;
  }, [activeSelectionState, selectedBudget, trip]);

  useEffect(() => {
    if (!persistedTrip?.id) return;

    const timeout = window.setTimeout(() => {
      upsertLocalTripPlan(persistedTrip);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [persistedTrip]);

  const handleSelectionChange = useCallback(
    (nextSelection: TripSelectionState) => {
      if (!trip) return;

      setSelectionState((current) => {
        if (
          current.tripId === trip.id &&
          selectionStatesEqual(current.selection, nextSelection)
        ) {
          return current;
        }

        return {
          tripId: trip.id,
          selection: nextSelection,
        };
      });
    },
    [trip]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-7xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Loading trip...
        </div>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-100">Trip not found</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">
            This trip could not be found locally or in the shared trip database.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
          >
            Back to planner
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <TripHeader trip={persistedTrip ?? trip} />

        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <aside className="xl:sticky xl:top-5">
            <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                  Planner rail
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                  Budget and actions
                </h2>
              </div>

              <div className="space-y-5 p-5">
                <section>
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Budget</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Compare your target budget against the estimated trip cost.
                    </p>
                    {tripDateRange ? (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Travel dates: {tripDateRange}
                      </p>
                    ) : null}
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
                      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                        Travelers
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                        {travelerCount}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
                      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                        Budget each
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(budgetPerTraveler)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
                      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                        Target total
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(targetTotalBudget)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300">
                        Selected each
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                        {formatMoney(estimatedBudgetPerTraveler)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300">
                        Selected total
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                        {formatMoney(estimatedTotalCost)}
                      </div>
                    </div>
                  </div>

                  <BudgetBreakdown breakdown={selectedBudget ?? trip.budgetBreakdown} />
                </section>

                <div className="border-t border-slate-200 dark:border-slate-800" />

                <TripActions trip={persistedTrip ?? trip} />
              </div>
            </div>
          </aside>

          {itineraryDays.length > 0 ? (
            <div className="space-y-5">
              <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                    Trip at a glance
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                    Ready-to-go snapshot
                  </h2>
                  <p className="max-w-3xl text-sm leading-5 text-slate-600 dark:text-slate-300">
                    Scan the weekend shape first, then fine-tune stops below. Food and budget numbers are shown as estimates, not live checkout prices.
                  </p>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Trip shape
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                      {deriveTripLengthDays(trip)} day{deriveTripLengthDays(trip) === 1 ? "" : "s"}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                      {itineraryOverview.editableStops} editable stops, {itineraryOverview.foodStops} food pick{itineraryOverview.foodStops === 1 ? "" : "s"}, {itineraryOverview.activityStops} activity pick{itineraryOverview.activityStops === 1 ? "" : "s"}.
                    </p>
                  </div>

                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Route reality
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                      {formatDurationSeconds(trip.routeSummary?.durationSeconds) ?? trip.driveTimeText}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                      {formatDistanceMeters(trip.routeSummary?.distanceMeters)
                        ? `${formatDistanceMeters(trip.routeSummary?.distanceMeters)} from ${getStartCityLabel(trip)} to ${getDestinationLabel(trip)}.`
                        : `${getStartCityLabel(trip)} to ${getDestinationLabel(trip)}.`}
                    </p>
                  </div>

                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      Stay plan
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                      {selectedHotel?.name ?? trip.homeBaseCity ?? trip.destinationName}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                      {selectedHotel?.shortDescription ??
                        "Your current hotel choice acts as the anchor for route and nearby-stop suggestions."}
                    </p>
                  </div>

                  <div className="rounded-[1rem] border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
                      Budget fit
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                      {budgetStatus?.label ?? "Estimated spend"}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-700 dark:text-slate-200">
                      {budgetStatus?.detail ??
                        `${formatMoney(estimatedTotalCost)} total estimated spend for ${travelerCount} traveler${travelerCount === 1 ? "" : "s"}.`}
                    </p>
                  </div>
                </div>
              </section>

              <TripStopMap
                pins={tripMapData.pins}
                routePaths={tripMapData.routePaths}
                missingLocationCount={tripMapData.missingLocationCount}
              />

              <InteractiveItinerary
                key={`${trip.id}:${JSON.stringify(trip.savedSelectionState ?? emptySelectionState())}`}
                days={itineraryDays}
                hotels={trip.hotelOptions ?? []}
                foodSpots={trip.foodSpots ?? []}
                activities={trip.topActivities ?? []}
                travelerCount={travelerCount}
                initialSelection={trip.savedSelectionState}
                destinationImageUrl={trip.imageUrl}
                destinationLabel={getDestinationLabel(trip)}
                tripStartDate={trip.tripStartDate}
                tripEndDate={trip.tripEndDate}
                startCityLabel={trip.startCity ?? undefined}
                startCityCoordinate={
                  typeof trip.routeSummary?.origin?.lat === "number" &&
                  typeof trip.routeSummary?.origin?.lon === "number"
                    ? {
                        latitude: trip.routeSummary.origin.lat,
                        longitude: trip.routeSummary.origin.lon,
                      }
                    : undefined
                }
                onSelectionChange={handleSelectionChange}
              />
            </div>
          ) : (
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-2xl font-semibold text-slate-950 dark:text-slate-100">Itinerary</h2>
              <p className="mt-4 text-slate-600 dark:text-slate-300">No itinerary generated yet.</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
