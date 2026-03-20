import type { TripPlan } from "./types";
import { getBrowserSupabaseAccessToken } from "./supabaseBrowserAuth";

const STORAGE_KEY = "weekend-trip-plans";
export const TRIP_STORE_UPDATED_EVENT = "trip-store-updated";

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

export function upsertLocalTripPlan(plan: TripPlan) {
  const plans = readLocalPlans();
  const next = plans.filter((p) => p.id !== plan.id);
  next.push(plan);
  writeLocalPlans(next);
}

export async function saveTripPlan(plan: TripPlan) {
  upsertLocalTripPlan(plan);

  try {
    const accessToken =
      typeof window !== "undefined" ? await getBrowserSupabaseAccessToken() : null;

    const response = await fetch("/api/save-trip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ plan }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Remote save failed.");
    }

    return {
      success: true,
      id: plan.id,
      shareUrl: data.shareUrl as string,
      remoteSaved: true,
      accountSaved: Boolean(data?.accountSaved),
    };
  } catch (error) {
    console.error("Remote trip save failed, local save kept:", error);

    return {
      success: true,
      id: plan.id,
      shareUrl: `/trip/${plan.id}`,
      remoteSaved: false,
      accountSaved: false,
    };
  } finally {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(TRIP_STORE_UPDATED_EVENT));
    }
  }
}

export async function getTripPlanById(id: string): Promise<TripPlan | null> {
  const local = readLocalPlans().find((p) => p.id === id) ?? null;
  if (local) return local;

  try {
    const response = await fetch(`/api/trips/${id}`, {
      method: "GET",
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success || !data?.trip) {
      return null;
    }

    const trip = data.trip as TripPlan;

    upsertLocalTripPlan(trip);

    return trip;
  } catch (error) {
    console.error("Failed to load shared trip:", error);
    return null;
  }
}

export function getAllTripPlans(): TripPlan[] {
  return readLocalPlans();
}
