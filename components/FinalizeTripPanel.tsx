"use client";

/**
 * Reusable UI component for the finalize trip panel section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */


import { useRouter } from "next/navigation";
import { useState } from "react";
import { TripPlan, TripSelectionState } from "../lib/types";

type Props = {
  trip: TripPlan;
  selection: TripSelectionState;
  estimatedTotalCost: number;
  budgetDelta: number | null;
  routeSummary?: string;
  onFinalize: () => Promise<void> | void;
  finalizing: boolean;
  statusMessage?: string;
};

function formatMoney(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return `$${Math.round(value)}`;
}

function formatDate(value?: string) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatFinalizedAt(value?: string) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function selectedHotelLabel(trip: TripPlan, selection: TripSelectionState) {
  return (
    trip.hotelOptions.find((hotel) => hotel.name === selection.hotelName)?.name ??
    trip.hotelOptions[0]?.name ??
    trip.homeBaseCity ??
    trip.destinationName
  );
}

function countSelectedStops(selection: TripSelectionState) {
  const customReplacementCount = Object.values(selection.customStops ?? {}).length;
  const addedStopCount = Object.values(selection.addedStops ?? {}).reduce(
    (sum, stops) => sum + (stops?.length ?? 0),
    0
  );

  return (
    Object.keys(selection.foods ?? {}).length +
    Object.keys(selection.activities ?? {}).length +
    customReplacementCount +
    addedStopCount
  );
}

function readinessLabel(budgetDelta: number | null) {
  if (budgetDelta === null) return "Plan is ready to share and book.";
  if (budgetDelta <= 0) return "Plan is inside the target budget.";
  return "Plan is ready, but budget is over target.";
}

export default function FinalizeTripPanel({
  trip,
  selection,
  estimatedTotalCost,
  budgetDelta,
  routeSummary,
  onFinalize,
  finalizing,
  statusMessage,
}: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const isDraft = trip.status !== "finalized";
  const finalizedAtLabel = formatFinalizedAt(trip.finalizedAt);
  const selectedHotel = selectedHotelLabel(trip, selection);
  const selectedStopCount = countSelectedStops(selection);
  const tripWindow = [formatDate(trip.tripStartDate), formatDate(trip.tripEndDate)]
    .filter(Boolean)
    .join(" - ");
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : (() => {
          const url = new URL(window.location.href);
          url.searchParams.set("view", "share");
          return url.toString();
        })();

  async function handleCopyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function handleOpenShareView() {
    router.push(`/trip/${trip.id}?view=share`);
  }

  return (
    <section className="rounded-[1.5rem] border border-emerald-200 bg-[linear-gradient(135deg,#f0fdf4,#ecfeff)] p-5 shadow-sm dark:border-emerald-500/30 dark:bg-[linear-gradient(135deg,rgba(6,78,59,0.36),rgba(15,23,42,0.92))]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            Finalize trip
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            {trip.status === "finalized" ? "Trip finalized" : "Ready to lock this plan?"}
          </h2>
          {trip.status === "finalized" ? (
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
              This trip is now locked as the version you send to friends. Share the link below, have them approve or request changes, then move to booking once the group signs off.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {readinessLabel(budgetDelta)} Finalizing saves the current hotel, stop choices, budget snapshot, and trip details as the version you share and book from.
            </p>
          )}
          {trip.status === "finalized" && finalizedAtLabel ? (
            <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Current finalized version saved on {finalizedAtLabel}.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => void onFinalize()}
          disabled={finalizing}
          className="inline-flex h-12 items-center justify-center rounded-2xl bg-emerald-700 px-6 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
        >
          {finalizing
            ? "Saving..."
            : trip.status === "finalized"
              ? "Update finalized trip"
              : "Finalize this trip"}
        </button>
      </div>

      <div className={`mt-5 grid gap-3 ${isDraft ? "md:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Stay locked in
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {selectedHotel}
          </div>
        </div>

        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Current total
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {formatMoney(estimatedTotalCost)}
          </div>
        </div>

        {isDraft ? null : (
          <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Edited stops
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {selectedStopCount}
            </div>
          </div>
        )}

        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Trip window
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {tripWindow || "Dates flexible"}
          </div>
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${isDraft ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Budget fit
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
            {budgetDelta === null
              ? "Target budget is not available yet, so this finalized version uses the current estimated total."
              : budgetDelta <= 0
                ? `${formatMoney(Math.abs(budgetDelta))} under your target total budget.`
                : `${formatMoney(budgetDelta)} over your target total budget.`}
          </p>
        </div>

        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Route check
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
            {routeSummary ??
              "Route timing has not loaded yet, but the finalized version will still keep the selected trip structure and stops."}
          </p>
        </div>

        {isDraft ? (
          <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              What happens next
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
              Finalize once the stay, budget, and day flow feel right. The decision and logistics layers stay quieter until then.
            </p>
          </div>
        ) : (
          <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Approval flow
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
              1. Copy the share link. 2. Send it to friends. 3. Have them react, comment, and approve the plan. 4. Book once the trip is approved.
            </p>
          </div>
        )}
      </div>

      {trip.status === "finalized" ? (
        <div className="mt-4 rounded-[1.1rem] border border-emerald-200 bg-white/80 p-4 dark:border-emerald-500/30 dark:bg-slate-900/75">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                Next step
              </div>
              <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
                Share this trip and get sign-off
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
                Friends should open the share view, react to the plan, leave comments if needed, and mark it approved before anyone books.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
              >
                {copied ? "Share link copied" : "Copy share link"}
              </button>
              <button
                type="button"
                onClick={handleOpenShareView}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Open share view
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Step 1
              </div>
              <p className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-100">
                Send the share link to your group.
              </p>
            </div>
            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Step 2
              </div>
              <p className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-100">
                They react, comment, and approve or request changes.
              </p>
            </div>
            <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Step 3
              </div>
              <p className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-100">
                Once approved, move the group into booking.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
