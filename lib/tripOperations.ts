import {
  TravelerCoordinationEntry,
  TripDepartureTask,
  TripDeparturePlan,
  TripPlan,
} from "./types";

type ReadinessBreakdownItem = {
  id: string;
  label: string;
  ratio: number;
  detail: string;
};

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function buildDefaultTravelerRoster(trip: TripPlan) {
  const travelerCount = Math.max(1, Number(trip.travelerCount ?? 1));

  return Array.from({ length: travelerCount }, (_, index): TravelerCoordinationEntry => ({
    id: `traveler-${index + 1}`,
    name: index === 0 ? "Trip owner" : `Traveler ${index + 1}`,
    status: index === 0 ? "confirmed" : "pending",
  }));
}

export function buildDefaultDepartureTasks(trip: TripPlan) {
  const start = trip.tripStartDate ? startOfDay(new Date(`${trip.tripStartDate}T00:00:00`)) : null;
  const oneDayBefore = start ? isoDate(addDays(start, -1)) : undefined;
  const twoDaysBefore = start ? isoDate(addDays(start, -2)) : undefined;
  const threeDaysBefore = start ? isoDate(addDays(start, -3)) : undefined;

  return [
    {
      id: "payments",
      label: "Square up trip payments",
      detail: "Make sure shared costs and booking contributions are settled.",
      done: false,
      dueAt: threeDaysBefore,
    },
    {
      id: "transport",
      label: "Confirm transport plan",
      detail: "Lock who is driving, pickup timing, and any fuel or parking details.",
      done: false,
      dueAt: twoDaysBefore,
    },
    {
      id: "weather",
      label: "Check weather and route conditions",
      detail: "Recheck forecast, roads, and anything that changes packing or timing.",
      done: false,
      dueAt: oneDayBefore,
    },
    {
      id: "packing",
      label: "Pack and send final essentials",
      detail: "Send the group the final plan, address, and any must-bring items.",
      done: false,
      dueAt: oneDayBefore,
    },
  ] satisfies TripDepartureTask[];
}

export function getTravelerRoster(trip: TripPlan) {
  if (Array.isArray(trip.travelerRoster) && trip.travelerRoster.length > 0) {
    return trip.travelerRoster;
  }

  return buildDefaultTravelerRoster(trip);
}

export function getDepartureTasks(trip: TripPlan) {
  if (Array.isArray(trip.departureTasks) && trip.departureTasks.length > 0) {
    return trip.departureTasks;
  }

  return buildDefaultDepartureTasks(trip);
}

export function getOperationsNotes(trip: TripPlan) {
  return Array.isArray(trip.operationsNotes) ? trip.operationsNotes : [];
}

export function getDeparturePlan(trip: TripPlan): TripDeparturePlan {
  return trip.departurePlan ?? {};
}

export function getCostSplitSummary(trip: TripPlan) {
  const total = Math.max(
    0,
    Number(
      trip.budgetBreakdown?.totalExpected ??
        trip.budgetBreakdown?.total ??
        trip.totalBudget ??
        0
    )
  );
  const travelerCount = Math.max(1, Number(trip.travelerCount ?? 1));
  const perTraveler = Math.round(total / travelerCount);

  return {
    total,
    travelerCount,
    perTraveler,
    settled: Boolean(trip.paymentStatus?.settled),
    note: trip.paymentStatus?.note,
  };
}

export function getTripCountdownDays(trip: TripPlan) {
  if (!trip.tripStartDate) return null;

  const start = startOfDay(new Date(`${trip.tripStartDate}T00:00:00`));
  if (Number.isNaN(start.getTime())) return null;

  const today = startOfDay(new Date());
  return Math.round((start.getTime() - today.getTime()) / 86400000);
}

export function getTravelerStatusSummary(trip: TripPlan) {
  const roster = getTravelerRoster(trip);
  const confirmed = roster.filter((traveler) => traveler.status === "confirmed").length;
  const pending = roster.filter((traveler) => traveler.status === "pending").length;
  const needsResponse = roster.filter(
    (traveler) => traveler.status === "needs_response"
  ).length;

  return {
    total: roster.length,
    confirmed,
    pending,
    needsResponse,
  };
}

export function getDepartureTaskSummary(trip: TripPlan) {
  const tasks = getDepartureTasks(trip);
  const completed = tasks.filter((task) => task.done).length;
  const overdue = tasks.filter((task) => {
    if (!task.dueAt || task.done) return false;
    const due = startOfDay(new Date(`${task.dueAt}T00:00:00`));
    if (Number.isNaN(due.getTime())) return false;
    return due.getTime() < startOfDay(new Date()).getTime();
  }).length;

  return {
    total: tasks.length,
    completed,
    overdue,
  };
}

