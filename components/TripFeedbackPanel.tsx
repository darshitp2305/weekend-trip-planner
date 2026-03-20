"use client";

import { useEffect, useMemo, useState } from "react";
import { saveTripPlan } from "../lib/tripStore";
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
  onTripUpdated: (trip: TripPlan) => void;
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

export default function TripFeedbackPanel({ trip, onTripUpdated }: Props) {
  const [author, setAuthor] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [savingReaction, setSavingReaction] = useState<TripFeedbackReaction | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const viewer = useViewerIdentity();

  useEffect(() => {
    if (!author.trim() && viewer.email) {
      setAuthor(viewer.displayName);
    }
  }, [author, viewer.displayName, viewer.email]);

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

  const currentReaction = useMemo(() => {
    if (!viewer.visitorId) return null;
    return (
      reactions.find((reaction) => reaction.visitorId === viewer.visitorId)?.reaction ??
      null
    );
  }, [reactions, viewer.visitorId]);
  const currentDecisionStatus = trip.decisionStatus ?? "waiting_on_partner";

  async function persistTrip(nextTrip: TripPlan) {
    const result = await saveTripPlan(nextTrip);

    if (!result.success) {
      throw new Error("Trip feedback save failed.");
    }

    onTripUpdated(nextTrip);
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

      await persistTrip({
        ...trip,
        reactions: nextReactions,
      });

      setStatus("Reaction saved.");
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

      await persistTrip({
        ...trip,
        comments: nextComments,
      });

      setMessage("");
      setStatus("Comment added.");
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

      await persistTrip({
        ...trip,
        decisionStatus: nextStatus,
        decisionUpdatedAt: new Date().toISOString(),
        decisionUpdatedBy: author.trim() || viewer.displayName,
      });

      setStatus(`Decision updated to ${decisionLabel(nextStatus)}.`);
    } catch (error) {
      console.error("Failed to save trip decision:", error);
      setStatus("Decision update failed.");
    }
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
          Feedback
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Reactions and notes
        </h2>
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          Use this to get quick partner feedback on a finalized trip without sending people back into the planner.
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

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
              Decision status
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  "waiting_on_partner",
                  "needs_changes",
                  "approved",
                  "booked",
                ] as TripDecisionStatus[]
              ).map((decision) => {
                const active = currentDecisionStatus === decision;

                return (
                  <button
                    key={decision}
                    type="button"
                    onClick={() => void handleDecisionStatus(decision)}
                    className={
                      active
                        ? "inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
                        : "inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    }
                  >
                    {decisionLabel(decision)}
                  </button>
                );
              })}
            </div>
          </div>

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
