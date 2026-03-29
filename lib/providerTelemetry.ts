/**
 * Helper module for provider telemetry concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import { ProviderOutcome } from "./types";

type ProviderName =
  | "openai"
  | "google_places"
  | "hotels_dot_com"
  | "serpapi"
  | "trip_enrichment";

type ProviderTelemetryEvent = {
  provider: ProviderName;
  operation: string;
  outcome: ProviderOutcome;
  detail?: string;
  destination?: string;
  statusCode?: number;
  error?: unknown;
};

type ProviderErrorSummary = {
  name?: string;
  message: string;
  code?: string;
  status?: number;
};

const emittedFingerprints = new Set<string>();

function isVerboseTelemetryEnabled() {
  return process.env.PROVIDER_TELEMETRY_VERBOSE === "1";
}

function toProviderErrorSummary(error: unknown): ProviderErrorSummary | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    const withCode = error as Error & { code?: string; status?: number };
    return {
      name: error.name,
      message: error.message,
      code: withCode.code,
      status: withCode.status,
    };
  }

  if (typeof error === "object") {
    const candidate = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      status?: unknown;
    };

    return {
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Unknown provider error",
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      status:
        typeof candidate.status === "number" ? candidate.status : undefined,
    };
  }

  return {
    message: String(error),
  };
}

function eventFingerprint(event: ProviderTelemetryEvent) {
  const error = toProviderErrorSummary(event.error);
  const verbose = isVerboseTelemetryEnabled();

  return JSON.stringify({
    provider: event.provider,
    operation: event.operation,
    outcome: event.outcome,
    detail: event.detail,
    destination: verbose ? event.destination : undefined,
    statusCode: event.statusCode,
    error: error?.message,
    code: error?.code,
  });
}

export function reportProviderEvent(event: ProviderTelemetryEvent) {
  const fingerprint = eventFingerprint(event);
  const verbose = isVerboseTelemetryEnabled();

  if (!verbose && emittedFingerprints.has(fingerprint)) {
    return;
  }

  emittedFingerprints.add(fingerprint);

  const error = toProviderErrorSummary(event.error);
  const payload = {
    provider: event.provider,
    operation: event.operation,
    outcome: event.outcome,
    detail: event.detail,
    destination: event.destination,
    statusCode: event.statusCode,
    error,
  };

  console.warn("[provider-telemetry]", payload);
}