export function getTripReadinessSummary(trip: TripPlan) {
  const travelerSummary = getTravelerStatusSummary(trip);
  const taskSummary = getDepartureTaskSummary(trip);
  const costSplit = getCostSplitSummary(trip);
  const checklist = trip.bookingChecklist;
  const checklistDone = checklist
    ? Object.values(checklist).filter((item) => item.done).length
    : 0;
  const checklistTotal = 4;
  const noteCount = getOperationsNotes(trip).length;
  const departurePlan = getDeparturePlan(trip);
  const departurePlanScore =
    departurePlan.meetupLocation || departurePlan.transportNote || departurePlan.packingNote
      ? 1
      : 0;

  const readinessItems = [
    checklistDone / checklistTotal,
    travelerSummary.total > 0
      ? travelerSummary.confirmed / travelerSummary.total
      : 0,
    taskSummary.total > 0 ? taskSummary.completed / taskSummary.total : 0,
    costSplit.settled ? 1 : 0,
    departurePlanScore,
  ];
  const score = Math.round(
    (readinessItems.reduce((sum, item) => sum + item, 0) / readinessItems.length) * 100
  );

  let label = "Early";
  if (score >= 85) label = "Ready";
  else if (score >= 60) label = "Almost ready";
  else if (score >= 35) label = "In motion";

  return {
    score,
    label,
    travelerSummary,
    taskSummary,
    checklistDone,
    checklistTotal,
    noteCount,
    paymentsSettled: costSplit.settled,
    hasDeparturePlan: departurePlanScore === 1,
  };
}

export function getTripReadinessBreakdown(trip: TripPlan): ReadinessBreakdownItem[] {
  const readiness = getTripReadinessSummary(trip);
  const travelerRatio =
    readiness.travelerSummary.total > 0
      ? readiness.travelerSummary.confirmed / readiness.travelerSummary.total
      : 0;
  const taskRatio =
    readiness.taskSummary.total > 0
      ? readiness.taskSummary.completed / readiness.taskSummary.total
      : 0;
  const checklistRatio =
    readiness.checklistTotal > 0 ? readiness.checklistDone / readiness.checklistTotal : 0;
  const paymentRatio = readiness.paymentsSettled ? 1 : 0;
  const departureRatio = readiness.hasDeparturePlan ? 1 : 0;

  return [
    {
      id: "travelers",
      label: "Travelers",
      ratio: travelerRatio,
      detail: `${readiness.travelerSummary.confirmed}/${readiness.travelerSummary.total} confirmed`,
    },
    {
      id: "tasks",
      label: "Tasks",
      ratio: taskRatio,
      detail: `${readiness.taskSummary.completed}/${readiness.taskSummary.total} complete`,
    },
    {
      id: "booking",
      label: "Booking",
      ratio: checklistRatio,
      detail: `${readiness.checklistDone}/${readiness.checklistTotal} checklist done`,
    },
    {
      id: "payments",
      label: "Payments",
      ratio: paymentRatio,
      detail: readiness.paymentsSettled ? "Settled" : "Still open",
    },
    {
      id: "departure",
      label: "Departure plan",
      ratio: departureRatio,
      detail: readiness.hasDeparturePlan ? "Meetup plan saved" : "Still missing",
    },
  ];
}

export function getTripDeparturePlanCompletion(trip: TripPlan) {
  const plan = getDeparturePlan(trip);
  const values = [
    plan.meetupLocation,
    plan.meetupTime,
    plan.transportNote,
    plan.packingNote,
  ];
  const completed = values.filter((value) => Boolean(value?.trim())).length;
  return {
    completed,
    total: values.length,
    ratio: completed / values.length,
  };
}

