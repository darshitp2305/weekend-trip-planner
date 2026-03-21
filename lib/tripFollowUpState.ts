"use client";

import { getTripFollowUpStateKey } from "./tripMomentum";
import { TripPlan } from "./types";

const STORAGE_KEY = "weekend-trip-follow-up-state";
export const TRIP_FOLLOW_UP_UPDATED_EVENT = "trip-follow-up-updated";

export type TripFollowUpRecord = {
  tripId: string;
  snoozedUntil?: string;
  lastCopiedAt?: string;
  lastOpenedAt?: string;
  lastSnoozedAt?: string;
  resolvedAt?: string;
  resolvedStateKey?: string;
};

function readRecords() {
  if (typeof window === "undefined") return {} as Record<string, TripFollowUpRecord>;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TripFollowUpRecord>) : {};
  } catch {
    return {};
  }
}

function writeRecords(records: Record<string, TripFollowUpRecord>) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent(TRIP_FOLLOW_UP_UPDATED_EVENT));
  } catch {
    // best effort only
  }
}

function upsertRecord(tripId: string, patch: Partial<TripFollowUpRecord>) {
  const records = readRecords();
  records[tripId] = {
    ...(records[tripId] ?? {}),
    ...patch,
    tripId,
  };
  writeRecords(records);
  return records[tripId];
}

export function getAllTripFollowUpRecords() {
  return Object.values(readRecords());
}

export function getTripFollowUpRecord(tripId: string) {
  return readRecords()[tripId] ?? null;
}

export function markTripFollowUpCopied(tripId: string) {
  return upsertRecord(tripId, {
    lastCopiedAt: new Date().toISOString(),
  });
}

export function markTripFollowUpOpened(tripId: string) {
  return upsertRecord(tripId, {
    lastOpenedAt: new Date().toISOString(),
  });
}

export function snoozeTripFollowUp(tripId: string, days: number) {
  const snoozedUntil = new Date(Date.now() + days * 86400000).toISOString();
  return upsertRecord(tripId, {
    snoozedUntil,
    lastSnoozedAt: new Date().toISOString(),
  });
}

export function resolveTripFollowUp(trip: TripPlan) {
  return upsertRecord(trip.id, {
    resolvedAt: new Date().toISOString(),
    resolvedStateKey: getTripFollowUpStateKey(trip),
    snoozedUntil: undefined,
  });
}

export function reopenTripFollowUp(tripId: string) {
  const records = readRecords();
  if (!records[tripId]) return;

  records[tripId] = {
    tripId,
    lastCopiedAt: records[tripId].lastCopiedAt,
    lastOpenedAt: records[tripId].lastOpenedAt,
    lastSnoozedAt: records[tripId].lastSnoozedAt,
  };

  writeRecords(records);
}

export function isTripFollowUpSnoozed(record?: TripFollowUpRecord | null) {
  if (!record?.snoozedUntil) return false;

  const until = new Date(record.snoozedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
}

export function isTripFollowUpResolved(
  trip: TripPlan,
  record?: TripFollowUpRecord | null
) {
  if (!record?.resolvedAt || !record.resolvedStateKey) return false;
  return record.resolvedStateKey === getTripFollowUpStateKey(trip);
}

export function getTripFollowUpStatus(
  trip: TripPlan,
  record?: TripFollowUpRecord | null
) {
  const snoozed = isTripFollowUpSnoozed(record);
  const resolved = isTripFollowUpResolved(trip, record);

  return {
    active: !snoozed && !resolved,
    snoozed,
    resolved,
    snoozedUntil: record?.snoozedUntil,
    lastCopiedAt: record?.lastCopiedAt,
    lastOpenedAt: record?.lastOpenedAt,
  };
}
