"use client";

import { preferredHotelBookingUrl } from "../lib/expediaLinks";
import { TripPlan, TripSelectionState } from "../lib/types";

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
      return "The group is aligned. This page should now push booking and logistics.";
    case "booked":
      return "The trip is booked. Use this page as the shared itinerary and logistics reference.";
    case "needs_changes":
      return "The plan needs another pass. Use comments and go back to planner mode to revise it.";
    case "waiting_on_partner":
    default:
      return "The trip is still waiting on partner feedback. Share it, react to it, and move it toward approval.";
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

function checklistItems(trip: TripPlan) {
  const checklist = trip.bookingChecklist ?? {
    reservedStay: { done: false },
    exportedCalendar: { done: false },
    confirmedTravelers: { done: false },
    sharedItinerary: { done: false },
  };

  return [
    {
      key: "reservedStay",
      label: "Stay reserved",
      done: checklist.reservedStay.done,
      updatedBy: checklist.reservedStay.updatedBy,
    },
    {
      key: "exportedCalendar",
      label: "Calendar exported",
      done: checklist.exportedCalendar.done,
      updatedBy: checklist.exportedCalendar.updatedBy,
    },
    {
      key: "confirmedTravelers",
      label: "Travelers confirmed",
      done: checklist.confirmedTravelers.done,
      updatedBy: checklist.confirmedTravelers.updatedBy,
    },
    {
      key: "sharedItinerary",
      label: "Itinerary shared",
      done: checklist.sharedItinerary.done,
      updatedBy: checklist.sharedItinerary.updatedBy,
    },
  ] as const;
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
  const selectedHotel =
    trip.hotelOptions.find((hotel) => hotel.name === selection.hotelName) ??
    trip.hotelOptions[0];

  const lodgingLink = preferredHotelBookingUrl({
    hotel: selectedHotel,
    destination: trip.destinationName || trip.name,
    tripStartDate: trip.tripStartDate,
    tripEndDate: trip.tripEndDate,
    travelerCount: trip.travelerCount,
  });
  const currentStep = workflowStepIndex(trip);
  const opsChecklist = checklistItems(trip);
  const completedOpsCount = opsChecklist.filter((item) => item.done).length;

  return (
    <section className="space-y-5">
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
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
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
              >
                Open lodging
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

        <div className="mt-5 rounded-[1rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Progress
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
          <div className="mt-5 rounded-[1rem] border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                  Trip ops
                </div>
                <div className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-100">
                  {completedOpsCount}/{opsChecklist.length} logistics done
                </div>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                {trip.decisionStatus === "booked"
                  ? "Use this as the group status board."
                  : "This trip is approved and moving into execution."}
              </div>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {opsChecklist.map((item) => (
                    <div
                      key={item.key}
                      className={
                    item.done
                      ? "rounded-xl border border-emerald-200 bg-white px-3.5 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-300"
                      : "rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }
                    >
                      {item.done ? "Done: " : "Open: "}
                      {item.label}
                      {item.done && item.updatedBy ? ` - ${item.updatedBy}` : ""}
                    </div>
                  ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
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
                  const selectedFood = trip.foodSpots.find(
                    (item) => item.name === selection.foods[key]
                  );
                  const selectedActivity = trip.topActivities.find(
                    (item) => item.name === selection.activities[key]
                  );
                  const title =
                    stop.kind === "stay"
                      ? selectedHotel?.name
                        ? `Check in at ${selectedHotel.name}`
                        : stop.title
                      : stop.kind === "food"
                        ? selectedFood?.name ?? stop.title
                        : stop.kind === "activity"
                          ? selectedActivity?.name ?? stop.title
                          : stop.title;
                  const subtitle =
                    stop.kind === "stay"
                      ? selectedHotel?.shortDescription ?? stop.description
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
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