export function getTripNextDeadline(trip: TripPlan) {
  const today = startOfDay(new Date()).getTime();
  const upcoming = getDepartureTasks(trip)
    .filter((task) => !task.done && task.dueAt)
    .map((task) => ({
      task,
      date: startOfDay(new Date(`${task.dueAt}T00:00:00`)),
    }))
    .filter((item) => !Number.isNaN(item.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

  if (!upcoming) return null;

  const deltaDays = Math.round((upcoming.date.getTime() - today) / 86400000);
  return {
    task: upcoming.task,
    deltaDays,
    isOverdue: deltaDays < 0,
    isToday: deltaDays === 0,
  };
}

export function getTripReadinessBlockers(trip: TripPlan) {
  const readiness = getTripReadinessSummary(trip);
  const blockers: string[] = [];

  if (readiness.travelerSummary.needsResponse > 0) {
    blockers.push(
      `${readiness.travelerSummary.needsResponse} traveler${
        readiness.travelerSummary.needsResponse === 1 ? "" : "s"
      } still need a response.`
    );
  } else if (readiness.travelerSummary.pending > 0) {
    blockers.push(
      `${readiness.travelerSummary.pending} traveler${
        readiness.travelerSummary.pending === 1 ? "" : "s"
      } are still pending.`
    );
  }

  if (readiness.taskSummary.overdue > 0) {
    blockers.push(
      `${readiness.taskSummary.overdue} departure task${
        readiness.taskSummary.overdue === 1 ? "" : "s"
      } are overdue.`
    );
  } else if (readiness.taskSummary.completed < readiness.taskSummary.total) {
    blockers.push("Departure task checklist is still incomplete.");
  }

  if (!readiness.paymentsSettled) {
    blockers.push("Shared trip payments are still open.");
  }

  if (!readiness.hasDeparturePlan) {
    blockers.push("Meetup, transport, or packing details are still missing.");
  }

  if (readiness.checklistDone < readiness.checklistTotal) {
    blockers.push("Booking checklist still has unfinished items.");
  }

  return blockers.slice(0, 4);
}

export function getTripPhaseLabel(trip: TripPlan) {
  if (trip.decisionStatus === "booked") return "Booked";
  if (trip.decisionStatus === "approved") return "Approved";
  if (trip.decisionStatus === "needs_changes") return "Needs changes";
  if (trip.status === "finalized") return "Waiting on group";
  return "Draft";
}

export function getTripBudgetStatus(trip: TripPlan) {
  const total = Number(
    trip.budgetBreakdown?.totalExpected ??
      trip.budgetBreakdown?.total ??
      trip.totalBudget ??
      0
  );
  const budget = Number(trip.totalBudget ?? 0);

  if (!budget || budget <= 0) {
    return {
      tone: "neutral" as const,
      label: "Budget open",
      detail: "No trip budget target is saved yet.",
    };
  }

  const ratio = total / budget;
  if (ratio > 1.1) {
    return {
      tone: "risk" as const,
      label: "Over budget",
      detail: `${Math.round((ratio - 1) * 100)}% over the saved target.`,
    };
  }
  if (ratio > 0.9) {
    return {
      tone: "watch" as const,
      label: "Near budget cap",
      detail: "This trip is close to the saved target.",
    };
  }
  return {
    tone: "healthy" as const,
    label: "Budget healthy",
    detail: "Current estimate still fits inside the saved target.",
  };
}

export function buildTripDepartureBrief(trip: TripPlan) {
  const countdown = getTripCountdownDays(trip);
  const readiness = getTripReadinessSummary(trip);
  const travelers = getTravelerStatusSummary(trip);
  const tasks = getDepartureTaskSummary(trip);
  const departurePlan = getDeparturePlan(trip);
  const costSplit = getCostSplitSummary(trip);
  const title = trip.title ?? trip.destinationName ?? trip.name ?? "Trip";
  const dates = trip.tripStartDate && trip.tripEndDate
    ? `${trip.tripStartDate} to ${trip.tripEndDate}`
    : trip.tripStartDate ?? "Dates TBD";

  return [
    `${title} departure brief`,
    `Dates: ${dates}`,
    countdown === null
      ? "Countdown: start date not set"
      : countdown < 0
        ? `Countdown: departed ${Math.abs(countdown)} day${Math.abs(countdown) === 1 ? "" : "s"} ago`
        : countdown === 0
          ? "Countdown: leaving today"
          : `Countdown: ${countdown} day${countdown === 1 ? "" : "s"} to go`,
    `Readiness: ${readiness.label} (${readiness.score}%)`,
    `Travelers confirmed: ${travelers.confirmed}/${travelers.total}`,
    `Departure tasks done: ${tasks.completed}/${tasks.total}`,
    `Booking checklist: ${readiness.checklistDone}/${readiness.checklistTotal}`,
    `Estimated share: $${costSplit.perTraveler} per traveler`,
    `Payments settled: ${costSplit.settled ? "yes" : "not yet"}`,
    departurePlan.meetupLocation
      ? `Meetup: ${departurePlan.meetupLocation}${departurePlan.meetupTime ? ` at ${departurePlan.meetupTime}` : ""}`
      : "Meetup: not set",
    departurePlan.transportNote ? `Transport: ${departurePlan.transportNote}` : "Transport: not set",
    departurePlan.packingNote ? `Packing: ${departurePlan.packingNote}` : "Packing: not set",
  ].join("\n");
}
