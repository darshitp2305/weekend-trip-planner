"use client";

/**
 * Next.js page that renders the page flow.
 * It assembles the relevant data loading and UI components for this route so the rest of the app can keep most logic in reusable helpers.
 */


import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "../../../components/BrandLogo";
import {
  getBrowserSupabaseAccessToken,
  supabaseBrowserAuth,
} from "../../../lib/supabaseBrowserAuth";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Completing Google sign-in...");

  useEffect(() => {
    let cancelled = false;

    async function completeGoogleAuth() {
      try {
        const code = searchParams.get("code");

        if (!code) {
          router.replace("/?authError=missing_auth_code");
          return;
        }

        setMessage("Verifying Google sign-in...");

        const { data, error } =
          await supabaseBrowserAuth.auth.exchangeCodeForSession(code);

        if (
          error ||
          !data.session?.access_token ||
          !data.session?.refresh_token
        ) {
          console.error("google callback client exchange failed:", error);
          router.replace("/?authError=google_callback_failed");
          return;
        }

        await supabaseBrowserAuth.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });

        const token =
          (await getBrowserSupabaseAccessToken()) ?? data.session.access_token;

        if (!token) {
          console.error("google callback session did not persist in browser");
          router.replace("/?authError=google_session_not_persisted");
          return;
        }

        setMessage("Creating your Trippify session...");

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

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.success) {
          console.error("google session handoff failed:", payload);
          router.replace("/?authError=google_session_failed");
          return;
        }

        if (!cancelled) {
          window.location.replace("/?authSuccess=google");
        }
      } catch (error) {
        console.error("google callback completion fatal error:", error);
        router.replace("/?authError=google_callback_failed");
      }
    }

    completeGoogleAuth();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="mx-auto max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-950">
        Finalizing sign-in
      </h1>
      <p className="mt-3 text-slate-600">{message}</p>
    </div>
  );
}

export default function GoogleAuthCallbackPage() {
  return (
    <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-slate-900">
      <div className="mx-auto mb-6 flex max-w-xl justify-center">
        <BrandLogo
          variant="stacked"
          href="/"
          priority
          className="scale-[0.88] sm:scale-100"
        />
      </div>
      <Suspense
        fallback={
          <div className="mx-auto max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-semibold text-slate-950">
              Finalizing sign-in
            </h1>
            <p className="mt-3 text-slate-600">
              Preparing secure sign-in callback...
            </p>
          </div>
        }
      >
        <CallbackContent />
      </Suspense>
    </main>
  );
}
