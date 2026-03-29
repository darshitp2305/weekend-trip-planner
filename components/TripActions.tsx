"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  buildTripCalendarIcs,
  buildTripSummaryText,
  suggestedCalendarFileName,
} from "../lib/calendarExport";
import { preferredHotelBookingUrl } from "../lib/expediaLinks";
import { baseTripAnalytics, trackProductEvent } from "../lib/productAnalytics";
import {
  buildTripDepartureBrief,
  getTripBudgetStatus,
  getTripDeparturePlanCompletion,
  getTripCountdownDays,
  getTripNextDeadline,
  getTripReadinessBlockers,
  getTripReadinessSummary,
} from "../lib/tripOperations";
import {
  getTripFollowUpRecord,
  getTripFollowUpStatus,
  markTripFollowUpCopied,
  markTripFollowUpOpened,
  reopenTripFollowUp,
  resolveTripFollowUp,
  snoozeTripFollowUp,
  TRIP_FOLLOW_UP_UPDATED_EVENT,
  TripFollowUpRecord,
} from "../lib/tripFollowUpState";
import { saveTripPlan, type SaveTripPlanResult } from "../lib/tripStore";
import {
  buildTripReminderMessage,
  daysSinceIso,
  getBookingChecklistProgress,
  getTripFollowUpAction,
  getTripMomentumSummary,
  getTripReminderVariants,
  getTripResponseCount,
  getTripStaleness,
  getTripUrgencyLevel,
  TripReminderVariantId,
} from "../lib/tripMomentum";
import { useViewerIdentity } from "../lib/viewerIdentity";
import { TripPlan } from "../lib/types";

type Props = {
  trip: TripPlan;
  shareMode?: boolean;
  onTripUpdated?: (trip: TripPlan, result: SaveTripPlanResult) => void;
  isOwner?: boolean;
  syncState?: {
    phase: "idle" | "saving" | "saved" | "local_only" | "error";
    message: string;
    lastSavedAt?: string;
  };
};

