"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import {
  getBrowserSupabaseAccessToken,
  supabaseBrowserAuth,
} from "../lib/supabaseBrowserAuth";
import { formatDisplayText } from "../lib/displayText";
import { getAllTripPlans, TRIP_STORE_UPDATED_EVENT } from "../lib/tripStore";
import { TripPlan } from "../lib/types";

type AccountUser = {
  id: string;
  email: string;
};

type Props = {
  refreshKey?: number;
  open: boolean;
  onClose: () => void;
};

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

function getFallbackImageUrl(name?: string) {
  const seed = encodeURIComponent((name ?? "trippify").trim().toLowerCase());
  return `https://picsum.photos/seed/${seed}/1200/800`;
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
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
        {eyebrow}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy}</p>
    </div>
  );
}

function SavedTripCard({
  trip,
  tone,
  action,
}: {
  trip: TripPlan;
  tone: "slate" | "violet";
  action?: React.ReactNode;
}) {
  const imageUrl = trip.imageUrl?.trim() || getFallbackImageUrl(getTripTitle(trip));
  const badgeClass =
    tone === "violet"
      ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
      : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";

  return (
    <article
      tabIndex={0}
      className="group overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm outline-none transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-violet-500/50 dark:focus-visible:ring-violet-500/20"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-slate-950 dark:text-slate-100">
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
        <div className="border-t border-slate-200 px-4 py-4 dark:border-slate-800">
          <div
            className="h-36 rounded-[1.25rem] bg-slate-200 bg-cover bg-center dark:bg-slate-800"
            style={{ backgroundImage: `url("${imageUrl}")` }}
          />

          {trip.summary ? (
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {formatDisplayText(trip.summary)}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={`/trip/${trip.id}`}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
            >
              See details
            </Link>
            {action}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function AccountPanel({
  refreshKey = 0,
  open,
  onClose,
}: Props) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [localTrips, setLocalTrips] = useState<TripPlan[]>([]);
  const [accountTrips, setAccountTrips] = useState<TripPlan[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [removingTripId, setRemovingTripId] = useState<string | null>(null);

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

    let nextUser: AccountUser | null = null;
    let authHeaders: Record<string, string> | undefined;

    if (token) {
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

      setAccountTrips((prev) => prev.filter((trip) => trip.id !== tripId));
      setStatus("Trip removed from your account.");
    } catch (error) {
      console.error("Account trip removal failed:", error);
      setStatus("Failed to remove trip.");
    } finally {
      setRemovingTripId(null);
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
        className={`absolute inset-0 bg-slate-950/35 transition ${open ? "opacity-100" : "opacity-0"}`}
      />

      <aside
        className={`absolute inset-y-0 left-0 flex w-full max-w-[430px] flex-col border-r border-slate-200 bg-[#fffdf8] shadow-2xl transition-transform duration-300 dark:border-slate-800 dark:bg-slate-950 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              Saved trips
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-100">
              Your save drawer
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            X
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">
          <section className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              eyebrow={user ? "Account" : "Save access"}
              title={user ? user.email : "Sign in to sync saves"}
              copy={
                user
                  ? "This drawer shows trips saved on this device and trips synced to your account."
                  : "Trips still save on this device. Sign in here if you also want them synced to your account."
              }
            />
            {user ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex h-10 items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-4 text-xs font-semibold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
                  Account connected
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loading}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
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
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleAuth("/api/auth/login")}
                    disabled={loading}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAuth("/api/auth/signup")}
                    disabled={loading}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Create account
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  disabled={loading}
                  className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Continue with Google
                </button>
              </div>
            )}
          </section>

          {user ? (
            <section>
              <SectionHeader
                eyebrow="Synced"
                title={`${accountTrips.length} account save${accountTrips.length === 1 ? "" : "s"}`}
                copy="These are the trips currently saved to your account and should be your primary saved list."
              />
              {accountTrips.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {accountTrips.map((trip) => (
                    <SavedTripCard
                      key={`account-${trip.id}`}
                      trip={trip}
                      tone="violet"
                      action={
                        <button
                          type="button"
                          onClick={() => handleRemoveTrip(trip.id)}
                          disabled={removingTripId === trip.id}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {removingTripId === trip.id ? "Removing..." : "Remove"}
                        </button>
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  No account-saved trips yet.
                </p>
              )}
            </section>
          ) : null}

          <section>
            <SectionHeader
              eyebrow={user ? "Device backup" : "On this device"}
              title={`${localTrips.length} local save${localTrips.length === 1 ? "" : "s"}`}
              copy={
                user
                  ? "These are the trips stored in this browser on this device. They stay secondary to your synced account saves."
                  : "Hover a saved trip to expand it, preview the destination photo, and jump into the full trip page."
              }
            />
            {localTrips.length > 0 ? (
              <div className="mt-4 space-y-3">
                {localTrips.map((trip) => (
                  <SavedTripCard key={`local-${trip.id}`} trip={trip} tone="slate" />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                No locally saved trips yet.
              </p>
            )}
          </section>

          {status ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {status}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
