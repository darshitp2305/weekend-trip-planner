"use client";

/**
 * Helper module for viewer identity concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */


import { useEffect, useMemo, useState } from "react";

const VISITOR_STORAGE_KEY = "trippify-share-visitor-id";

type AccountUser = {
  id: string;
  email: string;
};

export type ViewerIdentity = {
  visitorId: string;
  userId?: string;
  email?: string;
  displayName: string;
  ready: boolean;
};

function getVisitorId() {
  if (typeof window === "undefined") return crypto.randomUUID();

  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;

    const created = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function displayNameFromEmail(email?: string) {
  if (!email) return "Guest";

  const localPart = email.split("@")[0]?.trim() || email.trim();
  if (!localPart) return "Guest";

  const normalized = localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return localPart;

  return normalized
    .split(" ")
    .map((segment) =>
      segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment
    )
    .join(" ");
}

export function useViewerIdentity() {
  const [visitorId] = useState(() => getVisitorId());
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadViewer() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);

        if (!cancelled && response.ok && data?.user?.id && data?.user?.email) {
          setAccountUser({
            id: data.user.id,
            email: data.user.email,
          });
        }
      } catch (error) {
        console.error("Failed to resolve viewer identity:", error);
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    loadViewer();

    return () => {
      cancelled = true;
    };
  }, []);

  const identity = useMemo<ViewerIdentity>(
    () => ({
      visitorId,
      userId: accountUser?.id,
      email: accountUser?.email,
      displayName: displayNameFromEmail(accountUser?.email),
      ready,
    }),
    [accountUser?.email, accountUser?.id, ready, visitorId]
  );

  return identity;
}
