"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getBrowserSupabaseAccessToken,
  supabaseBrowserAuth,
} from "../lib/supabaseBrowserAuth";

type AccountUser = {
  id: string;
  email: string;
};

type AccountTrip = {
  id?: string;
  name?: string;
  title?: string;
  destinationName?: string;
  tripStartDate?: string;
};

type Props = {
  refreshKey?: number;
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

export default function AccountPanel({ refreshKey = 0 }: Props) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [trips, setTrips] = useState<AccountTrip[]>([]);
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

  async function loadAccount() {
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
      setTrips([]);
      return;
    }

    const tripsRes = await fetch("/api/account/trips", {
      cache: "no-store",
      headers: authHeaders,
    });
    const tripsData = await tripsRes.json().catch(() => null);
    setTrips(Array.isArray(tripsData?.trips) ? tripsData.trips : []);
  }

  useEffect(() => {
    loadAccount().catch((error) => {
      console.error("Failed to load account panel:", error);
    });
    const {
      data: { subscription },
    } = supabaseBrowserAuth.auth.onAuthStateChange(() => {
      loadAccount().catch((error) => {
        console.error("Failed to refresh account panel after auth state change:", error);
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshKey]);

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
      setTrips([]);
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

      setTrips((prev) => prev.filter((trip) => trip.id !== tripId));
      setStatus("Trip removed from your account.");
    } catch (error) {
      console.error("Account trip removal failed:", error);
      setStatus("Failed to remove trip.");
    } finally {
      setRemovingTripId(null);
    }
  }

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
        Account
      </div>

      {user ? (
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">{user.email}</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Trips you build can now be saved to this account.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
          >
            Log out
          </button>

          <div className="border-t border-slate-200 pt-4">
            <div className="text-sm font-semibold text-slate-900">Saved to account</div>
            {trips.length > 0 ? (
              <div className="mt-3 space-y-3">
                {trips.slice(0, 5).map((trip) => (
                  trip.id ? (
                    <div
                      key={trip.id ?? trip.destinationName}
                      className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <Link
                        href={`/trip/${trip.id}`}
                        className="min-w-0 flex-1 transition hover:text-violet-700"
                      >
                        <div className="text-sm font-medium text-slate-900">
                          {trip.title ?? trip.name ?? trip.destinationName ?? "Saved trip"}
                        </div>
                        {trip.tripStartDate ? (
                          <div className="mt-1 text-xs text-slate-500">
                            {formatDate(trip.tripStartDate)}
                          </div>
                        ) : null}
                      </Link>

                      <button
                        type="button"
                        onClick={() => handleRemoveTrip(trip.id)}
                        disabled={removingTripId === trip.id}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        {removingTripId === trip.id ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  ) : null
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                No account-saved trips yet.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-6 text-slate-600">
            Create an account or log in to save trips beyond this device.
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleAuth("/api/auth/login")}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              Log in
            </button>

            <button
              type="button"
              onClick={() => handleAuth("/api/auth/signup")}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
            >
              Create account
            </button>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
              Or
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={handleGoogleAuth}
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
          >
            Continue with Google
          </button>
        </div>
      )}

      {status ? <p className="mt-3 text-sm text-slate-600">{status}</p> : null}
    </div>
  );
}
