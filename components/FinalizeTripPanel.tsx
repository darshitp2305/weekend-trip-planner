"use client";

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
  return (
    Object.keys(selection.foods ?? {}).length +
    Object.keys(selection.activities ?? {}).length
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
  const finalizedAtLabel = formatFinalizedAt(trip.finalizedAt);
  const selectedHotel = selectedHotelLabel(trip, selection);
  const selectedStopCount = countSelectedStops(selection);
  const tripWindow = [formatDate(trip.tripStartDate), formatDate(trip.tripEndDate)]
    .filter(Boolean)
    .join(" - ");

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
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
            {readinessLabel(budgetDelta)} Finalizing saves the current hotel, stop choices, budget snapshot, and trip details as the version you share and book from.
          </p>
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

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Edited stops
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {selectedStopCount}
          </div>
        </div>

        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Trip window
          </div>
          <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
            {tripWindow || "Dates flexible"}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
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

        <div className="rounded-[1rem] border border-white/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Share and book
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
            Use the action rail right after finalizing to copy the share link, export the calendar, and open the lodging booking page from the locked plan.
          </p>
        </div>
      </div>

      {statusMessage ? (
        <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
          {statusMessage}
        </p>
      ) : null}
    </section>
  );
}
