import { TripPlan } from "./types";

export type TripReminderVariantId = "direct" | "gentle";
export type TripUrgencyLevel = "calm" | "watch" | "urgent";

export type TripReminderVariant = {
  id: TripReminderVariantId;
  label: string;
  message: string;
};

export type TripFollowUpAction = {
  href: string;
  label: string;
  target: "planner" | "share" | "booking" | "logistics";
  suggestedSnoozeDays: number;
};

export function daysSinceIso(value?: string) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

export function getTripResponseCount(trip: TripPlan) {
  return new Set([
    ...(trip.reactions ?? []).map((reaction) => reaction.visitorId),
    ...(trip.comments ?? []).map((comment) => comment.visitorId),
  ]).size;
}

export function getBookingChecklistProgress(trip: TripPlan) {
  const checklist = trip.bookingChecklist;
  const completed = checklist
    ? Object.values(checklist).filter((item) => item.done).length
    : 0;

  return {
    completed,
    total: 4,
  };
}

export function getTripMomentumLabel(trip: TripPlan) {
  if (trip.status !== "finalized") return "Draft";

  switch (trip.decisionStatus ?? "waiting_on_partner") {
    case "approved":
      return "Approved";
    case "booked":
      return "Booked";
    case "needs_changes":
      return "Needs Changes";
    case "waiting_on_partner":
    default:
      return "Awaiting Decision";
  }
}

export function getTripNudge(trip: TripPlan) {
  const responseCount = getTripResponseCount(trip);
  const checklistProgress = getBookingChecklistProgress(trip);

  if (trip.status !== "finalized") {
    return {
      title: "Finalize this trip",
      detail: "It is saved, but still not locked for sharing and decision-making.",
      href: `/trip/${trip.id}`,
      actionLabel: "Open planner",
    };
  }

  if ((trip.decisionStatus ?? "waiting_on_partner") === "waiting_on_partner") {
    return {
      title:
        responseCount > 0 ? "Still waiting on approval" : "Share this finalized trip",
      detail:
        responseCount > 0
          ? `${responseCount} people responded, but the trip is still waiting on a decision.`
          : "The trip is finalized but has no visible partner response yet.",
      href: `/trip/${trip.id}?view=share`,
      actionLabel: responseCount > 0 ? "Review feedback" : "Open share view",
    };
  }

  if (trip.decisionStatus === "needs_changes") {
    return {
      title: "Trip needs revisions",
      detail: "Feedback says this plan still needs work before it can be approved.",
      href: `/trip/${trip.id}`,
      actionLabel: "Revise plan",
    };
  }

  if (trip.decisionStatus === "approved") {
    return {
      title: "Approved but not booked",
      detail: "The group approved this trip. Move it into booking and logistics.",
      href: `/trip/${trip.id}`,
      actionLabel: "Open booking flow",
    };
  }

  if (
    trip.decisionStatus === "booked" &&
    checklistProgress.completed < checklistProgress.total
  ) {
    return {
      title: "Booked trip needs logistics cleanup",
      detail: `${checklistProgress.completed}/${checklistProgress.total} booking checklist items are complete.`,
      href: `/trip/${trip.id}`,
      actionLabel: "Finish checklist",
    };
  }

  return null;
}

export function getTripFollowUpAction(trip: TripPlan): TripFollowUpAction | null {
  const checklistProgress = getBookingChecklistProgress(trip);

  if (trip.status !== "finalized") {
    return {
      href: `/trip/${trip.id}`,
      label: "Open planner",
      target: "planner",
      suggestedSnoozeDays: 2,
    };
  }

  if ((trip.decisionStatus ?? "waiting_on_partner") === "waiting_on_partner") {
    return {
      href: `/trip/${trip.id}?view=share`,
      label: "Open share view",
      target: "share",
      suggestedSnoozeDays: 2,
    };
  }

  if (trip.decisionStatus === "needs_changes") {
    return {
      href: `/trip/${trip.id}`,
      label: "Revise plan",
      target: "planner",
      suggestedSnoozeDays: 2,
    };
  }

  if (trip.decisionStatus === "approved") {
    return {
      href: `/trip/${trip.id}`,
      label: "Open booking flow",
      target: "booking",
      suggestedSnoozeDays: 1,
    };
  }

  if (
    trip.decisionStatus === "booked" &&
    checklistProgress.completed < checklistProgress.total
  ) {
    return {
      href: `/trip/${trip.id}`,
      label: "Finish checklist",
      target: "logistics",
      suggestedSnoozeDays: 2,
    };
  }

  return null;
}

