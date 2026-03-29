"use client";

import { useEffect, useMemo, useState } from "react";
import { baseTripAnalytics, trackProductEvent } from "../lib/productAnalytics";
import {
  buildTripDepartureBrief,
  getCostSplitSummary,
  getDeparturePlan,
  getDepartureTasks,
  getOperationsNotes,
  getTravelerRoster,
  getTripCountdownDays,
  getTripNextDeadline,
  getTripReadinessSummary,
} from "../lib/tripOperations";
import { saveTripPlan, type SaveTripPlanResult } from "../lib/tripStore";
import { useViewerIdentity } from "../lib/viewerIdentity";
import {
  TravelerCoordinationEntry,
  TravelerCoordinationStatus,
  TripOperationsNoteKind,
  TripPlan,
} from "../lib/types";

type Props = {
  trip: TripPlan;
  onTripUpdated: (trip: TripPlan, result: SaveTripPlanResult) => void;
  isOwner?: boolean;
  shareMode?: boolean;
};

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date);
}

function formatMoney(value: number) {
  return `$${Math.round(value)}`;
}

function statusLabel(status: TravelerCoordinationStatus) {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "needs_response":
      return "Needs response";
    default:
      return "Pending";
  }
}

function isPlaceholderTraveler(name?: string) {
  const normalized = (name ?? "").trim().toLowerCase();
  return normalized === "trip owner" || normalized === "traveler" || normalized.startsWith("traveler ");
}

