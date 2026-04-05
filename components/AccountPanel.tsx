"use client";

/**
 * Account sidebar for authentication-aware planner features.
 * It handles saved trips, account analytics, and other user-specific actions that sit beside the main trip-building experience.
 */


import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  getBrowserSupabaseAccessToken,
  syncBrowserSessionToServer,
  supabaseBrowserAuth,
} from "../lib/supabaseBrowserAuth";
import { formatDisplayText } from "../lib/displayText";
import {
} from "../lib/tripFollowUpState";
import {
  getTripBudgetStatus,
  getTripCountdownDays,
  getTripDeparturePlanCompletion,
  getTripNextDeadline,
  getTripPhaseLabel,
  getTripReadinessBlockers,
  getTripReadinessSummary,
} from "../lib/tripOperations";
import {
  getAllTripPlans,
  removeLocalTripPlan,
  removeLocalTripPlans,
  saveTripPlan,
  TRIP_STORE_UPDATED_EVENT,
} from "../lib/tripStore";
import {
} from "../lib/productAnalytics";
import {
} from "../lib/tripMomentum";
import { normalizeTripImageSet } from "../lib/tripImages";
import { TripPlan } from "../lib/types";
import { displayNameFromEmail } from "../lib/viewerIdentity";

export type AccountPanelUser = {
  id: string;
  email: string;
};

type Props = {
  refreshKey?: number;
  open: boolean;
  onClose: () => void;
  onUserChange?: (user: AccountPanelUser | null) => void;
};

type TripListFilter =
  | "all"
  | "draft"
  | "waiting"
  | "approved"
  | "booked"
  | "departing_soon"
  | "ready"
  | "at_risk";

type TripSortMode = "recent" | "countdown" | "readiness" | "name";
type DrawerCategory = "saved" | "shared";

function formatDate(value?: string) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getTripTitle(trip: TripPlan) {
  return (
    trip.title ??
    trip.name ??
    trip.destinationName ??
    trip.destination ??
    "Saved trip"
  );
}

function getTripSubtitle(trip: TripPlan) {
  return [
    trip.destinationName ?? trip.destination ?? trip.homeBaseCity,
    formatDate(trip.tripStartDate),
  ]
    .filter(Boolean)
    .join(" | ");
}

