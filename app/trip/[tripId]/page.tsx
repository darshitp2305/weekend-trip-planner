"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  clearPendingTripSyncRecord,
  getPendingTripSyncRecord,
  getTripPlanById,
  saveTripPlan,
  SaveTripPlanResult,
  upsertLocalTripPlan,
} from "../../../lib/tripStore";
import TripHeader from "../../../components/TripHeader";
import BudgetBreakdown from "../../../components/BudgetBreakdown";
import FinalizeTripPanel from "../../../components/FinalizeTripPanel";
import SharedTripSnapshot from "../../../components/SharedTripSnapshot";
import TripFeedbackPanel from "../../../components/TripFeedbackPanel";
import TripActions from "../../../components/TripActions";
import TripOperationsPanel from "../../../components/TripOperationsPanel";
import InteractiveItinerary from "../../../components/InteractiveItinerary";
import ExpediaStayWidget from "../../../components/ExpediaStayWidget";
import { formatDateRange } from "../../../lib/tripDates";
import { isStartCity } from "../../../lib/startCities";
import {
  buildDefaultSelectionState,
  calculateSelectedBudget,
  emptySelectionState,
  getAddedStopsForDay,
  getCustomStopForKey,
  normalizeSelectionState,
} from "../../../lib/tripSelections";
import { getPromptConstraintFitSummary } from "../../../lib/tripSpecificity";
import {
  baseTripAnalytics,
  trackProductEvent,
} from "../../../lib/productAnalytics";
import { useViewerIdentity } from "../../../lib/viewerIdentity";
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

type TripSyncSaveMessages = {
  syncedToAccount: string;
  syncedRemotely: string;
  localOnly: string;
};

