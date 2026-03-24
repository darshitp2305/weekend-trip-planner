"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preferredHotelBookingUrl } from "../lib/expediaLinks";
import { baseTripAnalytics, trackProductEvent } from "../lib/productAnalytics";
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
  getTripFollowUpAction,
  getTripReminderVariants,
  getTripUrgencyLevel,
  TripReminderVariantId,
} from "../lib/tripMomentum";
import { useViewerIdentity } from "../lib/viewerIdentity";
import {
  TripCommentEntry,
  TripDecisionStatus,
  TripFeedbackReaction,
  TripPlan,
  TripReactionEntry,
} from "../lib/types";

type Props = {
  trip: TripPlan;
  onTripUpdated: (trip: TripPlan, result: SaveTripPlanResult) => void;
  isOwner?: boolean;
  shareMode?: boolean;
};

function formatDateTime(value?: string) {
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

function reactionLabel(value: TripFeedbackReaction) {
  switch (value) {
    case "love":
      return "Love it";
    case "maybe":
      return "Maybe";
    case "pass":
      return "Pass";
    default:
      return value;
  }
}

function decisionLabel(value: TripDecisionStatus) {
  switch (value) {
    case "waiting_on_partner":
      return "Waiting on partner";
    case "needs_changes":
      return "Needs changes";
    case "approved":
      return "Approved";
    case "booked":
      return "Booked";
    default:
      return value;
  }
}

export default function TripFeedbackPanel({
  trip,
  onTripUpdated,
  isOwner = false,
  shareMode = false,
}: Props) {
  const [author, setAuthor] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [savingReaction, setSavingReaction] = useState<TripFeedbackReaction | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [followUpRecord, setFollowUpRecord] = useState<TripFollowUpRecord | null>(null);
  const commentFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const viewer = useViewerIdentity();

  useEffect(() => {
    if (!author.trim() && viewer.email) {
      setAuthor(viewer.displayName);
    }
  }, [author, viewer.displayName, viewer.email]);

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

  const reactions = useMemo(() => trip.reactions ?? [], [trip.reactions]);
  const comments = useMemo(() => trip.comments ?? [], [trip.comments]);

  const reactionCounts = useMemo(() => {
    return reactions.reduce(
      (counts, reaction) => {
        counts[reaction.reaction] += 1;
        return counts;
      },
      { love: 0, maybe: 0, pass: 0 } as Record<TripFeedbackReaction, number>
    );
  }, [reactions]);
  const responseCount = useMemo(() => {
    return new Set([
      ...reactions.map((reaction) => reaction.visitorId),
      ...comments.map((comment) => comment.visitorId),
    ]).size;
  }, [comments, reactions]);

  const currentReaction = useMemo(() => {
    if (!viewer.visitorId) return null;
    return (
      reactions.find((reaction) => reaction.visitorId === viewer.visitorId)?.reaction ??
      null
    );
  }, [reactions, viewer.visitorId]);
  const currentDecisionStatus = trip.decisionStatus ?? "waiting_on_partner";
  const reminderVariants = useMemo(() => getTripReminderVariants(trip), [trip]);
  const followUpAction = useMemo(() => getTripFollowUpAction(trip), [trip]);
  const followUpStatus = useMemo(
    () => getTripFollowUpStatus(trip, followUpRecord),
    [followUpRecord, trip]
  );
  const followUpUrgency = useMemo(() => getTripUrgencyLevel(trip), [trip]);
  const bookingUrl = preferredHotelBookingUrl({
    hotel:
      trip.hotelOptions.find(
        (hotel) => hotel.name === trip.savedSelectionState?.hotelName
      ) ?? trip.hotelOptions[0],
    destination: trip.destinationName || trip.name,
    tripStartDate: trip.tripStartDate,
    tripEndDate: trip.tripEndDate,
    travelerCount: trip.travelerCount,
  });

  function heroCopy() {
    switch (currentDecisionStatus) {
      case "approved":
        return "The trip is approved. If the group is aligned, push this into booking.";
      case "booked":
        return "This trip is booked. Use comments only for logistics updates or last-mile coordination.";
      case "needs_changes":
        return "Someone flagged issues with the plan. Leave a note and send the owner back to planner mode to revise it.";
      case "waiting_on_partner":
      default:
        return "Choose approve if you are good to book. Choose needs changes if something still has to change first.";
    }
  }

  function nextStepLabel() {
    switch (currentDecisionStatus) {
      case "approved":
        return bookingUrl ? "Ready to book" : "Approved by the group";
      case "booked":
        return "Trip booked";
      case "needs_changes":
        return "Waiting on revisions";
      case "waiting_on_partner":
      default:
        return "Waiting on responses";
    }
  }

  async function persistTrip(nextTrip: TripPlan) {
    const result = await saveTripPlan(nextTrip);

    if (!result.success) {
      throw new Error("Trip feedback save failed.");
    }

    onTripUpdated(result.trip ?? nextTrip, result);
    return result;
  }

  async function handleReaction(nextReaction: TripFeedbackReaction) {
    if (!viewer.visitorId) return;

    try {
      setSavingReaction(nextReaction);
      setStatus("");

      const nextReactions: TripReactionEntry[] = [
        ...(reactions.filter((reaction) => reaction.visitorId !== viewer.visitorId)),
        {
          id: crypto.randomUUID(),
          visitorId: viewer.visitorId,
          userId: viewer.userId,
          author: author.trim() || viewer.displayName,
          reaction: nextReaction,
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await persistTrip({
        ...trip,
        reactions: nextReactions,
      });

      setStatus(
        result.remoteSaved
          ? "Reaction saved."
          : "Reaction saved locally. Remote sync pending."
      );
    } catch (error) {
      console.error("Failed to save trip reaction:", error);
      setStatus("Reaction save failed.");
    } finally {
      setSavingReaction(null);
    }
  }

  async function handleAddComment() {
    const trimmedMessage = message.trim();
    if (!viewer.visitorId || !trimmedMessage) return;

    try {
      setSavingComment(true);
      setStatus("");

      const nextComments: TripCommentEntry[] = [
        ...comments,
        {
          id: crypto.randomUUID(),
          visitorId: viewer.visitorId,
          userId: viewer.userId,
          author: author.trim() || viewer.displayName,
          message: trimmedMessage,
          createdAt: new Date().toISOString(),
        },
      ];

      const result = await persistTrip({
        ...trip,
        comments: nextComments,
      });

      setMessage("");
      setStatus(
        result.remoteSaved
          ? "Comment added."
          : "Comment added locally. Remote sync pending."
      );
    } catch (error) {
      console.error("Failed to save trip comment:", error);
      setStatus("Comment save failed.");
    } finally {
      setSavingComment(false);
    }
  }

  async function handleDecisionStatus(nextStatus: TripDecisionStatus) {
    try {
      setStatus("");

      const result = await persistTrip({
        ...trip,
        decisionStatus: nextStatus,
        decisionUpdatedAt: new Date().toISOString(),
        decisionUpdatedBy: author.trim() || viewer.displayName,
      });

      if (nextStatus === "approved") {
        trackProductEvent("trip_approved", {
          ...baseTripAnalytics({
            ...trip,
            decisionStatus: nextStatus,
          }),
          metadata: {
            source: "feedback_panel",
            isOwner,
          },
        });
      }

      setStatus(
        result.remoteSaved
          ? `Decision updated to ${decisionLabel(nextStatus)}.`
          : `Decision updated locally to ${decisionLabel(nextStatus)}. Remote sync pending.`
      );
    } catch (error) {
      console.error("Failed to save trip decision:", error);
      setStatus("Decision update failed.");
    }
  }

  async function handleStartBooking() {
    if (!bookingUrl) return;

    try {
      setStatus("");

      const nextTrip: TripPlan = {
        ...trip,
        decisionStatus: "booked",
        decisionUpdatedAt: new Date().toISOString(),
        decisionUpdatedBy: author.trim() || viewer.displayName,
        bookingChecklist: {
          ...(trip.bookingChecklist ?? {
            reservedStay: { done: false },
            exportedCalendar: { done: false },
            confirmedTravelers: { done: false },
            sharedItinerary: { done: false },
          }),
          reservedStay: {
            done: true,
            updatedAt: new Date().toISOString(),
            updatedBy: author.trim() || viewer.displayName,
            visitorId: viewer.visitorId,
            userId: viewer.userId,
          },
        },
      };

      const result = await persistTrip(nextTrip);
      trackProductEvent("trip_booked", {
        ...baseTripAnalytics(nextTrip),
        metadata: {
          source: "feedback_panel",
          bookingUrl,
        },
      });
      setStatus(
        result.remoteSaved
          ? "Booking flow opened and trip marked booked."
          : "Booking flow opened. Trip changes are only saved locally for now."
      );
      window.open(bookingUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Failed to start booking flow:", error);
      setStatus("Booking flow launch failed.");
    }
  }

  async function handleCopyFollowUp(variantId: TripReminderVariantId = "direct") {
    try {
      reopenTripFollowUp(trip.id);
      await navigator.clipboard.writeText(buildTripReminderMessage(trip, variantId));
      const nextRecord = markTripFollowUpCopied(trip.id);
      setFollowUpRecord(nextRecord);
      setStatus(
        variantId === "gentle"
          ? "Softer follow-up copied."
          : "Follow-up message copied."
      );
      trackProductEvent("trip_follow_up_copied", {
        ...baseTripAnalytics(trip),
        metadata: {
          source: "feedback_panel",
          variantId,
        },
      });
    } catch (error) {
      console.error("Failed to copy follow-up:", error);
      setStatus("Follow-up copy failed.");
    }
  }

  function handleOpenFollowUpAction() {
    if (!followUpAction) return;

    reopenTripFollowUp(trip.id);
    const nextRecord = markTripFollowUpOpened(trip.id);
    setFollowUpRecord(nextRecord);
    trackProductEvent("trip_follow_up_opened", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: "feedback_panel",
        target: followUpAction.target,
      },
    });

    if (followUpAction.target === "booking" && bookingUrl) {
      window.open(bookingUrl, "_blank", "noopener,noreferrer");
      return;
    }

    window.location.assign(followUpAction.href);
  }

  function handleSnoozeFollowUp() {
    const days = followUpAction?.suggestedSnoozeDays ?? 2;
    const nextRecord = snoozeTripFollowUp(trip.id, days);
    setFollowUpRecord(nextRecord);
    setStatus(`Reminder paused for ${days} day${days === 1 ? "" : "s"}.`);
    trackProductEvent("trip_follow_up_snoozed", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: "feedback_panel",
        days,
      },
    });
  }

  function handleResolveFollowUp() {
    const nextRecord = resolveTripFollowUp(trip);
    setFollowUpRecord(nextRecord);
    setStatus("Follow-up hidden for the current trip state.");
    trackProductEvent("trip_follow_up_resolved", {
      ...baseTripAnalytics(trip),
      metadata: {
        source: "feedback_panel",
      },
    });
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
          Decision
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Do you approve this trip?
        </h2>
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {heroCopy()}
        </p>
        {trip.decisionUpdatedBy ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Last decision update by {trip.decisionUpdatedBy}
            {trip.decisionUpdatedAt
              ? ` on ${formatDateTime(trip.decisionUpdatedAt) ?? "recently"}`
              : ""}
            .
          </p>
          ) : null}
      </div>

      <div className="mt-5 rounded-[1.25rem] border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
              Next step
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
              {nextStepLabel()}
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {currentDecisionStatus === "approved"
                ? "If this looks right, move the group into booking and logistics."
                : currentDecisionStatus === "needs_changes"
                  ? "Leave a note explaining what should change before this trip gets approved."
                  : currentDecisionStatus === "booked"
                    ? "The decision is done. Keep using this page as the shared reference."
                    : "Give a clear yes or no so the owner knows whether to revise the trip or move forward."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleDecisionStatus("approved")}
              className={
                currentDecisionStatus === "approved"
                  ? "inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-violet-400 dark:text-slate-950 dark:hover:bg-violet-300"
                  : "inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
              }
            >
              Approve trip
            </button>
            <button
              type="button"
              onClick={() => void handleDecisionStatus("needs_changes")}
              className={
                currentDecisionStatus === "needs_changes"
                  ? "inline-flex h-11 items-center justify-center rounded-2xl border border-slate-950 bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:border-violet-400 dark:bg-violet-400 dark:text-slate-950 dark:hover:bg-violet-300"
                  : "inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              }
            >
              Needs changes
            </button>
            <button
              type="button"
              onClick={() => commentFieldRef.current?.focus()}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Comment first
            </button>
            {isOwner && currentDecisionStatus === "approved" && bookingUrl ? (
              <button
                type="button"
                onClick={() => void handleStartBooking()}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-emerald-300 bg-white px-5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-slate-800"
              >
                Start booking
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[1rem] border border-white/80 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Responses
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
              {responseCount}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Distinct people have reacted or commented.
            </p>
          </div>
          <div className="rounded-[1rem] border border-white/80 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Approval signals
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
              {reactionCounts.love}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              People who marked this as a yes.
            </p>
          </div>
          <div className="rounded-[1rem] border border-white/80 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Needs work
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
              {reactionCounts.pass}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              People who think the plan still needs changes.
            </p>
          </div>
        </div>
      </div>

      {isOwner && !shareMode ? (
        <div className="mt-5 rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Owner follow-through
            </div>
            <div className="text-base font-semibold text-slate-950 dark:text-slate-100">
              {followUpStatus.resolved
                ? "Follow-up cleared"
                : followUpStatus.snoozed
                  ? "Follow-up snoozed"
                  : followUpUrgency === "urgent"
                    ? "This trip needs a push now"
                    : followUpUrgency === "watch"
                      ? "Keep this trip moving"
                      : "Trip momentum is healthy"}
            </div>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {followUpStatus.resolved
                ? "You cleared follow-up for the current state. It will reopen automatically if the decision or logistics state changes."
                : followUpStatus.snoozed
                  ? `Follow-up is snoozed until ${formatShortDateTime(followUpStatus.snoozedUntil) ?? "later"}.`
                  : buildTripReminderMessage(trip)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyFollowUp("direct")}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Copy reminder
            </button>
            {reminderVariants.some((variant) => variant.id === "gentle") ? (
              <button
                type="button"
                onClick={() => void handleCopyFollowUp("gentle")}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Copy softer message
              </button>
            ) : null}
            {followUpAction ? (
              <button
                type="button"
                onClick={handleOpenFollowUpAction}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
              >
                {followUpAction.target === "booking" && bookingUrl
                  ? "Open booking flow"
                  : followUpAction.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSnoozeFollowUp}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Remind me in {followUpAction?.suggestedSnoozeDays ?? 2} day
              {(followUpAction?.suggestedSnoozeDays ?? 2) === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              onClick={handleResolveFollowUp}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {followUpStatus.resolved ? "Hidden for now" : "Hide for now"}
            </button>
          </div>

          {followUpRecord?.lastCopiedAt || followUpRecord?.lastOpenedAt ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {followUpRecord.lastCopiedAt
                ? `Last copied ${formatShortDateTime(followUpRecord.lastCopiedAt) ?? "recently"}`
                : "No reminder copied yet"}
              {followUpRecord.lastOpenedAt
                ? ` • Last opened ${formatShortDateTime(followUpRecord.lastOpenedAt) ?? "recently"}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
              Quick reaction
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["love", "maybe", "pass"] as TripFeedbackReaction[]).map((reaction) => {
                const active = currentReaction === reaction;

                return (
                  <button
                    key={reaction}
                    type="button"
                    onClick={() => void handleReaction(reaction)}
                    disabled={savingReaction !== null}
                    className={
                      active
                        ? "inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
                        : "inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    }
                  >
                    {reactionLabel(reaction)} ({reactionCounts[reaction]})
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="trip-feedback-author"
              className="text-sm font-semibold text-slate-950 dark:text-slate-100"
            >
              Name
            </label>
            <input
              id="trip-feedback-author"
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder="Optional name"
              className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="trip-feedback-message"
              className="text-sm font-semibold text-slate-950 dark:text-slate-100"
            >
              Leave a note
            </label>
            <textarea
              id="trip-feedback-message"
              ref={commentFieldRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What do you think about this plan?"
              rows={4}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-violet-500/20"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleAddComment()}
                disabled={savingComment || message.trim().length === 0}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
              >
                {savingComment ? "Saving..." : "Add comment"}
              </button>
              {status ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
            Trip notes
          </div>
          {comments.length > 0 ? (
            <div className="mt-3 space-y-3">
              {[...comments]
                .sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`))
                .map((comment) => (
                  <div
                    key={comment.id}
                    className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                        {comment.author?.trim() || "Anonymous"}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(comment.createdAt) ?? "Just now"}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {comment.message}
                    </p>
                  </div>
                ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              No notes yet. Add the first reaction or comment for this finalized trip.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