function SavedTripMeta({ trip }: { trip: TripPlan }) {
  const readiness = getTripReadinessSummary(trip);
  const countdown = getTripCountdownDays(trip);
  const blockers = getTripReadinessBlockers(trip);
  const nextDeadline = getTripNextDeadline(trip);
  const budgetStatus = getTripBudgetStatus(trip);
  const departurePlan = getTripDeparturePlanCompletion(trip);

  return (
    <div className="rounded-[1.15rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(249,245,238,0.7),rgba(240,244,248,0.74))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(20,30,45,0.84),rgba(11,18,31,0.88))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex rounded-full border border-slate-200 bg-[#fbf7ef]/72 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-300">
          {getTripPhaseLabel(trip)}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-[#fbf7ef]/72 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-300">
          Readiness {readiness.score}%
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-[#fbf7ef]/72 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-300">
          {countdown === null ? "Dates open" : `${countdown}d countdown`}
        </span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-slate-200/80 dark:bg-white/8">
        <div
          className="h-2 rounded-full bg-[linear-gradient(90deg,#7decc7,#d9b57c)]"
          style={{ width: `${Math.max(8, readiness.score)}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div>Travelers {readiness.travelerSummary.confirmed}/{readiness.travelerSummary.total}</div>
        <div>Departure plan {departurePlan.completed}/{departurePlan.total}</div>
        <div>{budgetStatus.label}</div>
        {nextDeadline ? (
          <div>
            {nextDeadline.isOverdue
              ? `Deadline overdue: ${nextDeadline.task.label}`
              : nextDeadline.isToday
                ? `Deadline today: ${nextDeadline.task.label}`
                : `Next deadline: ${nextDeadline.task.label}`}
          </div>
        ) : null}
        {blockers[0] ? <div>Blocker: {blockers[0]}</div> : null}
      </div>
    </div>
  );
}

function matchesTripFilter(trip: TripPlan, filter: TripListFilter) {
  const countdown = getTripCountdownDays(trip);
  const readiness = getTripReadinessSummary(trip);

  switch (filter) {
    case "draft":
      return trip.status !== "finalized";
    case "waiting":
      return trip.status === "finalized" && (trip.decisionStatus ?? "waiting_on_partner") === "waiting_on_partner";
    case "approved":
      return trip.decisionStatus === "approved";
    case "booked":
      return trip.decisionStatus === "booked";
    case "departing_soon":
      return trip.decisionStatus === "booked" && countdown !== null && countdown >= 0 && countdown <= 7;
    case "ready":
      return (trip.decisionStatus === "approved" || trip.decisionStatus === "booked") && readiness.score >= 85;
    case "at_risk":
      return (trip.decisionStatus === "approved" || trip.decisionStatus === "booked") && readiness.score < 60;
    case "all":
    default:
      return true;
  }
}

function matchesTripQuery(trip: TripPlan, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [
    trip.title,
    trip.name,
    trip.destinationName,
    trip.destination,
    trip.summary,
    trip.homeBaseCity,
    trip.decisionStatus,
  ]
    .filter(Boolean)
    .some((value) => `${value}`.toLowerCase().includes(normalized));
}

function sortTrips(trips: TripPlan[], mode: TripSortMode) {
  return [...trips].sort((a, b) => {
    if (mode === "name") {
      return getTripTitle(a).localeCompare(getTripTitle(b));
    }

    if (mode === "countdown") {
      const aCountdown = getTripCountdownDays(a);
      const bCountdown = getTripCountdownDays(b);
      const aValue = aCountdown === null ? 999 : aCountdown;
      const bValue = bCountdown === null ? 999 : bCountdown;
      if (aValue !== bValue) return aValue - bValue;
    }

    if (mode === "readiness") {
      const readinessDelta =
        getTripReadinessSummary(b).score - getTripReadinessSummary(a).score;
      if (readinessDelta !== 0) return readinessDelta;
    }

    return `${b.createdAt ?? ""}`.localeCompare(`${a.createdAt ?? ""}`);
  });
}

function SectionHeader({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d9b57c]">
        {eyebrow}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy}</p>
    </div>
  );
}

function SavedTripCard({
  trip,
  tone,
  action,
  meta,
  isEditingName = false,
  renameValue = "",
  renameBusy = false,
  onRenameValueChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
}: {
  trip: TripPlan;
  tone: "slate" | "violet";
  action?: React.ReactNode;
  meta?: React.ReactNode;
  isEditingName?: boolean;
  renameValue?: string;
  renameBusy?: boolean;
  onRenameValueChange?: (value: string) => void;
  onStartRename?: () => void;
  onCancelRename?: () => void;
  onSubmitRename?: () => void;
}) {
  const imageSet = normalizeTripImageSet(
    {
      imageUrl: trip.imageUrl,
      imageUrlLight: trip.imageUrlLight ?? trip.imageUrl,
      imageUrlDark: trip.imageUrlDark ?? trip.imageUrlLight ?? trip.imageUrl,
    },
    getTripTitle(trip)
  );
  const badgeClass =
    tone === "violet"
      ? "border-[#ecd7b7] bg-[#fff8ee]/78 text-[#8a5b18] dark:border-[#d9b57c]/30 dark:bg-[#d9b57c]/10 dark:text-[#f2d7ab]"
      : "border-[#b7ecda] bg-[#effff8]/82 text-[#0f766e] dark:border-[#7decc7]/20 dark:bg-[#7decc7]/10 dark:text-[#b6f4db]";

  return (
    <article
      tabIndex={0}
      className="group overflow-hidden rounded-[1.6rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(247,244,238,0.78),rgba(238,243,248,0.84))] shadow-[0_24px_70px_rgba(148,163,184,0.12)] outline-none transition hover:-translate-y-0.5 hover:border-[#7decc7]/35 hover:shadow-[0_28px_80px_rgba(148,163,184,0.16)] focus-visible:border-[#d9b57c]/45 focus-visible:ring-2 focus-visible:ring-[#d9b57c]/15 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(13,21,35,0.92),rgba(9,15,27,0.94))] dark:shadow-[0_24px_70px_rgba(2,6,23,0.24)] dark:hover:shadow-[0_28px_80px_rgba(2,6,23,0.3)]"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-slate-950 dark:text-white">
            {getTripTitle(trip)}
          </div>
          {getTripSubtitle(trip) ? (
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{getTripSubtitle(trip)}</div>
          ) : null}
        </div>

        <span
          className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${badgeClass}`}
        >
          Saved
        </span>
      </div>

      <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-300 group-hover:max-h-[32rem] group-hover:opacity-100 group-focus-within:max-h-[32rem] group-focus-within:opacity-100">
        <div className="border-t border-slate-200/80 px-4 py-4 dark:border-white/8">
          <div className="relative h-36 overflow-hidden rounded-[1.25rem] bg-slate-200/70 dark:bg-slate-900/70">
            <div
              className="absolute inset-0 bg-cover bg-center dark:hidden"
              style={{ backgroundImage: `url("${imageSet.lightUrl}")` }}
            />
            <div
              className="absolute inset-0 hidden bg-cover bg-center dark:block"
              style={{ backgroundImage: `url("${imageSet.darkUrl}")` }}
            />
          </div>

          {trip.summary ? (
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {formatDisplayText(trip.summary)}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/trip/${trip.id}`}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]"
            >
              See details
            </Link>
            {!isEditingName ? (
              <button
                type="button"
                onClick={onStartRename}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
              >
                Rename
              </button>
            ) : null}
            {action}
          </div>

          {meta ? <div className="mt-3">{meta}</div> : null}

          {isEditingName ? (
            <div className="mt-3 rounded-[1rem] border border-slate-200/80 bg-white/78 p-3 dark:border-white/10 dark:bg-white/[0.045]">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Trip name
              </label>
              <input
                type="text"
                value={renameValue}
                onChange={(event) => onRenameValueChange?.(event.target.value)}
                placeholder="Trip in Canmore"
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[#d9b57c]/35 focus:ring-2 focus:ring-[#d9b57c]/15 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onSubmitRename}
                  disabled={renameBusy}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]"
                >
                  {renameBusy ? "Saving..." : "Save name"}
                </button>
                <button
                  type="button"
                  onClick={onCancelRename}
                  disabled={renameBusy}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function AccountPanel({
  refreshKey = 0,
  open,
  onClose,
  onUserChange,
}: Props) {
  const [user, setUser] = useState<AccountPanelUser | null>(null);
  const [localTrips, setLocalTrips] = useState<TripPlan[]>([]);
  const [accountTrips, setAccountTrips] = useState<TripPlan[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [removingTripId, setRemovingTripId] = useState<string | null>(null);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingTripId, setRenamingTripId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<DrawerCategory>("saved");
  const [tripFilter] = useState<TripListFilter>("all");
  const [tripQuery, setTripQuery] = useState("");
  const [tripSort] = useState<TripSortMode>("recent");
  const filteredAccountTrips = useMemo(
    () =>
      sortTrips(
        accountTrips.filter(
          (trip) => matchesTripFilter(trip, tripFilter) && matchesTripQuery(trip, tripQuery)
        ),
        tripSort
      ),
    [accountTrips, tripFilter, tripQuery, tripSort]
  );
  const filteredLocalTrips = useMemo(
    () =>
      sortTrips(
        localTrips.filter(
          (trip) => matchesTripFilter(trip, tripFilter) && matchesTripQuery(trip, tripQuery)
        ),
        tripSort
      ),
    [localTrips, tripFilter, tripQuery, tripSort]
  );
  const combinedVisibleTrips = useMemo(() => {
    const seen = new Set<string>();
    return [...filteredAccountTrips, ...filteredLocalTrips].filter((trip) => {
      if (seen.has(trip.id)) return false;
      seen.add(trip.id);
      return true;
    });
  }, [filteredAccountTrips, filteredLocalTrips]);
  const savedTrips = useMemo(
    () => combinedVisibleTrips.filter((trip) => trip.status !== "finalized"),
    [combinedVisibleTrips]
  );
  const sharedTrips = useMemo(
    () => combinedVisibleTrips.filter((trip) => trip.status === "finalized"),
    [combinedVisibleTrips]
  );
  const userDisplayName = displayNameFromEmail(user?.email);
  const panelInputClass =
    "h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#d9b57c]/35 focus:ring-2 focus:ring-[#d9b57c]/15 dark:border-white/10 dark:bg-slate-950/72 dark:text-slate-100 dark:placeholder:text-slate-500";
  const panelPrimaryButtonClass =
    "inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]";
  const panelSecondaryButtonClass =
    "inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10";

  useEffect(() => {
    if (activeCategory === "saved" && savedTrips.length === 0 && sharedTrips.length > 0) {
      setActiveCategory("shared");
      return;
    }

    if (activeCategory === "shared" && sharedTrips.length === 0 && savedTrips.length > 0) {
      setActiveCategory("saved");
    }
  }, [activeCategory, savedTrips.length, sharedTrips.length]);

  useEffect(() => {
    onUserChange?.(user);
  }, [onUserChange, user]);

  async function buildAuthHeaders() {
    const token = await getBrowserSupabaseAccessToken();
    return token
      ? {
          Authorization: `Bearer ${token}`,
        }
      : undefined;
  }

  function loadLocalTrips() {
    const plans = getAllTripPlans().sort((a, b) =>
      `${b.createdAt ?? ""}`.localeCompare(`${a.createdAt ?? ""}`)
    );
    setLocalTrips(plans);
  }

  async function loadAccount() {
    loadLocalTrips();

    const token = await getBrowserSupabaseAccessToken();

    let nextUser: AccountPanelUser | null = null;
    let authHeaders: Record<string, string> | undefined;

    if (token) {
      await syncBrowserSessionToServer(token);

      const { data, error } = await supabaseBrowserAuth.auth.getUser(token);

      if (!error && data.user?.id && data.user.email) {
        nextUser = {
          id: data.user.id,
          email: data.user.email,
        };
        authHeaders = {
          Authorization: `Bearer ${token}`,
        };
      }
    }

    if (!nextUser) {
      authHeaders = await buildAuthHeaders();

      const meRes = await fetch("/api/auth/me", {
        cache: "no-store",
        headers: authHeaders,
      });
      const meData = await meRes.json().catch(() => null);
      nextUser = meData?.user ?? null;
    }

    setUser(nextUser);

    if (!nextUser) {
      setAccountTrips([]);
      return;
    }

    const tripsRes = await fetch("/api/account/trips", {
      cache: "no-store",
      headers: authHeaders,
    });
    const tripsData = await tripsRes.json().catch(() => null);
    setAccountTrips(Array.isArray(tripsData?.trips) ? tripsData.trips : []);
  }

  const refreshAccount = useEffectEvent(() => {
    loadAccount().catch((error) => {
      console.error("Failed to refresh account panel:", error);
    });
  });

  useEffect(() => {
    refreshAccount();

    const {
      data: { subscription },
    } = supabaseBrowserAuth.auth.onAuthStateChange(() => refreshAccount());

    const handleTripStoreUpdate = () => refreshAccount();
    if (typeof window !== "undefined") {
      window.addEventListener(TRIP_STORE_UPDATED_EVENT, handleTripStoreUpdate);
      window.addEventListener("storage", handleTripStoreUpdate);
    }

    return () => {
      subscription.unsubscribe();

      if (typeof window !== "undefined") {
        window.removeEventListener(TRIP_STORE_UPDATED_EVENT, handleTripStoreUpdate);
        window.removeEventListener("storage", handleTripStoreUpdate);
      }
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!open) return;

    refreshAccount();
  }, [open]);

  async function handleAuth(path: "/api/auth/login" | "/api/auth/signup") {
    try {
      setLoading(true);
      setStatus("");

      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setStatus(data?.error ?? "Authentication failed.");
        return;
      }

      setStatus(
        data?.needsEmailConfirmation
          ? data?.message ?? "Check your email to confirm the account."
          : path === "/api/auth/signup"
            ? "Account created."
            : "Logged in."
      );

      setPassword("");
      await loadAccount();
    } catch (error) {
      console.error("Account auth failed:", error);
      setStatus("Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleAuth() {
    try {
      setLoading(true);
      setStatus("");

      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data, error } = await supabaseBrowserAuth.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error) {
        setStatus(error.message || "Google sign-in failed.");
        setLoading(false);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      setStatus("Google sign-in failed.");
      setLoading(false);
    } catch (error) {
      console.error("Google auth failed:", error);
      setStatus("Google sign-in failed.");
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      setLoading(true);
      await supabaseBrowserAuth.auth.signOut();
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      setAccountTrips([]);
      setStatus("Logged out.");
    } catch (error) {
      console.error("Logout failed:", error);
      setStatus("Logout failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveTrip(tripId?: string) {
    if (!tripId) return;

    try {
      setRemovingTripId(tripId);
      setStatus("");

      const existsInAccount = accountTrips.some((trip) => trip.id === tripId);
      const existsLocally = localTrips.some((trip) => trip.id === tripId);

      if (existsInAccount) {
        const response = await fetch("/api/account/trips", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(await buildAuthHeaders()),
          },
          body: JSON.stringify({ tripId }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          setStatus(data?.error ?? "Failed to remove trip.");
          return;
        }
      }

      if (existsLocally) {
        removeLocalTripPlan(tripId);
      }

      setAccountTrips((prev) => prev.filter((trip) => trip.id !== tripId));
      setLocalTrips((prev) => prev.filter((trip) => trip.id !== tripId));
      setStatus("Trip removed from your account.");
    } catch (error) {
      console.error("Account trip removal failed:", error);
      setStatus("Failed to remove trip.");
    } finally {
      setRemovingTripId(null);
    }
  }

  async function handleRemoveAllSavedTrips() {
    if (!savedTrips.length) return;

    const confirmed = window.confirm(
      "Remove all saved trips? This will delete every non-finalized trip in this drawer."
    );

    if (!confirmed) return;

    try {
      setRemovingTripId("all-saved");
      setStatus("");

      const savedTripIds = savedTrips.map((trip) => trip.id);
      const accountSavedTripIds = savedTrips
        .filter((trip) => accountTrips.some((accountTrip) => accountTrip.id === trip.id))
        .map((trip) => trip.id);

      for (const tripId of accountSavedTripIds) {
        const response = await fetch("/api/account/trips", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(await buildAuthHeaders()),
          },
          body: JSON.stringify({ tripId }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.success) {
          throw new Error(data?.error ?? "Failed to remove saved trips.");
        }
      }

      removeLocalTripPlans(savedTripIds);
      setAccountTrips((prev) => prev.filter((trip) => !savedTripIds.includes(trip.id)));
      setLocalTrips((prev) => prev.filter((trip) => !savedTripIds.includes(trip.id)));
      setStatus("All saved trips removed.");
    } catch (error) {
      console.error("Bulk saved trip removal failed:", error);
      setStatus("Failed to remove all saved trips.");
    } finally {
      setRemovingTripId(null);
    }
  }

  function startRenameTrip(trip: TripPlan) {
    setEditingTripId(trip.id);
    setRenameValue(getTripTitle(trip));
    setStatus("");
  }

  function cancelRenameTrip() {
    setEditingTripId(null);
    setRenameValue("");
  }

  async function handleRenameTrip(trip: TripPlan) {
    const nextTitle = renameValue.trim();

    if (!nextTitle) {
      setStatus("Trip name cannot be empty.");
      return;
    }

    if (nextTitle === getTripTitle(trip)) {
      cancelRenameTrip();
      return;
    }

    try {
      setRenamingTripId(trip.id);
      setStatus("");

      const nextTrip: TripPlan = {
        ...trip,
        title: nextTitle,
      };

      const result = await saveTripPlan(nextTrip);
      if (!result.success) {
        setStatus(result.error ?? "Failed to rename trip.");
        return;
      }

      const savedTrip = result.trip ?? nextTrip;
      setLocalTrips((prev) => prev.map((item) => (item.id === trip.id ? savedTrip : item)));
      setAccountTrips((prev) => prev.map((item) => (item.id === trip.id ? savedTrip : item)));
      setStatus("Trip name updated.");
      cancelRenameTrip();
      await loadAccount();
    } catch (error) {
      console.error("Trip rename failed:", error);
      setStatus("Failed to rename trip.");
    } finally {
      setRenamingTripId(null);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close saved trips panel"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/58 backdrop-blur-[5px] transition ${open ? "opacity-100" : "opacity-0"}`}
      />

      <aside
          className={`absolute inset-y-0 left-0 flex w-full max-w-[460px] flex-col border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(246,243,237,0.88),rgba(235,241,247,0.92))] shadow-[0_34px_120px_rgba(148,163,184,0.18)] backdrop-blur-xl transition-transform duration-300 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,12,23,0.98),rgba(8,14,24,0.96))] dark:shadow-[0_34px_120px_rgba(2,6,23,0.45)] ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(125,236,199,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(217,181,124,0.14),transparent_42%)] px-5 py-5 dark:border-white/8 dark:bg-[radial-gradient(circle_at_top_left,rgba(125,236,199,0.08),transparent_34%),radial-gradient(circle_at_top_right,rgba(217,181,124,0.12),transparent_42%)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#d9b57c]">
                Travel desk
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {user ? `${userDisplayName}'s trips` : "Log in and keep planning"}
              </div>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-300">
                {user
                  ? "Your saved drafts, final trip links, and account access all live here."
                  : "Trips still save on this device. Log in if you also want them synced to your account."}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-[#fbf7ef]/72 text-slate-600 transition hover:bg-[#fffaf2] hover:text-slate-950 dark:border-white/10 dark:bg-white/6 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              X
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-200">
              {savedTrips.length} saved
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-200">
              {sharedTrips.length} shared
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-[#fbf7ef]/72 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-200">
              {user ? user.email : "Local only"}
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="rounded-[1.85rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(249,245,238,0.72),rgba(240,244,248,0.78))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.76),rgba(9,15,27,0.82))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <SectionHeader
              eyebrow={user ? "Account" : "Access"}
              title={user ? userDisplayName : "Log in"}
              copy={
                user
                  ? "Signed in and syncing saves across devices."
                  : "Use email or Google to sync this device with your account."
              }
            />
            {user ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex h-10 items-center justify-center rounded-full border border-[#b7ecda] bg-[#effff8] px-4 text-xs font-semibold text-[#0f766e] dark:border-[#7decc7]/20 dark:bg-[#7decc7]/10 dark:text-[#b6f4db]">
                  Account connected
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loading}
                  className={panelSecondaryButtonClass}
                >
                  Log out
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className={panelInputClass}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className={panelInputClass}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleAuth("/api/auth/login")}
                    disabled={loading}
                    className={panelPrimaryButtonClass}
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAuth("/api/auth/signup")}
                    disabled={loading}
                    className={panelSecondaryButtonClass}
                  >
                    Create account
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={loading}
                  className={`w-full ${panelSecondaryButtonClass}`}
                >
                  Continue with Google
                </button>
              </div>
            )}
          </section>

          <section className="rounded-[1.85rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(249,245,238,0.72),rgba(240,244,248,0.78))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(13,20,33,0.72),rgba(8,14,24,0.82))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div>
              <input
                type="text"
                value={tripQuery}
                onChange={(event) => setTripQuery(event.target.value)}
                placeholder="Search trips, destinations, or status"
                className={panelInputClass}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveCategory("saved")}
                className={`inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition ${
                  activeCategory === "saved"
                    ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                }`}
              >
                Saved ({savedTrips.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory("shared")}
                className={`inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition ${
                  activeCategory === "shared"
                    ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                }`}
              >
                Shared ({sharedTrips.length})
              </button>
            </div>
          </section>

          {activeCategory === "saved" ? (
            <section>
              <div className="flex items-start justify-between gap-3">
                <SectionHeader
                  eyebrow="Saved trips"
                  title={`${savedTrips.length} saved trip${savedTrips.length === 1 ? "" : "s"}`}
                  copy="Trips you are still building or keeping in planning."
                />
                {savedTrips.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleRemoveAllSavedTrips()}
                    disabled={removingTripId === "all-saved"}
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                  >
                    {removingTripId === "all-saved" ? "Removing..." : "Remove all"}
                  </button>
                ) : null}
              </div>
              {savedTrips.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {savedTrips.map((trip) => (
                    <SavedTripCard
                      key={`saved-${trip.id}`}
                      trip={trip}
                      tone="slate"
                      meta={<SavedTripMeta trip={trip} />}
                      isEditingName={editingTripId === trip.id}
                      renameValue={renameValue}
                      renameBusy={renamingTripId === trip.id}
                      onRenameValueChange={setRenameValue}
                      onStartRename={() => startRenameTrip(trip)}
                      onCancelRename={cancelRenameTrip}
                      onSubmitRename={() => void handleRenameTrip(trip)}
                      action={
                        <button
                          type="button"
                          onClick={() => void handleRemoveTrip(trip.id)}
                          disabled={removingTripId === trip.id || removingTripId === "all-saved"}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                        >
                          {removingTripId === trip.id ? "Removing..." : "Remove"}
                        </button>
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  No saved trips right now.
                </p>
              )}
            </section>
          ) : (
            <section>
              <SectionHeader
                eyebrow="Shared trips"
                title={`${sharedTrips.length} shared trip${sharedTrips.length === 1 ? "" : "s"}`}
                copy="Trips that have been finalized and are ready to send around, review, or book from."
              />
              {sharedTrips.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {sharedTrips.map((trip) => (
                    <SavedTripCard
                      key={`shared-${trip.id}`}
                      trip={trip}
                      tone="violet"
                      meta={<SavedTripMeta trip={trip} />}
                      isEditingName={editingTripId === trip.id}
                      renameValue={renameValue}
                      renameBusy={renamingTripId === trip.id}
                      onRenameValueChange={setRenameValue}
                      onStartRename={() => startRenameTrip(trip)}
                      onCancelRename={cancelRenameTrip}
                      onSubmitRename={() => void handleRenameTrip(trip)}
                      action={
                        <button
                          type="button"
                          onClick={() => void handleRemoveTrip(trip.id)}
                          disabled={removingTripId === trip.id}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:hover:bg-white/10"
                        >
                          {removingTripId === trip.id ? "Removing..." : "Remove"}
                        </button>
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  No shared trips right now.
                </p>
              )}
            </section>
          )}

          {status ? (
            <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,rgba(249,245,238,0.74),rgba(240,244,248,0.78))] px-4 py-3 text-sm text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(20,30,45,0.84),rgba(11,18,31,0.88))] dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              {status}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