export function getTripStaleness(trip: TripPlan) {
  const decisionStatus = trip.decisionStatus ?? "waiting_on_partner";
  const decisionAgeDays = daysSinceIso(trip.decisionUpdatedAt ?? trip.finalizedAt);
  const finalizedAgeDays = daysSinceIso(trip.finalizedAt);
  const checklistProgress = getBookingChecklistProgress(trip);

  if (trip.status !== "finalized") {
    const ageDays = daysSinceIso(trip.createdAt);
    if (ageDays !== null && ageDays >= 3) {
      return {
        title: "Draft has been sitting",
        detail: `This trip has stayed in draft for ${ageDays} day${ageDays === 1 ? "" : "s"}. Finalize it or prune it.`,
      };
    }
    return null;
  }

  if (decisionStatus === "waiting_on_partner") {
    if (decisionAgeDays !== null && decisionAgeDays >= 2) {
      return {
        title: "Approval is stalled",
        detail: `This finalized trip has been waiting on partner feedback for ${decisionAgeDays} day${decisionAgeDays === 1 ? "" : "s"}.`,
      };
    }
    return null;
  }

  if (decisionStatus === "needs_changes") {
    if (decisionAgeDays !== null && decisionAgeDays >= 2) {
      return {
        title: "Revision loop is stale",
        detail: `The trip has been marked needs changes for ${decisionAgeDays} day${decisionAgeDays === 1 ? "" : "s"}.`,
      };
    }
    return null;
  }

  if (decisionStatus === "approved") {
    if (decisionAgeDays !== null && decisionAgeDays >= 1) {
      return {
        title: "Approved but cooling off",
        detail: `This trip has been approved for ${decisionAgeDays} day${decisionAgeDays === 1 ? "" : "s"} without moving into booking.`,
      };
    }
    return null;
  }

  if (decisionStatus === "booked") {
    if (
      finalizedAgeDays !== null &&
      finalizedAgeDays >= 3 &&
      checklistProgress.completed < checklistProgress.total
    ) {
      return {
        title: "Booked trip still needs cleanup",
        detail: `Booked ${finalizedAgeDays} day${finalizedAgeDays === 1 ? "" : "s"} ago, but logistics are still incomplete.`,
      };
    }
  }

  return null;
}

export function getTripUrgencyLevel(trip: TripPlan): TripUrgencyLevel {
  const decisionAgeDays = daysSinceIso(trip.decisionUpdatedAt ?? trip.finalizedAt) ?? 0;
  const draftAgeDays = daysSinceIso(trip.createdAt) ?? 0;
  const checklistProgress = getBookingChecklistProgress(trip);

  if (trip.status !== "finalized") {
    if (draftAgeDays >= 5) return "urgent";
    if (draftAgeDays >= 2) return "watch";
    return "calm";
  }

  switch (trip.decisionStatus ?? "waiting_on_partner") {
    case "waiting_on_partner":
      if (decisionAgeDays >= 3) return "urgent";
      if (decisionAgeDays >= 1) return "watch";
      return "calm";
    case "needs_changes":
      if (decisionAgeDays >= 3) return "urgent";
      if (decisionAgeDays >= 1) return "watch";
      return "calm";
    case "approved":
      if (decisionAgeDays >= 2) return "urgent";
      if (decisionAgeDays >= 1) return "watch";
      return "calm";
    case "booked":
      if (checklistProgress.completed >= checklistProgress.total) return "calm";
      if (decisionAgeDays >= 4) return "urgent";
      if (decisionAgeDays >= 2) return "watch";
      return "calm";
    default:
      return "calm";
  }
}