export default function TripOperationsPanel({
  trip,
  onTripUpdated,
  isOwner = false,
  shareMode = false,
}: Props) {
  const viewer = useViewerIdentity();
  const [status, setStatus] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const [noteKind, setNoteKind] = useState<TripOperationsNoteKind>("logistics");
  const [meetupLocation, setMeetupLocation] = useState("");
  const [meetupTime, setMeetupTime] = useState("");
  const [transportNote, setTransportNote] = useState("");
  const [packingNote, setPackingNote] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [savingTravelerId, setSavingTravelerId] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);

  const readiness = useMemo(() => getTripReadinessSummary(trip), [trip]);
  const countdownDays = useMemo(() => getTripCountdownDays(trip), [trip]);
  const travelerRoster = useMemo(() => getTravelerRoster(trip), [trip]);
  const departureTasks = useMemo(() => getDepartureTasks(trip), [trip]);
  const operationsNotes = useMemo(() => getOperationsNotes(trip), [trip]);
  const departurePlan = useMemo(() => getDeparturePlan(trip), [trip]);
  const costSplit = useMemo(() => getCostSplitSummary(trip), [trip]);
  const nextDeadline = useMemo(() => getTripNextDeadline(trip), [trip]);
  const latestNote = useMemo(
    () => operationsNotes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [operationsNotes]
  );
  const canSelfConfirm = trip.status === "finalized" && viewer.ready && Boolean(viewer.userId || viewer.visitorId);
  const canEditOperations = isOwner && !shareMode;

  useEffect(() => {
    setMeetupLocation(departurePlan.meetupLocation ?? "");
    setMeetupTime(departurePlan.meetupTime ?? "");
    setTransportNote(departurePlan.transportNote ?? "");
    setPackingNote(departurePlan.packingNote ?? "");
  }, [departurePlan.meetupLocation, departurePlan.meetupTime, departurePlan.packingNote, departurePlan.transportNote]);

  useEffect(() => {
    setPaymentNote(costSplit.note ?? "");
  }, [costSplit.note]);

  async function persistTrip(nextTrip: TripPlan) {
    const result = await saveTripPlan(nextTrip);
    if (!result.success) throw new Error("Trip operations save failed.");
    const savedTrip = result.trip ?? nextTrip;
    onTripUpdated(savedTrip, result);
    return savedTrip;
  }

  function updatedTraveler(traveler: TravelerCoordinationEntry, nextStatus: TravelerCoordinationStatus) {
    return {
      ...traveler,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      updatedBy: viewer.displayName,
      visitorId: viewer.visitorId,
      userId: viewer.userId,
    };
  }

  async function handleTravelerStatus(id: string, nextStatus: TravelerCoordinationStatus) {
    try {
      setSavingTravelerId(id);
      const nextTrip: TripPlan = {
        ...trip,
        travelerRoster: travelerRoster.map((traveler) =>
          traveler.id === id ? updatedTraveler(traveler, nextStatus) : traveler
        ),
      };
      const savedTrip = await persistTrip(nextTrip);
      setStatus("Traveler status updated.");
      trackProductEvent("trip_traveler_updated", {
        ...baseTripAnalytics(savedTrip),
        metadata: { travelerId: id, nextStatus, source: "operations_panel" },
      });
    } catch (error) {
      console.error("Traveler update failed:", error);
      setStatus("Traveler update failed.");
    } finally {
      setSavingTravelerId(null);
    }
  }

  async function handleViewerConfirmation(nextStatus: TravelerCoordinationStatus) {
    if (!canSelfConfirm) return;

    try {
      setSavingTravelerId("viewer-self");
      let nextRoster = [...travelerRoster];
      const existingIndex = nextRoster.findIndex(
        (traveler) =>
          (viewer.userId && traveler.userId && traveler.userId === viewer.userId) ||
          (viewer.visitorId && traveler.visitorId && traveler.visitorId === viewer.visitorId)
      );
      const nextTraveler: TravelerCoordinationEntry = {
        id:
          existingIndex >= 0
            ? nextRoster[existingIndex].id
            : `viewer-${viewer.userId ?? viewer.visitorId ?? crypto.randomUUID()}`,
        name: viewer.displayName || viewer.email || "Traveler",
        status: nextStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: viewer.displayName,
        visitorId: viewer.visitorId,
        userId: viewer.userId,
      };

      if (existingIndex >= 0) {
        nextRoster[existingIndex] = { ...nextRoster[existingIndex], ...nextTraveler };
      } else {
        const placeholderIndex = nextRoster.findIndex(
          (traveler) =>
            !traveler.userId &&
            !traveler.visitorId &&
            traveler.status !== "confirmed" &&
            isPlaceholderTraveler(traveler.name)
        );
        if (placeholderIndex >= 0) {
          nextRoster[placeholderIndex] = { ...nextRoster[placeholderIndex], ...nextTraveler };
        } else {
          nextRoster = [...nextRoster, nextTraveler];
        }
      }

      const savedTrip = await persistTrip({ ...trip, travelerRoster: nextRoster });
      setStatus(
        nextStatus === "confirmed"
          ? "You are marked as confirmed."
          : "You are marked as needing follow-up."
      );
      trackProductEvent("trip_traveler_updated", {
        ...baseTripAnalytics(savedTrip),
        metadata: {
          nextStatus,
          source: shareMode ? "share_self_confirm" : "operations_panel_self",
        },
      });
    } catch (error) {
      console.error("Traveler self-confirm failed:", error);
      setStatus("Attendance update failed.");
    } finally {
      setSavingTravelerId(null);
    }
  }

  async function handleTaskToggle(id: string) {
    try {
      setSavingTaskId(id);
      const nextTrip: TripPlan = {
        ...trip,
        departureTasks: departureTasks.map((task) =>
          task.id === id
            ? {
                ...task,
                done: !task.done,
                updatedAt: new Date().toISOString(),
                updatedBy: viewer.displayName,
                visitorId: viewer.visitorId,
                userId: viewer.userId,
              }
            : task
        ),
      };
      const savedTrip = await persistTrip(nextTrip);
      setStatus("Departure task updated.");
      trackProductEvent("trip_departure_task_updated", {
        ...baseTripAnalytics(savedTrip),
        metadata: { taskId: id, source: "operations_panel" },
      });
    } catch (error) {
      console.error("Departure task update failed:", error);
      setStatus("Departure task update failed.");
    } finally {
      setSavingTaskId(null);
    }
  }

  async function handleSaveDeparturePlan() {
    try {
      setSavingMeta(true);
      const nextTrip: TripPlan = {
        ...trip,
        departurePlan: {
          meetupLocation: meetupLocation.trim() || undefined,
          meetupTime: meetupTime.trim() || undefined,
          transportNote: transportNote.trim() || undefined,
          packingNote: packingNote.trim() || undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: viewer.displayName,
          visitorId: viewer.visitorId,
          userId: viewer.userId,
        },
      };
      const savedTrip = await persistTrip(nextTrip);
      setStatus("Departure plan saved.");
      trackProductEvent("trip_departure_plan_updated", {
        ...baseTripAnalytics(savedTrip),
        metadata: { source: "operations_panel" },
      });
    } catch (error) {
      console.error("Departure plan save failed:", error);
      setStatus("Departure plan save failed.");
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleSavePayments(nextSettled: boolean) {
    try {
      setSavingMeta(true);
      const nextTrip: TripPlan = {
        ...trip,
        paymentStatus: {
          settled: nextSettled,
          note: paymentNote.trim() || undefined,
          updatedAt: new Date().toISOString(),
          updatedBy: viewer.displayName,
          visitorId: viewer.visitorId,
          userId: viewer.userId,
        },
      };
      const savedTrip = await persistTrip(nextTrip);
      setStatus(nextSettled ? "Payments marked settled." : "Payments marked open.");
      trackProductEvent("trip_payments_updated", {
        ...baseTripAnalytics(savedTrip),
        metadata: { settled: nextSettled, source: "operations_panel" },
      });
    } catch (error) {
      console.error("Payment status save failed:", error);
      setStatus("Payment status save failed.");
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleAddNote() {
    const trimmed = noteMessage.trim();
    if (!trimmed) return;

    try {
      setSavingMeta(true);
      const nextTrip: TripPlan = {
        ...trip,
        operationsNotes: [
          ...operationsNotes,
          {
            id: crypto.randomUUID(),
            message: trimmed,
            author: viewer.displayName || viewer.email,
            kind: noteKind,
            createdAt: new Date().toISOString(),
            visitorId: viewer.visitorId,
            userId: viewer.userId,
          },
        ],
      };
      const savedTrip = await persistTrip(nextTrip);
      setNoteMessage("");
      setStatus("Operations note added.");
      trackProductEvent("trip_operations_note_added", {
        ...baseTripAnalytics(savedTrip),
        metadata: { kind: noteKind, source: "operations_panel" },
      });
    } catch (error) {
      console.error("Operations note save failed:", error);
      setStatus("Operations note save failed.");
    } finally {
      setSavingMeta(false);
    }
  }

  async function copyDepartureBrief() {
    try {
      await navigator.clipboard.writeText(buildTripDepartureBrief(trip));
      setStatus("Departure brief copied.");
      trackProductEvent("trip_departure_brief_copied", {
        ...baseTripAnalytics(trip),
        metadata: { source: shareMode ? "share_view" : "operations_panel" },
      });
    } catch (error) {
      console.error("Departure brief copy failed:", error);
      setStatus("Departure brief copy failed.");
    }
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#04b887] dark:text-[#7decc7]">
          Organizer tools
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Optional coordination
        </h2>
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {shareMode
            ? "Use these notes only if your group wants lightweight coordination around attendance, payments, or meetup details."
            : "These tools are optional. Use them only if your group wants help tracking attendance, payments, or meetup details."}
        </p>
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
              Booking already counts as booked
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
              You do not need to finish every organizer tool here. These are just extras for groups that want them.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {readiness.travelerSummary.confirmed}/{readiness.travelerSummary.total} travelers confirmed
            </span>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {costSplit.settled ? "Payments settled" : "Payments optional"}
            </span>
            <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {countdownDays === null ? "Dates flexible" : `${countdownDays} day${countdownDays === 1 ? "" : "s"} out`}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyDepartureBrief()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
        >
          Copy departure brief
        </button>
        {status ? (
          <span className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {status}
          </span>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <section className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Traveler confirmation</div>
                <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">Lock who is actually going</div>
              </div>
              <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {readiness.travelerSummary.confirmed}/{readiness.travelerSummary.total} confirmed
              </span>
            </div>

            {canSelfConfirm && !isOwner ? (
              <div className="mt-4 rounded-[1rem] border border-[#b2f6df] bg-white p-4 dark:border-[#06d8a0]/30 dark:bg-slate-900">
                <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">Respond for yourself</div>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Mark whether you are in or whether the owner still needs a response from you.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleViewerConfirmation("confirmed")}
                    disabled={savingTravelerId === "viewer-self"}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
                  >
                    I am going
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleViewerConfirmation("needs_response")}
                    disabled={savingTravelerId === "viewer-self"}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Follow up with me
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {travelerRoster.map((traveler) => (
                <div
                  key={traveler.id}
                  className="rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{traveler.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {statusLabel(traveler.status)}
                        </span>
                        {traveler.updatedAt ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Updated {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(traveler.updatedAt))}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {canEditOperations ? (
                      <div className="flex flex-wrap gap-2">
                        {(["pending", "confirmed", "needs_response"] as TravelerCoordinationStatus[]).map((option) => (
                          <button
                            key={`${traveler.id}-${option}`}
                            type="button"
                            disabled={savingTravelerId === traveler.id}
                            onClick={() => void handleTravelerStatus(traveler.id, option)}
                            className={
                              traveler.status === option
                                ? "inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-3 text-xs font-medium text-white dark:bg-[#06d8a0] dark:text-slate-950"
                                : "inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            }
                          >
                            {statusLabel(option)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Departure tasks</div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">Optional trip reminders</div>
            <div className="mt-4 space-y-3">
              {departureTasks.map((task) => (
                <label
                  key={task.id}
                  className={
                    task.dueAt && !task.done && nextDeadline?.task.id === task.id && nextDeadline.isOverdue
                      ? "flex items-start justify-between gap-3 rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10"
                      : "flex items-start justify-between gap-3 rounded-[1rem] border border-white bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900"
                  }
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{task.label}</div>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{task.detail}</p>
                    {task.dueAt ? (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Due {formatDate(task.dueAt) ?? task.dueAt}
                        {nextDeadline?.task.id === task.id && nextDeadline.isOverdue ? " | overdue" : ""}
                        {nextDeadline?.task.id === task.id && nextDeadline.isToday ? " | today" : ""}
                      </div>
                    ) : null}
                  </div>
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={!canEditOperations || savingTaskId === task.id}
                    onChange={() => void handleTaskToggle(task.id)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#04b887] focus:ring-[#06d8a0]"
                  />
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Payment split</div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">{formatMoney(costSplit.perTraveler)} per traveler</div>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Estimated total {formatMoney(costSplit.total)} across {costSplit.travelerCount} traveler{costSplit.travelerCount === 1 ? "" : "s"}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className={
                  costSplit.settled
                    ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                    : "inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                }
              >
                {costSplit.settled ? "Payments settled" : "Payments still open"}
              </span>
            </div>
            <textarea
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.target.value)}
              disabled={!canEditOperations}
              placeholder="Example: Alex paid hotel, settle gas after the trip."
              className="mt-4 min-h-[96px] w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#3be0ab] focus:ring-2 focus:ring-[#d7fcef] disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-[#06d8a0]/20"
            />
            {canEditOperations ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={savingMeta}
                  onClick={() => void handleSavePayments(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Keep open
                </button>
                <button
                  type="button"
                  disabled={savingMeta}
                  onClick={() => void handleSavePayments(true)}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
                >
                  Mark settled
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Departure plan</div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">Meetup, transport, and packing</div>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={meetupLocation}
                onChange={(event) => setMeetupLocation(event.target.value)}
                disabled={!canEditOperations}
                placeholder="Meetup location"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[#3be0ab] focus:ring-2 focus:ring-[#d7fcef] disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-[#06d8a0]/20"
              />
              <input
                type="text"
                value={meetupTime}
                onChange={(event) => setMeetupTime(event.target.value)}
                disabled={!canEditOperations}
                placeholder="Meetup time"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-[#3be0ab] focus:ring-2 focus:ring-[#d7fcef] disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-[#06d8a0]/20"
              />
              <textarea
                value={transportNote}
                onChange={(event) => setTransportNote(event.target.value)}
                disabled={!canEditOperations}
                placeholder="Transport plan, driver, parking, fuel, or route notes"
                className="min-h-[88px] w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#3be0ab] focus:ring-2 focus:ring-[#d7fcef] disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-[#06d8a0]/20"
              />
              <textarea
                value={packingNote}
                onChange={(event) => setPackingNote(event.target.value)}
                disabled={!canEditOperations}
                placeholder="Packing reminders, weather gear, or must-bring items"
                className="min-h-[88px] w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#3be0ab] focus:ring-2 focus:ring-[#d7fcef] disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-[#06d8a0]/20"
              />
            </div>
            {canEditOperations ? (
              <div className="mt-3">
                <button
                  type="button"
                  disabled={savingMeta}
                  onClick={() => void handleSaveDeparturePlan()}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
                >
                  Save departure plan
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Logistics notes</div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">Final coordination notes</div>
            {latestNote ? (
              <div className="mt-4 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Latest note</div>
                <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">{latestNote.author || "Trip note"}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{latestNote.message}</p>
              </div>
            ) : null}
            {canEditOperations ? (
              <div className="mt-4 rounded-[1rem] border border-white bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap gap-2">
                  {(["logistics", "warning", "update"] as TripOperationsNoteKind[]).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setNoteKind(kind)}
                      className={
                        noteKind === kind
                          ? "inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-3 text-xs font-medium text-white dark:bg-[#06d8a0] dark:text-slate-950"
                          : "inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      }
                    >
                      {kind === "logistics" ? "Logistics" : kind === "warning" ? "Warning" : "Update"}
                    </button>
                  ))}
                </div>
                <textarea
                  value={noteMessage}
                  onChange={(event) => setNoteMessage(event.target.value)}
                  placeholder="Add a note for the group or the owner."
                  className="mt-3 min-h-[96px] w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#3be0ab] focus:ring-2 focus:ring-[#d7fcef] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-[#06d8a0]/20"
                />
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={savingMeta || !noteMessage.trim()}
                    onClick={() => void handleAddNote()}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
                  >
                    Add note
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {operationsNotes.length > 0 ? (
                operationsNotes
                  .slice()
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((note) => (
                    <div
                      key={note.id}
                      className="rounded-[1rem] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{note.author || "Trip note"}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {new Intl.DateTimeFormat("en-CA", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(note.createdAt))}
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        {note.kind ?? "logistics"}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{note.message}</p>
                    </div>
                  ))
              ) : (
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">No logistics notes yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