type SecondaryAction =
  | {
      id: string;
      kind: "button";
      label: string;
      onClick: () => void | Promise<void>;
      disabled?: boolean;
      tone?: "primary" | "secondary";
    }
  | {
      id: string;
      kind: "link";
      label: string;
      href: string;
      tone?: "primary" | "secondary";
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

function formatShortDateTime(value?: string) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

function actionRailNudge(trip: TripPlan) {
  const decisionStatus = trip.decisionStatus ?? "waiting_on_partner";
  const checklistProgress = getBookingChecklistProgress(trip);
  const responseCount = getTripResponseCount(trip);

  if (trip.status !== "finalized") {
    return {
      title: "Finalize before you share",
      detail:
        "This plan is still editable. Finalize it once the hotel and stops are close enough to send around.",
      tone:
        "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
    };
  }

  if (decisionStatus === "waiting_on_partner") {
    return {
      title: responseCount > 0 ? "You still need a final decision" : "Share this trip now",
      detail:
        responseCount > 0
          ? `${responseCount} people have reacted or commented, but nobody has pushed this to approved or needs changes yet.`
          : "The trip is finalized but still waiting on the first partner response.",
      tone:
        "border-[#b2f6df] bg-[#effff8] text-[#0c5a44] dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10 dark:text-[#d7fcef]",
    };
  }

  if (decisionStatus === "needs_changes") {
    return {
      title: "Feedback says revise the plan",
      detail:
        "The group flagged issues. Switch back into planner mode and tighten the itinerary before asking for approval again.",
      tone:
        "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100",
    };
  }

  if (decisionStatus === "approved") {
    return {
      title: "This is the conversion moment",
      detail:
        "The plan is approved. Open booking, export the calendar, and move the group into logistics while momentum is high.",
      tone:
        "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
    };
  }

  if (
    decisionStatus === "booked" &&
    checklistProgress.completed < checklistProgress.total
  ) {
    return {
      title: "Booked does not mean finished",
      detail: `${checklistProgress.completed}/${checklistProgress.total} logistics tasks are done. Close out the checklist so the trip stays coordinated.`,
      tone:
        "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
    };
  }

  return {
    title: "Trip is in a healthy state",
    detail:
      "Use the remaining actions below for logistics, sharing, or minor cleanup.",
    tone:
      "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100",
  };
}

export default function TripActions({
  trip,
  shareMode = false,
  onTripUpdated,
  isOwner = false,
  syncState,
}: Props) {
  const router = useRouter();
  const viewer = useViewerIdentity();
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [reminderCopied, setReminderCopied] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [updatingChecklistKey, setUpdatingChecklistKey] = useState<string | null>(
    null
  );
  const [followUpRecord, setFollowUpRecord] = useState<TripFollowUpRecord | null>(null);

  useEffect(() => {
    const loadFollowUpRecord = () => setFollowUpRecord(getTripFollowUpRecord(trip.id));

    loadFollowUpRecord();

    if (typeof window === "undefined") return;

    window.addEventListener(TRIP_FOLLOW_UP_UPDATED_EVENT, loadFollowUpRecord);
    window.addEventListener("storage", loadFollowUpRecord);

    return () => {
      window.removeEventListener(TRIP_FOLLOW_UP_UPDATED_EVENT, loadFollowUpRecord);
      window.removeEventListener("storage", loadFollowUpRecord);
    };
  }, [trip.id]);

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

      trackProductEvent("trip_saved", {
        ...baseTripAnalytics(trip),
        metadata: {
          accountSaved: result.accountSaved,
          shareMode,
          isOwner,
        },
      });

      onTripUpdated?.(result.trip ?? trip, result);
      setSaveStatus(saveStatusLabel(result));
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
      setSaveStatus(trip.status === "finalized" ? "Share link copied." : "Page link copied.");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setSaveStatus("Link copy failed.");
    }
  }

  function handleOpenShareView() {
    if (trip.status !== "finalized") return;

    if (shareMode) {
      router.push(`/trip/${trip.id}`);
      return;
    }

    trackProductEvent("trip_share_opened", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: "owner_navigation",
        isOwner,
      },
    });

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

  async function handleCopyReminder(variantId: TripReminderVariantId = "direct") {
    try {
      reopenTripFollowUp(trip.id);
      await navigator.clipboard.writeText(buildTripReminderMessage(trip, variantId));
      const nextRecord = markTripFollowUpCopied(trip.id);
      setFollowUpRecord(nextRecord);
      setReminderCopied(true);
      setSaveStatus(
        variantId === "gentle"
          ? "Softer follow-up copied."
          : "Follow-up message copied."
      );
      trackProductEvent("trip_follow_up_copied", {
        ...baseTripAnalytics(trip),
        metadata: {
          source: "trip_actions",
          variantId,
        },
      });
      window.setTimeout(() => setReminderCopied(false), 1600);
    } catch (error) {
      console.error("Trip follow-up copy failed:", error);
      setReminderCopied(false);
      setSaveStatus("Follow-up message copy failed.");
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
  const nudge = actionRailNudge(trip);
  const staleNudge = getTripStaleness(trip)?.detail ?? null;
  const momentumSummary = getTripMomentumSummary(trip);
  const reminderVariants = getTripReminderVariants(trip);
  const followUpAction = getTripFollowUpAction(trip);
  const followUpStatus = getTripFollowUpStatus(trip, followUpRecord);
  const followUpUrgency = getTripUrgencyLevel(trip);
  const readiness = getTripReadinessSummary(trip);
  const countdownDays = getTripCountdownDays(trip);
  const nextDeadline = getTripNextDeadline(trip);
  const readinessBlockers = getTripReadinessBlockers(trip);
  const budgetStatus = getTripBudgetStatus(trip);
  const departurePlanCompletion = getTripDeparturePlanCompletion(trip);
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
  const referenceAgeDays =
    daysSinceIso(trip.decisionUpdatedAt ?? trip.finalizedAt ?? trip.createdAt) ?? 0;
  const suggestedSnoozeDays = followUpAction?.suggestedSnoozeDays ?? 2;

  function saveStatusLabel(result: SaveTripPlanResult) {
    if (result.accountSaved) {
      return "Saved to your account.";
    }

    if (result.remoteSaved) {
      return "Saved to the shared trip.";
    }

    return "Saved locally. Remote sync is still pending.";
  }

  async function handleSnoozeFollowUp() {
    const nextRecord = snoozeTripFollowUp(trip.id, suggestedSnoozeDays);
    setFollowUpRecord(nextRecord);
    setSaveStatus(
      `Reminder paused for ${suggestedSnoozeDays} day${suggestedSnoozeDays === 1 ? "" : "s"}.`
    );
    trackProductEvent("trip_follow_up_snoozed", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: "trip_actions",
        days: suggestedSnoozeDays,
      },
    });
  }

  async function handleResolveFollowUp() {
    const nextRecord = resolveTripFollowUp(trip);
    setFollowUpRecord(nextRecord);
    setSaveStatus("Follow-up hidden for the current trip state.");
    trackProductEvent("trip_follow_up_resolved", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: "trip_actions",
      },
    });
  }

  async function handleCopyDepartureBrief() {
    try {
      await navigator.clipboard.writeText(buildTripDepartureBrief(trip));
      setBriefCopied(true);
      setSaveStatus("Departure brief copied.");
      trackProductEvent("trip_departure_brief_copied", {
        ...baseTripAnalytics(trip),
        metadata: {
          source: "trip_actions",
        },
      });
      window.setTimeout(() => setBriefCopied(false), 1600);
    } catch (error) {
      console.error("Departure brief copy failed:", error);
      setBriefCopied(false);
      setSaveStatus("Departure brief copy failed.");
    }
  }

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

      onTripUpdated?.(result.trip ?? nextTrip, result);
      setSaveStatus(
        result.remoteSaved
          ? "Checklist updated."
          : "Checklist updated locally. Remote sync pending."
      );
    } catch (error) {
      console.error("Trip checklist update failed:", error);
      setSaveStatus("Checklist update failed.");
    } finally {
      setUpdatingChecklistKey(null);
    }
  }

  async function handleBookingLaunch(href: string) {
    try {
      setSaveStatus("");

      const nextTrip: TripPlan = {
        ...trip,
        decisionStatus: "booked",
        decisionUpdatedAt: new Date().toISOString(),
        decisionUpdatedBy: viewer.displayName,
        bookingChecklist: {
          ...bookingChecklist,
          reservedStay: {
            done: true,
            updatedAt: new Date().toISOString(),
            updatedBy: viewer.displayName,
            visitorId: viewer.visitorId,
            userId: viewer.userId,
          },
        },
      };

      const result = await saveTripPlan(nextTrip);

      if (!result.success) {
        setSaveStatus("Booking flow launch failed.");
        return;
      }

      onTripUpdated?.(result.trip ?? nextTrip, result);
      trackProductEvent("trip_booked", {
        ...baseTripAnalytics(result.trip ?? nextTrip),
        metadata: {
          source: "trip_actions",
          bookingUrl: href,
        },
      });
      setSaveStatus(
        result.remoteSaved
          ? "Booking flow opened and trip marked booked."
          : "Booking flow opened. Trip changes are only saved locally for now."
      );
      window.open(href, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Booking flow launch failed:", error);
      setSaveStatus("Booking flow launch failed.");
    }
  }

  const primaryAction =
    trip.decisionStatus === "booked"
      ? {
          id: "copy-summary",
          kind: "button" as const,
          label: "Copy booked summary",
          description: "Share the locked itinerary and keep logistics in one place.",
          onClick: handleCopySummary,
        }
      : trip.decisionStatus === "approved"
        ? firstHotelSite
          ? {
              id: "open-booking-flow",
              kind: "button" as const,
              label: "Open booking flow",
              description: "The trip is approved, so push the group toward booking.",
              onClick: () => handleBookingLaunch(firstHotelSite),
            }
          : {
              id: "export-calendar",
              kind: "button" as const,
              label: "Export calendar",
              description: "The trip is approved, so move it into calendars and logistics.",
              onClick: handleExportCalendar,
            }
      : trip.decisionStatus === "needs_changes"
          ? {
              id: "open-planner-view",
              kind: "button" as const,
              label: isOwner
                ? shareMode
                  ? "Open planner view"
                  : "Refine the plan"
                : "Copy share link",
              description: isOwner
                ? "The group wants changes, so go back to the editable planner."
                : "The owner needs to revise this plan, so send them back to the planner with the share link.",
              onClick: isOwner ? handleOpenShareView : handleCopyLink,
            }
          : trip.decisionStatus === "waiting_on_partner" && trip.status === "finalized"
            ? {
                id: "copy-share-link",
                kind: "button" as const,
                label: copied ? "Share link copied" : "Copy share link",
                description: "The trip is waiting on feedback, so sharing is the main action.",
                onClick: handleCopyLink,
              }
            : {
                id: "save",
                kind: "button" as const,
                label: shareMode ? "Save a copy" : "Save",
                description: "Keep a local copy of the current trip version.",
                onClick: handleSave,
              };

  const secondaryActions: SecondaryAction[] = [
    ...(isOwner
      ? [{
          id: "save",
          kind: "button" as const,
          label: shareMode ? "Save a copy" : "Save",
          onClick: handleSave,
          disabled: saving,
          tone: "primary" as const,
        }]
      : [{
          id: "save-copy",
          kind: "button" as const,
          label: "Save a copy",
          onClick: handleSave,
          disabled: saving,
          tone: "primary" as const,
        }]),
    ...(trip.status === "finalized" && isOwner
      ? [
          {
            id: "open-share-view",
            kind: "button" as const,
            label: shareMode ? "Open planner view" : "Open share view",
            onClick: handleOpenShareView,
          },
        ]
      : []),
    {
      id: trip.status === "finalized" ? "copy-share-link" : "copy-page-link",
      kind: "button" as const,
      label: copied
        ? "Link copied"
        : trip.status === "finalized"
          ? "Copy share link"
          : "Copy page link",
      onClick: handleCopyLink,
    },
    {
      id: "export-calendar",
      kind: "button" as const,
      label: "Export calendar",
      onClick: handleExportCalendar,
    },
    {
      id: "copy-summary",
      kind: "button" as const,
      label: summaryCopied ? "Summary copied" : "Copy trip summary",
      onClick: handleCopySummary,
    },
  ].filter((action) => action.id !== primaryAction.id);

  const isDraftPlanner = !shareMode && trip.status !== "finalized";
  const isShareFirstOwnerState =
    !shareMode &&
    trip.status === "finalized" &&
    (trip.decisionStatus ?? "waiting_on_partner") === "waiting_on_partner";
  const isPartnerShareScreen = shareMode;

  if (isDraftPlanner) {
    return (
      <section>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Planner actions
          </h2>
          <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
            Keep the draft safe, then finalize once the itinerary feels right.
          </p>
        </div>

        {syncState ? (
          <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Sync status
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {syncState.message}
            </div>
            {syncState.lastSavedAt ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Last saved at {syncState.lastSavedAt}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-[1.25rem] border border-[#b2f6df] bg-[#effff8] p-4 dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#048f69] dark:text-[#7decc7]">
            Next step
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            Finalize when the stay and day flow feel locked
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
            Draft mode stays focused on itinerary edits. Sharing, approvals, and operations will appear after finalization.
          </p>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Core actions
          </div>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
            >
              {saving ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {copied ? "Link copied" : "Copy page link"}
            </button>
          </div>
        </div>

        {saveStatus ? (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{saveStatus}</p>
        ) : null}
      </section>
    );
  }

  if (isShareFirstOwnerState) {
    return (
      <section>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Share and wait for feedback
          </h2>
          <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
            The trip is finalized. The only thing that matters right now is sending it out and getting a response.
          </p>
        </div>

        {syncState ? (
          <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Sync status
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {syncState.message}
            </div>
            {syncState.lastSavedAt ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Last saved at {syncState.lastSavedAt}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-[1.25rem] border border-[#b2f6df] bg-[#effff8] p-4 dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#048f69] dark:text-[#7decc7]">
            Next step
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            Copy the share link and send it
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
            After that, wait for reactions or approval. Logistics and booking can come later.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
            >
              {copied ? "Share link copied" : "Copy share link"}
            </button>
            <button
              type="button"
              onClick={handleOpenShareView}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Open share view
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            What happens now
          </div>
          <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <p>1. Send the finalized link to your group.</p>
            <p>2. Wait for reactions, comments, or approval.</p>
            <p>3. Once the trip is approved, booking and operations will appear.</p>
          </div>
        </div>

        {saveStatus ? (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{saveStatus}</p>
        ) : null}
      </section>
    );
  }

  if (isPartnerShareScreen) {
    return null;
  }

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
        <InfoPill>{isOwner && trip.ownerUserId ? "Synced owner view" : "Viewer or local copy"}</InfoPill>
        <InfoPill>{isOwner ? "Account-backed when available" : "Read-only share mode"}</InfoPill>
        {syncState ? (
          <InfoPill>
            {syncState.phase === "saving"
              ? "Saving changes"
              : syncState.phase === "saved"
                ? "All changes saved"
                : syncState.phase === "local_only"
                  ? "Local backup only"
                  : syncState.phase === "error"
                    ? "Save needs attention"
                    : "Edit status idle"}
          </InfoPill>
        ) : null}
      </div>

      {syncState ? (
        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Sync status
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {syncState.message}
          </div>
          {syncState.lastSavedAt ? (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Last saved at {syncState.lastSavedAt}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-[1.25rem] border border-[#b2f6df] bg-[#effff8] p-4 dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#048f69] dark:text-[#7decc7]">
          Next step
        </div>
        <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
          {primaryAction.label}
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {primaryAction.description}
        </p>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => void primaryAction.onClick()}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-[#3be0ab] dark:text-slate-950 dark:hover:bg-[#7decc7]"
          >
            {primaryAction.label}
          </button>
        </div>
      </div>

      <div className={`mt-4 rounded-[1.25rem] border p-4 ${nudge.tone}`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">
          Attention
        </div>
        <div className="mt-1 text-base font-semibold">{nudge.title}</div>
        <p className="mt-1 text-sm leading-6">
          {nudge.detail}
        </p>
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {trip.status === "finalized" ? "Follow-up kit" : "Planning status"}
        </div>
        <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
          {momentumSummary.label}
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {trip.status !== "finalized"
            ? "This trip is still in planning. Keep refining it before you share it or start follow-ups."
            : followUpStatus.resolved
              ? "You hid follow-up for the current trip state. It will reopen automatically if the trip changes."
              : followUpStatus.snoozed
                ? `Follow-up is paused until ${formatShortDateTime(followUpStatus.snoozedUntil) ?? "later"}.`
                : referenceAgeDays > 0
                  ? `This trip has been in its current state for ${referenceAgeDays} day${referenceAgeDays === 1 ? "" : "s"}.`
                  : "This trip was updated recently."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <InfoPill>{momentumSummary.responses} responses</InfoPill>
          <InfoPill>
            {momentumSummary.checklistProgress.completed}/
            {momentumSummary.checklistProgress.total} checklist done
          </InfoPill>
          {momentumSummary.stale ? <InfoPill>Needs follow-up</InfoPill> : null}
          <InfoPill>
            {followUpUrgency === "urgent"
              ? "Urgency: high"
              : followUpUrgency === "watch"
                ? "Urgency: medium"
                : "Urgency: low"}
          </InfoPill>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {trip.status === "finalized" ? (
            <>
              <button
                type="button"
                onClick={() => void handleCopyReminder("direct")}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {reminderCopied ? "Reminder copied" : "Copy reminder"}
              </button>
              {reminderVariants.some((variant) => variant.id === "gentle") ? (
                <button
                  type="button"
                  onClick={() => void handleCopyReminder("gentle")}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Copy softer message
                </button>
              ) : null}
            </>
          ) : null}
          {followUpAction ? (
            <button
              type="button"
              onClick={() => {
                reopenTripFollowUp(trip.id);
                const nextRecord = markTripFollowUpOpened(trip.id);
                setFollowUpRecord(nextRecord);
                trackProductEvent("trip_follow_up_opened", {
                  ...baseTripAnalytics(trip),
                  metadata: {
                    source: "trip_actions",
                    target: followUpAction.target,
                  },
                });
                if (trip.decisionStatus === "approved" && firstHotelSite) {
                  void handleBookingLaunch(firstHotelSite);
                  return;
                }
                if (trip.status === "finalized" && followUpAction.target === "share") {
                  handleOpenShareView();
                  return;
                }
                router.push(followUpAction.href);
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
            >
              {trip.decisionStatus === "approved" && firstHotelSite
                ? "Open booking flow"
                : followUpAction.label}
            </button>
          ) : null}
          {trip.status === "finalized" ? (
            <>
              <button
                type="button"
                onClick={() => void handleSnoozeFollowUp()}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Remind me in {suggestedSnoozeDays} day{suggestedSnoozeDays === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => void handleResolveFollowUp()}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {followUpStatus.resolved ? "Hidden for now" : "Hide for now"}
              </button>
            </>
          ) : null}
        </div>
        {trip.status === "finalized" && (followUpRecord?.lastCopiedAt || followUpRecord?.lastOpenedAt) ? (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {followUpRecord.lastCopiedAt
              ? `Last copied ${formatShortDateTime(followUpRecord.lastCopiedAt) ?? "recently"}`
              : "No reminder copied yet"}
            {followUpRecord.lastOpenedAt
              ? ` | Last opened ${formatShortDateTime(followUpRecord.lastOpenedAt) ?? "recently"}`
              : ""}
          </p>
        ) : null}
      </div>

      {staleNudge ? (
        <div className="mt-4 rounded-[1.25rem] border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            Stale warning
          </div>
          <p className="mt-1 text-sm leading-6">
            {staleNudge}
          </p>
        </div>
      ) : null}

      {(trip.decisionStatus === "approved" || trip.decisionStatus === "booked") ? (
        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Operations snapshot
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {readiness.label} ({readiness.score}%)
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {countdownDays === null
              ? "Trip start date is still open."
              : countdownDays < 0
                ? "Departure date has already passed."
                : countdownDays === 0
                  ? "Departure day is here."
                  : `${countdownDays} day${countdownDays === 1 ? "" : "s"} until departure.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <InfoPill>
              Travelers {readiness.travelerSummary.confirmed}/{readiness.travelerSummary.total}
            </InfoPill>
            <InfoPill>
              Tasks {readiness.taskSummary.completed}/{readiness.taskSummary.total}
            </InfoPill>
            <InfoPill>Ops notes {readiness.noteCount}</InfoPill>
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void handleCopyDepartureBrief()}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {briefCopied ? "Departure brief copied" : "Copy departure brief"}
            </button>
          </div>
        </div>
      ) : null}

      {(trip.decisionStatus === "approved" || trip.decisionStatus === "booked") ? (
        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Ops intelligence
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {budgetStatus.label}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {budgetStatus.detail}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <InfoPill>
              Departure plan {departurePlanCompletion.completed}/{departurePlanCompletion.total}
            </InfoPill>
            <InfoPill>
              Payments {readiness.paymentsSettled ? "settled" : "open"}
            </InfoPill>
            {nextDeadline ? (
              <InfoPill>
                {nextDeadline.isOverdue
                  ? "Deadline overdue"
                  : nextDeadline.isToday
                    ? "Deadline today"
                    : `Next deadline in ${nextDeadline.deltaDays}d`}
              </InfoPill>
            ) : null}
          </div>
          {readinessBlockers.length > 0 ? (
            <div className="mt-4 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Biggest blockers
              </div>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {readinessBlockers.slice(0, 3).map((blocker) => (
                  <li key={blocker}>- {blocker}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4 rounded-[1rem] border border-white bg-white p-4 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              No major operations blockers right now.
            </div>
          )}
        </div>
      ) : null}

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
                    ? "min-w-[88px] flex-1 rounded-xl border border-[#b2f6df] bg-white px-3 py-2 text-center text-xs font-semibold text-[#048f69] dark:border-[#06d8a0]/30 dark:bg-slate-900 dark:text-[#7decc7]"
                    : "min-w-[88px] flex-1 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                }
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>

      {isOwner && (trip.decisionStatus === "approved" || trip.decisionStatus === "booked") ? (
        <div className="mt-4 rounded-[1.25rem] border border-[#b2f6df] bg-[#effff8] p-4 dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#048f69] dark:text-[#7decc7]">
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
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#04b887] focus:ring-[#06d8a0]"
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

      {secondaryActions.length > 0 ? (
        <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            More actions
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {secondaryActions.map((action) =>
              action.kind === "link" ? (
                <a
                  key={action.id}
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {action.label}
                </a>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => void action.onClick()}
                  disabled={action.disabled}
                  className={
                    action.tone === "primary"
                      ? "inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
                      : "inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  }
                >
                  {action.label}
                </button>
              )
            )}
          </div>
        </div>
      ) : null}

      {saveStatus ? (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{saveStatus}</p>
      ) : null}
    </section>
  );
}
