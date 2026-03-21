"use client";

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

function displayNameFromEmail(email?: string) {
  if (!email) return "Guest";
  return email.split("@")[0] || email;
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
