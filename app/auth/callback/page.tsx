"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const queryString = searchParams.toString();

    if (!queryString) {
      window.location.replace("/?authError=missing_auth_code");
      return;
    }

    window.location.replace(`/api/auth/callback?${queryString}`);
  }, [searchParams]);

  return (
    <div className="mx-auto max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-950">
        Finalizing sign-in
      </h1>
      <p className="mt-3 text-slate-600">Verifying Google sign-in...</p>
    </div>
  );
}

export default function GoogleAuthCallbackPage() {
  return (
    <main className="min-h-screen bg-[#f8fafc] px-6 py-10 text-slate-900">
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
