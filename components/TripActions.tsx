"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  buildTripCalendarIcs,
  buildTripSummaryText,
  suggestedCalendarFileName,
} from "../lib/calendarExport";
import { preferredHotelBookingUrl } from "../lib/expediaLinks";
import { saveTripPlan } from "../lib/tripStore";
import { useViewerIdentity } from "../lib/viewerIdentity";
import { TripPlan } from "../lib/types";

type Props = {
  trip: TripPlan;
  shareMode?: boolean;
  onTripUpdated?: (trip: TripPlan) => void;
};

function InfoPill({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

function decisionLabel(status?: TripPlan["decisionStatus"]) {
  switch (status) {
    case "approved":
      return "Approved";
    case "booked":
      return "Booked";
    case "needs_changes":
      return "Needs changes";
    case "waiting_on_partner":
      return "Waiting on partner";
    default:
      return "Decision open";
  }
}

function workflowStepIndex(trip: TripPlan) {
  switch (trip.decisionStatus) {
    case "booked":
      return 4;
    case "approved":
      return 3;
    case "needs_changes":
    case "waiting_on_partner":
      return 2;
    default:
      return trip.status === "finalized" ? 2 : 1;
  }
}

export default function TripActions({
  trip,
  shareMode = false,
  onTripUpdated,
}: Props) {
  const router = useRouter();
  const viewer = useViewerIdentity();
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingChecklistKey, setUpdatingChecklistKey] = useState<string | null>(
    null
  );

  const canonicalShareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);

    if (trip.status === "finalized") {
      url.searchParams.set("view", "share");
    } else {
      url.searchParams.delete("view");
    }

    return url.toString();
  }, [trip.status]);

  async function handleSave() {
    try {
      setSaving(true);
      setSaveStatus("");

      const result = await saveTripPlan(trip);

      if (!result.success) {
        setSaveStatus("Save failed.");
        return;
      }

      onTripUpdated?.(trip);

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
      await navigator.clipboard.writeText(canonicalShareUrl || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function handleOpenShareView() {
    if (trip.status !== "finalized") return;

    if (shareMode) {
      router.push(`/trip/${trip.id}`);
      return;
    }

    router.push(`/trip/${trip.id}?view=share`);
  }

  function handleExportCalendar() {
    try {
      const ics = buildTripCalendarIcs(trip);
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestedCalendarFileName(trip);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSaveStatus("Calendar export downloaded.");
      void handleChecklistToggle("exportedCalendar", true);
    } catch (error) {
      console.error("Calendar export failed:", error);
      setSaveStatus("Calendar export failed.");
    }
  }

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(buildTripSummaryText(trip));
      setSummaryCopied(true);
      setSaveStatus("Trip summary copied.");
      void handleChecklistToggle("sharedItinerary", true);
      window.setTimeout(() => setSummaryCopied(false), 1600);
    } catch (error) {
      console.error("Trip summary copy failed:", error);
      setSummaryCopied(false);
      setSaveStatus("Trip summary copy failed.");
    }
  }

  const firstHotelSite = preferredHotelBookingUrl({
    hotel: trip.hotelOptions?.[0],
    destination: trip.destinationName || trip.name,
    tripStartDate: trip.tripStartDate,
    tripEndDate: trip.tripEndDate,
    travelerCount: trip.travelerCount,
  });
  const currentStep = workflowStepIndex(trip);
  const bookingChecklist = trip.bookingChecklist ?? {
    reservedStay: { done: false },
    exportedCalendar: { done: false },
    confirmedTravelers: { done: false },
    sharedItinerary: { done: false },
  };
  const checklistItems = [
    {
      key: "reservedStay" as const,
      label: "Reserve stay",
      detail: "Confirm the hotel or stay booking tied to this plan.",
    },
    {
      key: "exportedCalendar" as const,
      label: "Export calendar",
      detail: "Get the trip dates and timing into calendars.",
    },
    {
      key: "confirmedTravelers" as const,
      label: "Confirm travelers",
      detail: "Lock the final attendee list before departure.",
    },
    {
      key: "sharedItinerary" as const,
      label: "Share itinerary",
      detail: "Send the finalized plan or summary to the group.",
    },
  ];
  const completedChecklistCount = checklistItems.filter(
    (item) => bookingChecklist[item.key].done
  ).length;

  async function handleChecklistToggle(
    key: keyof typeof bookingChecklist,
    forcedValue?: boolean
  ) {
    try {
      setUpdatingChecklistKey(key);
      setSaveStatus("");

      const nextTrip: TripPlan = {
        ...trip,
        bookingChecklist: {
          ...bookingChecklist,
          [key]: {
            done: forcedValue ?? !bookingChecklist[key].done,
            updatedAt: new Date().toISOString(),
            updatedBy: viewer.displayName,
            visitorId: viewer.visitorId,
            userId: viewer.userId,
          },
        },
      };

      const result = await saveTripPlan(nextTrip);

      if (!result.success) {
        setSaveStatus("Checklist update failed.");
        return;
      }

      onTripUpdated?.(nextTrip);
      setSaveStatus("Checklist updated.");
    } catch (error) {
      console.error("Trip checklist update failed:", error);
      setSaveStatus("Checklist update failed.");
    } finally {
      setUpdatingChecklistKey(null);
    }
  }

  const primaryAction =
    trip.decisionStatus === "booked"
      ? {
          kind: "button" as const,
          label: "Copy booked summary",
          description: "Share the locked itinerary and keep logistics in one place.",
          onClick: handleCopySummary,
        }
      : trip.decisionStatus === "approved"
        ? firstHotelSite
          ? {
              kind: "link" as const,
              label: "Open booking flow",
              description: "The trip is approved, so push the group toward booking.",
              href: firstHotelSite,
            }
          : {
              kind: "button" as const,
              label: "Export calendar",
              description: "The trip is approved, so move it into calendars and logistics.",
              onClick: handleExportCalendar,
            }
        : trip.decisionStatus === "needs_changes"
          ? {
              kind: "button" as const,
              label: shareMode ? "Open planner view" : "Refine the plan",
              description: "The group wants changes, so go back to the editable planner.",
              onClick: handleOpenShareView,
            }
          : trip.decisionStatus === "waiting_on_partner" && trip.status === "finalized"
            ? {
                kind: "button" as const,
                label: "Copy share link",
                description: "The trip is waiting on feedback, so sharing is the main action.",
                onClick: handleCopyLink,
              }
            : {
                kind: "button" as const,
                label: shareMode ? "Save a copy" : "Save",
                description: "Keep a local copy of the current trip version.",
                onClick: handleSave,
              };

  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Actions
        </h2>
        <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
          {shareMode
            ? "Quick actions for this shared trip view."
            : "Quick actions for this saved plan."}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <InfoPill>{trip.status === "finalized" ? "Finalized plan" : "Draft plan"}</InfoPill>
        <InfoPill>{decisionLabel(trip.decisionStatus)}</InfoPill>
        <InfoPill>Saved locally</InfoPill>
        <InfoPill>Best on this device</InfoPill>
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
          Next step
        </div>
        <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
          {primaryAction.label}
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {primaryAction.description}
        </p>

        <div className="mt-4">
          {primaryAction.kind === "link" ? (
            <a
              href={primaryAction.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-violet-400 dark:text-slate-950 dark:hover:bg-violet-300"
            >
              {primaryAction.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void primaryAction.onClick()}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-violet-400 dark:text-slate-950 dark:hover:bg-violet-300"
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Trip progress
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Plan", "Share", "Approve", "Book"].map((label, index) => {
            const active = currentStep >= index + 1;

            return (
              <div
                key={label}
                className={
                  active
                    ? "min-w-[88px] flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-center text-xs font-semibold text-violet-700 dark:border-violet-500/30 dark:bg-slate-900 dark:text-violet-300"
                    : "min-w-[88px] flex-1 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                }
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>

      {(trip.decisionStatus === "approved" || trip.decisionStatus === "booked") ? (
        <div className="mt-4 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                Booking checklist
              </div>
              <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                {completedChecklistCount}/{checklistItems.length} complete
              </div>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              {trip.decisionStatus === "booked"
                ? "Keep the group aligned."
                : "Turn approval into logistics."}
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {checklistItems.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-white/80 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                    {item.label}
                  </div>
                  <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                    {item.detail}
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={bookingChecklist[item.key].done}
                  onChange={() => void handleChecklistToggle(item.key)}
                  disabled={updatingChecklistKey === item.key}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            {checklistItems
              .map((item) => bookingChecklist[item.key])
              .filter((item) => item.done && item.updatedBy)
              .sort((a, b) => `${b.updatedAt ?? ""}`.localeCompare(`${a.updatedAt ?? ""}`))[0]
              ?.updatedBy
              ? `Latest checklist update by ${
                  checklistItems
                    .map((item) => bookingChecklist[item.key])
                    .filter((item) => item.done && item.updatedBy)
                    .sort((a, b) => `${b.updatedAt ?? ""}`.localeCompare(`${a.updatedAt ?? ""}`))[0]
                    ?.updatedBy
                }.`
              : "Checklist updates will show who moved logistics forward."}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
        >
          {saving ? "Saving..." : shareMode ? "Save a copy" : "Save"}
        </button>

        {trip.status === "finalized" ? (
          <button
            type="button"
            onClick={handleOpenShareView}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {shareMode ? "Open planner view" : "Open share view"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={handleCopyLink}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {copied
            ? "Link copied"
            : trip.status === "finalized"
              ? "Copy share link"
              : "Copy page link"}
        </button>

        <button
          type="button"
          onClick={handleExportCalendar}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Export calendar
        </button>

        <button
          type="button"
          onClick={handleCopySummary}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {summaryCopied ? "Summary copied" : "Copy trip summary"}
        </button>

        {firstHotelSite ? (
          <a
            href={firstHotelSite}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Open lodging link
          </a>
        ) : null}
      </div>

      {saveStatus ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{saveStatus}</p>
      ) : null}
    </section>
  );
}