function buildSyncStateFromSaveResult(
  result: Pick<SaveTripPlanResult, "remoteSaved" | "accountSaved">,
  lastSavedAt: string,
  messages: TripSyncSaveMessages
) {
  if (!result.remoteSaved) {
    return {
      phase: "local_only" as const,
      message: messages.localOnly,
      lastSavedAt,
    };
  }

  return {
    phase: "saved" as const,
    message: result.accountSaved
      ? messages.syncedToAccount
      : messages.syncedRemotely,
    lastSavedAt,
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
  const searchParams = useSearchParams();
  const viewer = useViewerIdentity();
  const trackedShareOpenRef = useRef<string | null>(null);
  const finalizedPanelRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToFinalizedPanelRef = useRef(false);
  const [trip, setTrip] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizeStatus, setFinalizeStatus] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [syncConflict, setSyncConflict] = useState<{
    pendingTrip: TripPlan;
    remoteTrip: TripPlan;
    savedAt?: string;
  } | null>(null);
  const [syncState, setSyncState] = useState<{
    phase: "idle" | "saving" | "saved" | "local_only" | "error";
    message: string;
    lastSavedAt?: string;
  }>({
    phase: "idle",
    message: "Waiting for edits.",
  });
  const [showBuilderModeBanner, setShowBuilderModeBanner] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadTrip() {
      if (!params?.tripId) return;

      setLoading(true);
      const found = await getTripPlanById(params.tripId);

      if (!cancelled) {
        setTrip(found);
        if (found) {
          const pendingRecord = getPendingTripSyncRecord(found.id);
          if (
            pendingRecord &&
            JSON.stringify(pendingRecord.plan) !== JSON.stringify(found)
          ) {
            setSyncConflict({
              pendingTrip: pendingRecord.plan,
              remoteTrip: found,
              savedAt: pendingRecord.savedAt,
            });
            setSyncState({
              phase: "local_only",
              message:
                "Unsynced local edits differ from the latest synced trip.",
              lastSavedAt: pendingRecord.savedAt,
            });
          } else if (pendingRecord) {
            clearPendingTripSyncRecord(found.id);
          }
        }
        setLoading(false);
      }
    }

    loadTrip();

    return () => {
      cancelled = true;
    };
  }, [params?.tripId]);

  useEffect(() => {
    setShowBuilderModeBanner(true);
  }, [trip?.id]);

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
  const constraintFitSummary = useMemo(
    () => (trip ? getPromptConstraintFitSummary(trip, trip) : undefined),
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
      return normalizeSelectionState(selectionState.selection);
    }

    return normalizeSelectionState(
      trip.savedSelectionState ??
      buildDefaultSelectionState(
        itineraryDays,
        trip.hotelOptions ?? [],
        trip.foodSpots ?? [],
        trip.topActivities ?? []
      )
    );
  }, [itineraryDays, selectionState, trip]);

  const travelerCount = useMemo(() => {
    const value = Number(trip?.travelerCount ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, [trip]);

  const hotelOptions = useMemo(() => trip?.hotelOptions ?? [], [trip?.hotelOptions]);

  const selectedHotel = useMemo(() => {
    if (!trip) return undefined;

    return hotelOptions.find(
      (hotel: HotelOption) => hotel.name === activeSelectionState.hotelName
    ) ?? hotelOptions[0];
  }, [activeSelectionState.hotelName, hotelOptions, trip]);

  const stayPriceIsVerified = selectedHotel?.availabilityStatus === "available";

  const selectedBudget = useMemo(() => {
    if (!trip) return null;

    return calculateSelectedBudget({
      tripLengthDays: deriveTripLengthDays(trip),
      travelerCount,
      hotelOptions,
      foodSpots: trip.foodSpots ?? [],
      activities: trip.topActivities ?? [],
      itineraryDays,
      selection: activeSelectionState,
      fallbackBreakdown: trip.budgetBreakdown,
    });
  }, [activeSelectionState, hotelOptions, itineraryDays, travelerCount, trip]);

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
        detail: stayPriceIsVerified
          ? `Within ${formatMoney(Math.abs(delta))} of your target budget.`
          : `Within ${formatMoney(Math.abs(delta))} of your target budget, but the stay price is still estimated.`,
      };
    }

    if (delta < 0) {
      return {
        label: "Under target",
        detail: stayPriceIsVerified
          ? `${formatMoney(Math.abs(delta))} under the target total.`
          : `${formatMoney(Math.abs(delta))} under the target total, but the stay price is still estimated.`,
      };
    }

    return {
      label: "Over target",
      detail: stayPriceIsVerified
        ? `${formatMoney(delta)} over the target total.`
        : `${formatMoney(delta)} over the target total, with the stay price still estimated.`,
    };
  }, [estimatedTotalCost, stayPriceIsVerified, targetTotalBudget]);

  const budgetDelta = useMemo(() => {
    if (targetTotalBudget <= 0 || estimatedTotalCost <= 0) {
      return null;
    }

    return estimatedTotalCost - targetTotalBudget;
  }, [estimatedTotalCost, targetTotalBudget]);

  const budgetNotes = useMemo(() => {
    const notes = [
      "Parking, trailhead, and conservation pass fees can still show up under misc.",
    ];

    if (!stayPriceIsVerified) {
      notes.unshift(
        "Stay pricing is still an estimate until the selected hotel has live availability for your dates."
      );
    }

    return notes;
  }, [stayPriceIsVerified]);

  const itineraryOverview = useMemo(() => {
    const editableStops = itineraryDays.reduce((sum, day, dayIndex) => {
      const addedStops = getAddedStopsForDay(activeSelectionState, dayIndex);
      return (
        sum +
        (day.stops ?? []).filter((stop) =>
          stop.kind === "stay" || stop.kind === "food" || stop.kind === "activity"
        ).length +
        addedStops.length
      );
    }, 0);

    const foodStops = itineraryDays.reduce(
      (sum, day, dayIndex) =>
        sum +
        (day.stops ?? []).filter((stop) => stop.kind === "food").length +
        getAddedStopsForDay(activeSelectionState, dayIndex).filter(
          (stop) => stop.kind === "food"
        ).length,
      0
    );
    const activityStops = itineraryDays.reduce(
      (sum, day, dayIndex) =>
        sum +
        (day.stops ?? []).filter((stop) => stop.kind === "activity").length +
        getAddedStopsForDay(activeSelectionState, dayIndex).filter(
          (stop) => stop.kind === "activity"
        ).length,
      0
    );

    return { editableStops, foodStops, activityStops };
  }, [activeSelectionState, itineraryDays]);

  const tripMapData = useMemo(() => {
    if (!trip) {
      return { pins: [], routePaths: [], missingLocationCount: 0 };
    }

    const hotels = hotelOptions;
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
        const customStop = getCustomStopForKey(activeSelectionState, key);

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
          if (customStop?.kind === "food") {
            if (
              typeof customStop.latitude === "number" &&
              typeof customStop.longitude === "number"
            ) {
              pins.push({
                id: `food-${key}-${customStop.id}`,
                label: customStop.title,
                day: dayNumber,
                type: "food",
                latitude: customStop.latitude,
                longitude: customStop.longitude,
                subtitle: customStop.description,
                mapsUrl: customStop.mapsUrl || customStop.websiteUrl,
              });

              routePoints.push({
                latitude: customStop.latitude,
                longitude: customStop.longitude,
              });
            } else {
              missingLocationCount += 1;
            }

            return;
          }

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
          if (customStop?.kind === "activity") {
            if (
              typeof customStop.latitude === "number" &&
              typeof customStop.longitude === "number"
            ) {
              pins.push({
                id: `activity-${key}-${customStop.id}`,
                label: customStop.title,
                day: dayNumber,
                type: "activity",
                latitude: customStop.latitude,
                longitude: customStop.longitude,
                subtitle: customStop.description,
                mapsUrl: customStop.mapsUrl || customStop.websiteUrl,
              });

              routePoints.push({
                latitude: customStop.latitude,
                longitude: customStop.longitude,
              });
            } else {
              missingLocationCount += 1;
            }

            return;
          }

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

      getAddedStopsForDay(activeSelectionState, dayIndex).forEach((addedStop) => {
        if (
          typeof addedStop.latitude === "number" &&
          typeof addedStop.longitude === "number"
        ) {
          pins.push({
            id: `${addedStop.kind}-${dayNumber}-${addedStop.id}`,
            label: addedStop.title,
            day: dayNumber,
            type: addedStop.kind === "food" ? "food" : "activity",
            latitude: addedStop.latitude,
            longitude: addedStop.longitude,
            subtitle: addedStop.description,
            mapsUrl: addedStop.mapsUrl || addedStop.websiteUrl,
          });

          routePoints.push({
            latitude: addedStop.latitude,
            longitude: addedStop.longitude,
          });
        } else {
          missingLocationCount += 1;
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
  }, [activeSelectionState, hotelOptions, itineraryDays, trip]);

  const persistedTrip = useMemo(() => {
    if (!trip) return null;

    return {
      ...trip,
      savedSelectionState: activeSelectionState,
      budgetBreakdown: selectedBudget ?? trip.budgetBreakdown,
    } satisfies TripPlan;
  }, [activeSelectionState, selectedBudget, trip]);

  const routeSummaryLabel = useMemo(() => {
    const duration = formatDurationSeconds(trip?.routeSummary?.durationSeconds);
    const distance = formatDistanceMeters(trip?.routeSummary?.distanceMeters);

    if (duration && distance) {
      return `${duration} drive covering about ${distance}.`;
    }

    if (duration) {
      return `${duration} drive.`;
    }

    if (distance) {
      return `About ${distance} on the road.`;
    }

    return undefined;
  }, [trip]);

  const requestedShareView = searchParams.get("view") === "share";
  const isOwner = useMemo(() => {
    if (!trip) return false;
    if (!trip.ownerUserId && !trip.ownerEmail) {
      return Boolean(trip.editToken);
    }
    if (!viewer.ready) return false;

    return Boolean(
      (viewer.userId && trip.ownerUserId && viewer.userId === trip.ownerUserId) ||
      (viewer.email && trip.ownerEmail && viewer.email === trip.ownerEmail)
    );
  }, [trip, viewer.email, viewer.ready, viewer.userId]);
  const isShareView =
    trip?.status === "finalized" &&
    (requestedShareView || (viewer.ready && !isOwner));

  useEffect(() => {
    if (!trip || !isShareView || !viewer.ready) return;

    const fingerprint = `${trip.id}:${isOwner ? "owner" : "viewer"}`;
    if (trackedShareOpenRef.current === fingerprint) {
      return;
    }

    trackedShareOpenRef.current = fingerprint;
    trackProductEvent("trip_share_opened", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: requestedShareView ? "share_query_param" : "auto_share_mode",
        isOwner,
      },
    });
  }, [isOwner, isShareView, requestedShareView, trip, viewer.ready]);

  useEffect(() => {
    if (!persistedTrip?.id) return;

    const timeout = window.setTimeout(() => {
      upsertLocalTripPlan(persistedTrip);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [persistedTrip]);

  const hasOwnerEditsPending = useMemo(() => {
    if (!persistedTrip || !trip) return false;
    if (!isOwner || !viewer.ready) return false;

    return JSON.stringify(persistedTrip) !== JSON.stringify(trip);
  }, [isOwner, persistedTrip, trip, viewer.ready]);

  useEffect(() => {
    if (!persistedTrip || !trip || !isOwner || !viewer.ready || !hasOwnerEditsPending) {
      return;
    }

    setSyncState((current) => ({
      phase: current.phase === "saving" ? "saving" : "idle",
      message:
        current.phase === "saving"
          ? "Saving your latest trip edits..."
          : "Unsaved owner edits detected.",
      lastSavedAt: current.lastSavedAt,
    }));

    const timeout = window.setTimeout(async () => {
      setSyncState((current) => ({
        ...current,
        phase: "saving",
        message: "Saving your latest trip edits...",
      }));

      try {
        const result = await saveTripPlan(persistedTrip);
        const savedAt = new Date().toISOString();
        const nextTrip = result.trip ?? persistedTrip;

        setTrip(nextTrip);
        setSelectionState({
          tripId: nextTrip.id,
          selection: nextTrip.savedSelectionState ?? emptySelectionState(),
        });
        if (result.remoteSaved) {
          clearPendingTripSyncRecord(nextTrip.id);
        }
        setSyncConflict(null);
        setSyncState(
          buildSyncStateFromSaveResult(result, savedAt, {
            syncedToAccount: "All trip edits are synced to your account.",
            syncedRemotely: "Trip edits are synced to the shared trip.",
            localOnly: "Trip edits are saved locally, but remote sync is still pending.",
          })
        );
      } catch (error) {
        console.error("Trip autosave failed:", error);
        setSyncState((current) => ({
          phase: "error",
          message: "Autosave failed. Your latest edits are still kept locally.",
          lastSavedAt: current.lastSavedAt,
        }));
      }
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [hasOwnerEditsPending, isOwner, persistedTrip, trip, viewer.ready]);

  const handleSelectionChange = useCallback(
    (nextSelection: TripSelectionState) => {
      if (!trip) return;

      setFinalizeStatus("");

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

  const handleFinalizeTrip = useCallback(async () => {
    if (!persistedTrip) return;
    const wasDraft = persistedTrip.status !== "finalized";

    try {
      setFinalizing(true);
      setFinalizeStatus("");

      const finalizedTrip: TripPlan = {
        ...persistedTrip,
        status: "finalized",
        finalizedAt: new Date().toISOString(),
      };

      const result = await saveTripPlan(finalizedTrip);

      if (!result.success) {
        setFinalizeStatus("Finalized trip save failed.");
        return;
      }

      if (wasDraft) {
        shouldScrollToFinalizedPanelRef.current = true;
      }

      setTrip(result.trip ?? finalizedTrip);
      setSelectionState({
        tripId: (result.trip ?? finalizedTrip).id,
        selection: (result.trip ?? finalizedTrip).savedSelectionState ?? emptySelectionState(),
      });
      setSyncState(
        buildSyncStateFromSaveResult(result, new Date().toISOString(), {
          syncedToAccount: "Finalized trip synced to your account.",
          syncedRemotely: "Finalized trip synced to the shared trip.",
          localOnly: "Finalized trip saved locally while remote sync is pending.",
        })
      );
      setFinalizeStatus(
        result.accountSaved
          ? "Finalized trip saved to your account."
          : result.remoteSaved
            ? "Finalized trip saved to the shared trip."
            : "Finalized trip saved locally."
      );
      trackProductEvent("trip_finalized", {
        ...baseTripAnalytics(result.trip ?? finalizedTrip),
        metadata: {
          accountSaved: result.accountSaved,
          selectionHotel: finalizedTrip.savedSelectionState?.hotelName,
          travelerCount: finalizedTrip.travelerCount,
        },
      });
    } catch (error) {
      console.error("Failed to finalize trip:", error);
      setFinalizeStatus("Finalized trip save failed.");
    } finally {
      setFinalizing(false);
    }
  }, [persistedTrip]);

  const handleTripUpdated = useCallback(
    (
      nextTrip: TripPlan,
      saveResult?: Pick<SaveTripPlanResult, "remoteSaved" | "accountSaved">
    ) => {
      const effectiveResult = saveResult ?? {
        remoteSaved: Boolean(nextTrip.ownerUserId || nextTrip.editToken),
        accountSaved: Boolean(nextTrip.ownerUserId),
      };

      setTrip(nextTrip);
      setSelectionState({
        tripId: nextTrip.id,
        selection: nextTrip.savedSelectionState ?? emptySelectionState(),
      });
      if (effectiveResult.remoteSaved) {
        clearPendingTripSyncRecord(nextTrip.id);
      }
      setSyncConflict(null);
      setSyncState(
        buildSyncStateFromSaveResult(effectiveResult, new Date().toISOString(), {
          syncedToAccount: "Trip changes synced.",
          syncedRemotely: "Trip changes synced to the shared trip.",
          localOnly: "Trip changes are saved locally while remote sync is pending.",
        })
      );
    },
    []
  );

  const handleUseLocalDraft = useCallback(() => {
    if (!syncConflict) return;

    setTrip(syncConflict.pendingTrip);
    setSelectionState({
      tripId: syncConflict.pendingTrip.id,
      selection: syncConflict.pendingTrip.savedSelectionState ?? emptySelectionState(),
    });
    setSyncState({
      phase: "local_only",
      message: "Using your unsynced local draft. Retry save when ready.",
      lastSavedAt: syncConflict.savedAt,
    });
  }, [syncConflict]);

  const handleUseRemoteVersion = useCallback(() => {
    if (!syncConflict) return;

    clearPendingTripSyncRecord(syncConflict.remoteTrip.id);
    setTrip(syncConflict.remoteTrip);
    setSelectionState({
      tripId: syncConflict.remoteTrip.id,
      selection: syncConflict.remoteTrip.savedSelectionState ?? emptySelectionState(),
    });
    setSyncConflict(null);
    setSyncState({
      phase: "saved",
      message: "Using the latest synced trip version.",
      lastSavedAt: new Date().toISOString(),
    });
  }, [syncConflict]);

  useEffect(() => {
    if (
      !shouldScrollToFinalizedPanelRef.current ||
      trip?.status !== "finalized" ||
      !finalizedPanelRef.current
    ) {
      return;
    }

    shouldScrollToFinalizedPanelRef.current = false;

    window.requestAnimationFrame(() => {
      finalizedPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [trip?.status]);

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

  const showDraftBuilderMode = trip.status !== "finalized";
  const showOperationsPanel =
    trip.decisionStatus === "approved" ||
    trip.decisionStatus === "booked";
  const handleBackButtonClick = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  };

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
      <div className={`mx-auto space-y-5 ${isShareView ? "max-w-6xl" : "max-w-[1400px]"}`}>
        {!isShareView ? (
          <div>
            <button
              type="button"
              onClick={handleBackButtonClick}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span aria-hidden="true">←</span>
              <span>Back</span>
            </button>
          </div>
        ) : null}

        <TripHeader trip={persistedTrip ?? trip} shareMode={isShareView} />
        {constraintFitSummary &&
        constraintFitSummary.toLowerCase().includes("approximate fit") ? (
          <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              Fit warning
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-amber-900 dark:text-amber-100">
              This is a best-fit draft, not a hard match. The requested ~15 km summit-hike target is still approximate and should be verified before you lock the trip around Ha Ling.
            </p>
          </section>
        ) : null}

        {isOwner && syncConflict ? (
          <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              Sync conflict
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              Local draft and synced trip diverged
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-200">
              You have unsynced local edits that differ from the latest synced trip. Choose which version to keep editing.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleUseLocalDraft}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-amber-300 dark:text-slate-950 dark:hover:bg-amber-200"
              >
                Keep local draft
              </button>
              <button
                type="button"
                onClick={handleUseRemoteVersion}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Use synced version
              </button>
            </div>
          </section>
        ) : null}

        {isShareView ? (
          <div className="space-y-5">
            <SharedTripSnapshot
              trip={persistedTrip ?? trip}
              selection={activeSelectionState}
              tripDateRange={tripDateRange}
              routeSummary={routeSummaryLabel}
              estimatedTotalCost={estimatedTotalCost}
              estimatedBudgetPerTraveler={estimatedBudgetPerTraveler}
              travelerCount={travelerCount}
            />

            <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <BudgetBreakdown
                breakdown={selectedBudget ?? trip.budgetBreakdown}
                notes={budgetNotes}
              />
            </section>

            <TripFeedbackPanel
              trip={persistedTrip ?? trip}
              onTripUpdated={handleTripUpdated}
              isOwner={isOwner}
              shareMode={true}
            />

            <TripStopMap
              pins={tripMapData.pins}
              routePaths={tripMapData.routePaths}
              missingLocationCount={tripMapData.missingLocationCount}
            />
          </div>
        ) : (
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <aside className="xl:sticky xl:top-5">
            <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                  Trip essentials
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                  {showDraftBuilderMode ? "Budget and builder" : "Budget and actions"}
                </h2>
              </div>

              <div className="space-y-5 p-5">
                <section>
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Budget</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  This updates as you swap stays, activities, and food stops.
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
                        {stayPriceIsVerified ? "Selected each" : "Estimated each"}
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                        {formatMoney(estimatedBudgetPerTraveler)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300">
                        {stayPriceIsVerified ? "Selected total" : "Estimated total"}
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                        {formatMoney(estimatedTotalCost)}
                      </div>
                    </div>
                  </div>

                  <BudgetBreakdown
                    breakdown={selectedBudget ?? trip.budgetBreakdown}
                    notes={budgetNotes}
                  />
                </section>

                <div className="border-t border-slate-200 dark:border-slate-800" />

                <TripActions
                  trip={persistedTrip ?? trip}
                  onTripUpdated={handleTripUpdated}
                  isOwner={isOwner}
                  syncState={syncState}
                />
              </div>
            </div>
          </aside>

          {itineraryDays.length > 0 ? (
            <div className="space-y-5">
              {!showDraftBuilderMode ? (
                <div ref={finalizedPanelRef}>
                  <FinalizeTripPanel
                    trip={persistedTrip ?? trip}
                    selection={activeSelectionState}
                    estimatedTotalCost={estimatedTotalCost}
                    budgetDelta={budgetDelta}
                    routeSummary={routeSummaryLabel}
                    onFinalize={handleFinalizeTrip}
                    finalizing={finalizing}
                    statusMessage={finalizeStatus}
                  />
                </div>
              ) : null}

              {!showDraftBuilderMode ? (
                <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                      Trip at a glance
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                      Ready-to-go snapshot
                    </h2>
                    <p className="max-w-3xl text-sm leading-5 text-slate-600 dark:text-slate-300">
                      Scan the trip shape first, then fine-tune stops below. Food and budget numbers are shown as estimates, not live checkout prices.
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
                          "Your current stay choice acts as the anchor for route and nearby-stop suggestions."}
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
              ) : null}

              {showBuilderModeBanner ? (
                <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                    Builder mode
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                    Change a day instead of restarting the trip
                  </h2>
                  <p className="max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-200">
                    This plan already starts with a recommended shape. Open any
                    stay, food stop, or activity below if you want to change a
                    specific day or fit something else into the itinerary.
                  </p>
                  {trip.tripPrompt ? (
                    <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                      Original brief: “{trip.tripPrompt}”
                    </p>
                  ) : null}
                  {constraintFitSummary ? (
                    <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                      Constraint check: {constraintFitSummary}
                    </p>
                  ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBuilderModeBanner(false)}
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-white/80 px-4 text-sm font-semibold text-emerald-800 transition hover:bg-white dark:border-emerald-400/30 dark:bg-slate-950/30 dark:text-emerald-200 dark:hover:bg-slate-950/50"
                    >
                      Hide
                    </button>
                  </div>
                </section>
              ) : null}

              {showDraftBuilderMode ? (
                <ExpediaStayWidget
                  destinationLabel={getDestinationLabel(trip)}
                  selectedHotel={selectedHotel}
                  tripStartDate={trip.tripStartDate}
                  tripEndDate={trip.tripEndDate}
                />
              ) : null}

              <InteractiveItinerary
                key={`${trip.id}:${JSON.stringify(trip.savedSelectionState ?? emptySelectionState())}`}
                days={itineraryDays}
                hotels={hotelOptions}
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

              <TripStopMap
                pins={tripMapData.pins}
                routePaths={tripMapData.routePaths}
                missingLocationCount={tripMapData.missingLocationCount}
              />

              {showDraftBuilderMode ? (
                <FinalizeTripPanel
                  trip={persistedTrip ?? trip}
                  selection={activeSelectionState}
                  estimatedTotalCost={estimatedTotalCost}
                  budgetDelta={budgetDelta}
                  routeSummary={routeSummaryLabel}
                  onFinalize={handleFinalizeTrip}
                  finalizing={finalizing}
                  statusMessage={finalizeStatus}
                />
              ) : null}

              {showOperationsPanel ? (
                <TripOperationsPanel
                  trip={persistedTrip ?? trip}
                  onTripUpdated={handleTripUpdated}
                  isOwner={isOwner}
                />
              ) : null}
            </div>
          ) : (
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-2xl font-semibold text-slate-950 dark:text-slate-100">Itinerary</h2>
              <p className="mt-4 text-slate-600 dark:text-slate-300">No itinerary generated yet.</p>
            </section>
          )}
        </div>
        )}
      </div>
    </main>
  );
}
