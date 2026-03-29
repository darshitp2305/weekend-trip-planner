"use client";

/**
 * Reusable UI component for the shared trip snapshot section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */


import { preferredHotelBookingUrl } from "../lib/expediaLinks";
import { TripPlan, TripSelectionState } from "../lib/types";
import {
  getAddedStopsForDay,
  getCustomStopForKey,
  normalizeSelectionState,
} from "../lib/tripSelections";
import {
  tripFreshnessLabel,
  tripProviderStatusText,
  tripSourceLabel,
  tripTrustNote,
} from "../lib/trustSignals";

type Props = {
  trip: TripPlan;
  selection: TripSelectionState;
  tripDateRange?: string;
  routeSummary?: string;
  estimatedTotalCost: number;
  estimatedBudgetPerTraveler: number;
  travelerCount: number;
};

function formatMoney(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }

  return `$${Math.round(value)}`;
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function timeWindowLabel(time?: string) {
  switch (normalized(time)) {
    case "morning":
      return "8:00-10:00 AM";
    case "late morning":
      return "10:30 AM-12:30 PM";
    case "afternoon":
      return "1:00-4:00 PM";
    case "late afternoon":
      return "4:00-6:00 PM";
    case "evening":
      return "6:00-8:30 PM";
    case "night":
      return "After 8:00 PM";
    case "anytime":
      return "Flexible timing";
    default:
      return undefined;
  }
}

function decisionLabel(status?: TripPlan["decisionStatus"]) {
  switch (status) {
    case "approved":
      return "Approved and ready to act on";
    case "booked":
      return "Booked";
    case "needs_changes":
      return "Needs another pass";
    case "waiting_on_partner":
      return "Waiting on partner";
    default:
      return "Decision still open";
  }
}

function decisionGuidance(status?: TripPlan["decisionStatus"]) {
  switch (status) {
    case "approved":
      return "The group is aligned. This page reflects the locked trip details everyone should review from the same version.";
    case "booked":
      return "The trip is booked. Use this page as the shared itinerary reference.";
    case "needs_changes":
      return "The plan needs another pass. Use comments and go back to planner mode to revise it.";
    case "waiting_on_partner":
    default:
      return "The trip is still waiting on partner feedback. Review it, react to it, and help move it toward approval.";
  }
}

export default function SharedTripSnapshot({
  trip,
  selection,
  tripDateRange,
  routeSummary,
  estimatedTotalCost,
  estimatedBudgetPerTraveler,
  travelerCount,
}: Props) {
  const normalizedSelection = normalizeSelectionState(selection);
  const selectedHotel =
    trip.hotelOptions.find((hotel) => hotel.name === normalizedSelection.hotelName) ??
    trip.hotelOptions[0];

  const lodgingLink = preferredHotelBookingUrl({
    hotel: selectedHotel,
    destination: trip.destinationName || trip.name,
    tripStartDate: trip.tripStartDate,
    tripEndDate: trip.tripEndDate,
    travelerCount: trip.travelerCount,
  });

  return (
    <section className="space-y-5">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#04b887] dark:text-[#7decc7]">
              Shared trip
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              Read-only trip snapshot
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              This version is meant for quick review, sharing, and booking decisions. The plan below reflects the currently finalized hotel and stop selections.
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              Decision status: {decisionLabel(trip.decisionStatus)}
            </p>
            {trip.ownerEmail ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Shared by {trip.ownerEmail}
              </p>
            ) : null}
            {trip.decisionUpdatedBy ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Last decision change by {trip.decisionUpdatedBy}
              </p>
            ) : null}
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {decisionGuidance(trip.decisionStatus)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {lodgingLink ? (
              <a
                href={lodgingLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-[#06d8a0] dark:text-slate-950 dark:hover:bg-[#3be0ab]"
              >
                Open lodging
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Data source
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {tripSourceLabel(trip)}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {tripFreshnessLabel(trip)}
            </p>
          </div>

          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Stay
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {selectedHotel?.name ?? trip.homeBaseCity ?? trip.destinationName}
            </div>
          </div>

          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Trip window
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {tripDateRange || "Dates flexible"}
            </div>
          </div>

          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Budget
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {formatMoney(estimatedTotalCost)}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {formatMoney(estimatedBudgetPerTraveler)} per traveler for {travelerCount} traveler{travelerCount === 1 ? "" : "s"}.
            </p>
          </div>

          <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Route
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
              {routeSummary ?? trip.driveTimeText}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[1rem] border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
            Trust note
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">
            {tripTrustNote(trip)}
          </p>
          {tripProviderStatusText(trip) ? (
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
              {tripProviderStatusText(trip)}
            </p>
          ) : null}
        </div>

      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#04b887] dark:text-[#7decc7]">
            Itinerary
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Finalized trip flow
          </h2>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            This is the simple, shareable version of the trip plan without edit controls.
          </p>
        </div>

        <div className="mt-5 space-y-4">
          {trip.itineraryDays.map((day, dayIndex) => (
            <div
              key={`${day.title ?? "day"}-${dayIndex}`}
              className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Day {dayIndex + 1}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
                {day.title ?? `Trip day ${dayIndex + 1}`}
              </h3>
              {day.summary ? (
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {day.summary}
                </p>
              ) : null}

              <div className="mt-4 space-y-3">
                {(day.stops ?? []).map((stop, stopIndex) => {
                  const key = stopKey(dayIndex, stopIndex);
                  const customStop = getCustomStopForKey(normalizedSelection, key);
                  const customReplacement =
                    customStop?.kind === stop.kind ? customStop : undefined;
                  const selectedFood = trip.foodSpots.find(
                    (item) => item.name === normalizedSelection.foods[key]
                  );
                  const selectedActivity = trip.topActivities.find(
                    (item) => item.name === normalizedSelection.activities[key]
                  );
                  const title =
                    stop.kind === "stay"
                      ? selectedHotel?.name
                        ? `Check in at ${selectedHotel.name}`
                        : stop.title
                      : customReplacement
                        ? customReplacement.title
                      : stop.kind === "food"
                        ? selectedFood?.name ?? stop.title
                        : stop.kind === "activity"
                          ? selectedActivity?.name ?? stop.title
                          : stop.title;
                  const subtitle =
                    stop.kind === "stay"
                      ? selectedHotel?.shortDescription ?? stop.description
                      : customReplacement
                        ? customReplacement.description ?? stop.description
                      : stop.kind === "food"
                        ? selectedFood?.shortDescription ?? stop.description
                        : stop.kind === "activity"
                          ? selectedActivity?.shortDescription ?? stop.description
                          : stop.description;

                  return (
                    <div
                      key={`${key}-${title}`}
                      className="rounded-[1rem] border border-white/80 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        {stop.time ?? stop.kind ?? "Stop"}
                      </div>
                      {timeWindowLabel(stop.time) ? (
                        <div className="mt-1 text-[12px] font-medium leading-5 text-slate-500 dark:text-slate-400">
                          {timeWindowLabel(stop.time)}
                        </div>
                      ) : null}
                      <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                        {title}
                      </div>
                      {subtitle ? (
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {subtitle}
                        </p>
                      ) : null}
                    </div>
                  );
                })}

                {getAddedStopsForDay(normalizedSelection, dayIndex).map((addedStop) => (
                  <div
                    key={addedStop.id}
                    className="rounded-[1rem] border border-emerald-200 bg-emerald-50 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                      {addedStop.time ?? "Added stop"}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                      {addedStop.title}
                    </div>
                    {addedStop.description ? (
                      <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-200">
                        {addedStop.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
