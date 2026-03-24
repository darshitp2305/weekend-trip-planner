import type {
  TravelerCoordinationEntry,
  TripCommentEntry,
  TripPlan,
  TripReactionEntry,
} from "./types";

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTripEditToken() {
  return `${crypto.randomUUID()}${randomHex(16)}`;
}

export function ensureTripEditToken<T extends Partial<TripPlan>>(plan: T) {
  if (typeof plan.editToken === "string" && plan.editToken.length >= 32) {
    return plan as T & { editToken: string };
  }

  return {
    ...plan,
    editToken: createTripEditToken(),
  } as T & { editToken: string };
}

export function sanitizeTripForPersistence(plan: TripPlan): TripPlan {
  return {
    ...plan,
    routeSummary: plan.routeSummary
      ? {
          ...plan.routeSummary,
          geometry: undefined,
        }
      : undefined,
  };
}

export function sanitizeTripForResponse(
  plan: TripPlan,
  options?: {
    includeOwnerFields?: boolean;
    includeEditToken?: boolean;
  }
): TripPlan {
  const sanitized = sanitizeTripForPersistence(plan);

  if (!options?.includeOwnerFields) {
    sanitized.ownerUserId = undefined;
    sanitized.ownerEmail = undefined;
  }

  if (!options?.includeEditToken) {
    sanitized.editToken = undefined;
  }

  return sanitized;
}

function mergeUniqueEntries<T>(
  existing: T[] | undefined,
  incoming: T[] | undefined,
  getKey: (entry: T) => string
) {
  if (!incoming) {
    return existing;
  }

  const merged = [...(existing ?? [])];
  const indexByKey = new Map<string, number>();

  for (const [index, entry] of merged.entries()) {
    const key = getKey(entry);
    if (key) {
      indexByKey.set(key, index);
    }
  }

  for (const entry of incoming) {
    const key = getKey(entry);
    if (!key) {
      merged.push(entry);
      continue;
    }

    const existingIndex = indexByKey.get(key);
    if (typeof existingIndex === "number") {
      merged[existingIndex] = entry;
      continue;
    }

    indexByKey.set(key, merged.length);
    merged.push(entry);
  }

  return merged;
}

function reactionEntryKey(entry: TripReactionEntry) {
  return entry.visitorId || entry.userId || entry.id;
}

function commentEntryKey(entry: TripCommentEntry) {
  return entry.id;
}

function travelerEntryKey(entry: TravelerCoordinationEntry) {
  return entry.userId || entry.visitorId || entry.id;
}

export function mergeCollaborativeTripFields(
  existingPlan: TripPlan,
  incomingPlan: TripPlan
): TripPlan {
  return {
    ...existingPlan,
    decisionStatus:
      incomingPlan.decisionStatus ?? existingPlan.decisionStatus,
    decisionUpdatedAt:
      incomingPlan.decisionUpdatedAt ?? existingPlan.decisionUpdatedAt,
    decisionUpdatedBy:
      incomingPlan.decisionUpdatedBy ?? existingPlan.decisionUpdatedBy,
    reactions: mergeUniqueEntries(
      existingPlan.reactions,
      incomingPlan.reactions,
      reactionEntryKey
    ),
    comments: mergeUniqueEntries(
      existingPlan.comments,
      incomingPlan.comments,
      commentEntryKey
    ),
    travelerRoster: mergeUniqueEntries(
      existingPlan.travelerRoster,
      incomingPlan.travelerRoster,
      travelerEntryKey
    ),
  };
}
