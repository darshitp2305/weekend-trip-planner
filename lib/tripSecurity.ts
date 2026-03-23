import type { TripPlan } from "./types";

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