export function getTripFollowUpStateKey(trip: TripPlan) {
  const checklistProgress = getBookingChecklistProgress(trip);

  return [
    trip.status ?? "draft",
    trip.decisionStatus ?? "waiting_on_partner",
    trip.decisionUpdatedAt ?? "",
    trip.finalizedAt ?? "",
    trip.createdAt ?? "",
    String(getTripResponseCount(trip)),
    String(checklistProgress.completed),
  ].join("|");
}

export function getTripReminderVariants(trip: TripPlan): TripReminderVariant[] {
  const title = trip.title ?? trip.destinationName ?? trip.name ?? "this trip";
  const decisionStatus = trip.decisionStatus ?? "waiting_on_partner";
  const responseCount = getTripResponseCount(trip);

  if (trip.status !== "finalized") {
    return [
      {
        id: "direct",
        label: "Direct reminder",
        message: `Reminder: ${title} is still in draft. I need to finalize the hotel and itinerary choices before sharing it.`,
      },
      {
        id: "gentle",
        label: "Gentler reminder",
        message: `Quick check-in: ${title} is still in draft while I tighten the hotel and itinerary picks. I will send it over once it is ready for a real decision.`,
      },
    ];
  }

  if (decisionStatus === "waiting_on_partner") {
    return responseCount > 0
      ? [
          {
            id: "direct",
            label: "Direct reminder",
            message: `Reminder: ${title} still needs a final yes or no decision. We already have some feedback, but I need a clear call so I can either revise it or move into booking.`,
          },
          {
            id: "gentle",
            label: "Gentler reminder",
            message: `Quick nudge on ${title}: we already have some reactions, but I still need a final approve or needs changes call before I move it forward.`,
          },
        ]
      : [
          {
            id: "direct",
            label: "Direct reminder",
            message: `Reminder: ${title} is ready to review. Take a look at the shared trip and let me know if you approve it or want changes.`,
          },
          {
            id: "gentle",
            label: "Gentler reminder",
            message: `Quick check-in: ${title} is ready for review whenever you have a minute. Let me know if you approve it or want changes.`,
          },
        ];
  }

  if (decisionStatus === "needs_changes") {
    return [
      {
        id: "direct",
        label: "Direct reminder",
        message: `Follow-up: ${title} is marked as needing changes. I'm reopening the planner, but if there are specific blockers, send them so I can revise the right things.`,
      },
      {
        id: "gentle",
        label: "Gentler reminder",
        message: `Quick follow-up on ${title}: I can revise it, but I need the main blockers called out clearly so I change the right parts.`,
      },
    ];
  }

  if (decisionStatus === "approved") {
    return [
      {
        id: "direct",
        label: "Direct reminder",
        message: `Reminder: ${title} is approved. I'm trying to push it into booking now, so if there are any last objections, flag them immediately.`,
      },
      {
        id: "gentle",
        label: "Gentler reminder",
        message: `Good news: ${title} is approved. I'm moving it into booking now, so let me know right away if there is any last-minute issue.`,
      },
    ];
  }

  return [
    {
      id: "direct",
      label: "Direct reminder",
      message: `Reminder: ${title} is booked, but I'm still wrapping up the logistics checklist. I'll share the final details once everything is confirmed.`,
    },
    {
      id: "gentle",
      label: "Gentler reminder",
      message: `Quick logistics note: ${title} is booked, and I'm finishing the last checklist items before I send the final details.`,
    },
  ];
}

export function buildTripReminderMessage(
  trip: TripPlan,
  variantId: TripReminderVariantId = "direct"
) {
  const variants = getTripReminderVariants(trip);
  return (
    variants.find((variant) => variant.id === variantId)?.message ??
    variants[0]?.message ??
    "Reminder: this trip needs attention."
  );
}

export function getTripMomentumSummary(trip: TripPlan) {
  const responses = getTripResponseCount(trip);
  const checklistProgress = getBookingChecklistProgress(trip);
  const stale = getTripStaleness(trip);
  const nudge = getTripNudge(trip);
  const urgency = getTripUrgencyLevel(trip);
  const followUpAction = getTripFollowUpAction(trip);

  return {
    label: getTripMomentumLabel(trip),
    responses,
    checklistProgress,
    stale,
    nudge,
    urgency,
    followUpAction,
  };
}
