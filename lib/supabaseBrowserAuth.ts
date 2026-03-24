"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL in environment.");
}

if (!supabasePublishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY in environment."
  );
}

export const supabaseBrowserAuth = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

export async function getBrowserSupabaseAccessToken() {
  const { data, error } = await supabaseBrowserAuth.auth.getSession();
  if (error) {
    console.error("Failed to read browser Supabase session:", error);
    return null;
  }

  return data.session?.access_token ?? null;
}

export async function syncBrowserSessionToServer(accessToken?: string | null) {
  const token = accessToken ?? (await getBrowserSupabaseAccessToken());
  if (!token) return false;

  try {
    const response = await fetch("/api/auth/google-session", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accessToken: token,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      console.error("Failed to sync browser session to server:", payload);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to sync browser session to server:", error);
    return false;
  }
}
