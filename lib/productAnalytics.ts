"use client";

import { TripPlan } from "./types";
import { getBrowserSupabaseAccessToken } from "./supabaseBrowserAuth";

export type ProductAnalyticsEventName =
  | "trip_generated"
  | "trip_built"
  | "trip_saved"
  | "trip_finalized"
  | "trip_share_opened"
  | "trip_approved"
  | "trip_booked"
  | "trip_follow_up_copied"
  | "trip_follow_up_opened"
  | "trip_follow_up_snoozed"
  | "trip_follow_up_resolved"
  | "trip_traveler_updated"
  | "trip_departure_task_updated"
  | "trip_operations_note_added"
  | "trip_departure_brief_copied"
  | "trip_departure_plan_updated"
  | "trip_payments_updated";

export type ProductAnalyticsEvent = {
  id?: string;
  name: ProductAnalyticsEventName;
  at: string;
  tripId?: string;
  destinationName?: string;
  status?: TripPlan["status"];
  decisionStatus?: TripPlan["decisionStatus"];
  dataSource?: TripPlan["dataSource"];
  ownerUserId?: string;
  metadata?: Record<string, unknown>;
};

const ANALYTICS_STORAGE_KEY = "weekend-trip-analytics-events";
const MAX_STORED_EVENTS = 100;
export const PRODUCT_ANALYTICS_UPDATED_EVENT = "product-analytics-updated";

function readStoredEvents(): ProductAnalyticsEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(ANALYTICS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredEvents(events: ProductAnalyticsEvent[]) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(
      ANALYTICS_STORAGE_KEY,
      JSON.stringify(events.slice(-MAX_STORED_EVENTS))
    );
    window.dispatchEvent(new CustomEvent(PRODUCT_ANALYTICS_UPDATED_EVENT));
  } catch {
    // best-effort only
  }
}

function enqueueEvent(event: ProductAnalyticsEvent) {
  const events = readStoredEvents();
  events.push(event);
  writeStoredEvents(events);
}

export function getStoredProductAnalyticsEvents() {
  return readStoredEvents();
}

export function mergeProductAnalyticsEvents(events: ProductAnalyticsEvent[]) {
  const seen = new Set<string>();
  const merged: ProductAnalyticsEvent[] = [];

  for (const event of [...events].sort((a, b) => `${b.at}`.localeCompare(`${a.at}`))) {
    const key =
      event.id ??
      JSON.stringify({
        name: event.name,
        at: event.at,
        tripId: event.tripId,
        destinationName: event.destinationName,
      });

    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }

  return merged;
}

export function countProductEvents(
  events: ProductAnalyticsEvent[],
  name: ProductAnalyticsEventName
) {
  return events.filter((event) => event.name === name).length;
}

export function latestProductEvent(
  events: ProductAnalyticsEvent[],
  name: ProductAnalyticsEventName
) {
  return [...events]
    .sort((a, b) => `${b.at}`.localeCompare(`${a.at}`))
    .find((event) => event.name === name);
}

export function baseTripAnalytics(trip: TripPlan) {
  return {
    tripId: trip.id,
    destinationName: trip.destinationName || trip.name,
    status: trip.status,
    decisionStatus: trip.decisionStatus,
    dataSource: trip.dataSource,
    ownerUserId: trip.ownerUserId,
  };
}

export function trackProductEvent(
  name: ProductAnalyticsEventName,
  event: Omit<ProductAnalyticsEvent, "name" | "at">
) {
  if (typeof window === "undefined") return;

  const payload: ProductAnalyticsEvent = {
    id: event.id ?? crypto.randomUUID(),
    name,
    at: new Date().toISOString(),
    ...event,
  };

  enqueueEvent(payload);

  const body = JSON.stringify(payload);

  void (async () => {
    try {
      const accessToken = await getBrowserSupabaseAccessToken();

      if (!accessToken && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/analytics", blob);
        return;
      }

      await fetch("/api/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {}),
        },
        body,
        keepalive: true,
      });
    } catch {
      // local queue already kept the event
    }
  })();
}
