"use client";

import { useState } from "react";
import { saveTripPlan } from "../lib/tripStore";
import { TripPlan } from "../lib/types";

type Props = {
  trip: TripPlan;
};

function InfoPill({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

export default function TripActions({ trip }: Props) {
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    try {
      setSaving(true);
      setSaveStatus("");

      const result = await saveTripPlan(trip);

      if (!result.success) {
        setSaveStatus("Save failed.");
        return;
      }

      setSaveStatus(
        result.accountSaved
          ? "Saved to your account."
          : "Saved locally. Log in on the home page to save to an account."
      );
    } catch (error) {
      console.error("Trip action save failed:", error);
      setSaveStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const firstHotelSite =
    trip.hotelOptions?.[0]?.websiteUrl || trip.hotelOptions?.[0]?.bookingLink;

  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">
          Actions
        </h2>
        <p className="text-sm leading-5 text-slate-600">
          Quick actions for this saved plan.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <InfoPill>Saved locally</InfoPill>
        <InfoPill>Best on this device</InfoPill>
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          {saving ? "Saving..." : "Save"}
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          {copied ? "Link copied" : "Copy page link"}
        </button>

        {firstHotelSite ? (
          <a
            href={firstHotelSite}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Open lodging link
          </a>
        ) : null}
      </div>

      {saveStatus ? (
        <p className="mt-4 text-sm text-slate-600">{saveStatus}</p>
      ) : null}
    </section>
  );
}
