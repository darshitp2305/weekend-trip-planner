import type { TripPlan } from "./types";
import { getBrowserSupabaseAccessToken } from "./supabaseBrowserAuth";

const STORAGE_KEY = "weekend-trip-plans";
const PENDING_SYNC_STORAGE_KEY = "weekend-trip-pending-sync";
export const TRIP_STORE_UPDATED_EVENT = "trip-store-updated";

type PendingTripSyncRecord = {
  plan: TripPlan;
  savedAt: string;
};

async function getAuthenticatedHeaders() {
  const accessToken =
    typeof window !== "undefined" ? await getBrowserSupabaseAccessToken() : null;

  return accessToken
    ? {
        Authorization: `Bearer ${accessToken}`,
      }
    : undefined;
}

function readLocalPlans(): TripPlan[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to read local trip plans:", error);
    return [];
  }
}

function writeLocalPlans(plans: TripPlan[]) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    window.dispatchEvent(new CustomEvent(TRIP_STORE_UPDATED_EVENT));
  } catch (error) {
    console.error("Failed to write local trip plans:", error);
  }
}

function readPendingTripSyncMap(): Record<string, PendingTripSyncRecord> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(PENDING_SYNC_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PendingTripSyncRecord>) : {};
  } catch (error) {
    console.error("Failed to read pending trip sync state:", error);
    return {};
  }
}

function writePendingTripSyncMap(records: Record<string, PendingTripSyncRecord>) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent(TRIP_STORE_UPDATED_EVENT));
  } catch (error) {
    console.error("Failed to write pending trip sync state:", error);
  }
}

export function getPendingTripSyncRecord(id: string): PendingTripSyncRecord | null {
  return readPendingTripSyncMap()[id] ?? null;
}

export function clearPendingTripSyncRecord(id: string) {
  const records = readPendingTripSyncMap();
  if (!records[id]) return;

  delete records[id];
  writePendingTripSyncMap(records);
}

function removePendingTripSyncRecords(ids: string[]) {
  if (!ids.length) return;

  const records = readPendingTripSyncMap();
  let changed = false;

  for (const id of ids) {
    if (records[id]) {
      delete records[id];
      changed = true;
    }
  }

  if (changed) {
    writePendingTripSyncMap(records);
  }
}

function upsertPendingTripSyncRecord(plan: TripPlan) {
  const records = readPendingTripSyncMap();
  records[plan.id] = {
    plan,
    savedAt: new Date().toISOString(),
  };
  writePendingTripSyncMap(records);
}

export function upsertLocalTripPlan(plan: TripPlan) {
  const plans = readLocalPlans();
  const next = plans.filter((p) => p.id !== plan.id);
  next.push(plan);
  writeLocalPlans(next);
}

export function removeLocalTripPlan(id: string) {
  removeLocalTripPlans([id]);
}

export function removeLocalTripPlans(ids: string[]) {
  if (!ids.length) return;

  const idSet = new Set(ids);
  const next = readLocalPlans().filter((plan) => !idSet.has(plan.id));
  writeLocalPlans(next);
  removePendingTripSyncRecords(ids);
}

export async function saveTripPlan(plan: TripPlan) {
  upsertLocalTripPlan(plan);

  try {
    const authHeaders = await getAuthenticatedHeaders();

    const response = await fetch("/api/save-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ plan }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Remote save failed.");
    }

    if (data?.trip) {
      upsertLocalTripPlan(data.trip as TripPlan);
    }
    clearPendingTripSyncRecord(plan.id);

    return {
      success: true,
      id: plan.id,
      shareUrl: data.shareUrl as string,
      remoteSaved: true,
      accountSaved: Boolean(data?.accountSaved),
      trip: (data?.trip as TripPlan | undefined) ?? plan,
    };
  } catch (error) {
    console.error("Remote trip save failed, local save kept:", error);
    upsertPendingTripSyncRecord(plan);

    return {
      success: true,
      id: plan.id,
      shareUrl: `/trip/${plan.id}`,
      remoteSaved: false,
      accountSaved: false,
      trip: plan,
    };
  } finally {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(TRIP_STORE_UPDATED_EVENT));
    }
  }
}

export async function getTripPlanById(id: string): Promise<TripPlan | null> {
  try {
    const authHeaders = await getAuthenticatedHeaders();
    const response = await fetch(`/api/trips/${id}`, {
      method: "GET",
      cache: "no-store",
      headers: authHeaders,
    });

    const data = await response.json().catch(() => null);

    if (response.ok && data?.success && data?.trip) {
      const trip = data.trip as TripPlan;
      upsertLocalTripPlan(trip);
      return trip;
    }
  } catch (error) {
    console.error("Failed to load shared trip:", error);
  }

  return readLocalPlans().find((p) => p.id === id) ?? null;
}

export function getAllTripPlans(): TripPlan[] {
  return readLocalPlans();
}
