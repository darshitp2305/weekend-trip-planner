import assert from "node:assert/strict";
import {
  enforceRateLimit,
  enforceSameOrigin,
  isAllowedExternalFetchUrl,
  isSafeInternalRedirect,
  isValidPublicTripId,
  rejectOversizedJsonRequest,
} from "../lib/apiSecurity";
import {
  ensureTripEditToken,
  mergeCollaborativeTripFields,
  sanitizeTripForPersistence,
  sanitizeTripForResponse,
} from "../lib/tripSecurity";
import type { TripPlan } from "../lib/types";
import { sanitizeExternalNavigationUrl } from "../lib/urlSafety";

function sampleTrip(): TripPlan {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    editToken: "secret-edit-token-1234567890",
    destinationName: "Banff",
    summary: "Test trip",
    driveTimeText: "4 hours",
    tags: ["mountains"],
    budgetBreakdown: {
      hotel: 200,
      food: 100,
      gas: 50,
      activities: 75,
      misc: 0,
      total: 425,
      totalLow: 400,
      totalExpected: 425,
      totalHigh: 450,
    },
    hotelOptions: [],
    foodSpots: [],
    topActivities: [],
    itineraryDays: [],
    dataSource: "static-fallback",
    createdAt: "2026-03-22T00:00:00.000Z",
    status: "draft",
    ownerUserId: "user-123",
    ownerEmail: "owner@example.com",
    routeSummary: {
      distanceMeters: 1000,
      durationSeconds: 900,
      geometry: {
        type: "LineString",
        coordinates: [
          [-115.57, 51.17],
          [-115.56, 51.18],
        ],
      },
    },
  };
}

function testTripSanitizers() {
  const withToken = ensureTripEditToken({
    id: "550e8400-e29b-41d4-a716-446655440001",
  });
  assert.ok(withToken.editToken);
  assert.ok(withToken.editToken.length >= 32);

  const plan = sampleTrip();
  const persisted = sanitizeTripForPersistence(plan);
  assert.equal(persisted.routeSummary?.geometry, undefined);

  const publicResponse = sanitizeTripForResponse(plan);
  assert.equal(publicResponse.editToken, undefined);
  assert.equal(publicResponse.ownerUserId, undefined);
  assert.equal(publicResponse.ownerEmail, undefined);

  const privateResponse = sanitizeTripForResponse(plan, {
    includeEditToken: true,
    includeOwnerFields: true,
  });
  assert.equal(privateResponse.editToken, plan.editToken);
  assert.equal(privateResponse.ownerUserId, plan.ownerUserId);
  assert.equal(privateResponse.ownerEmail, plan.ownerEmail);
}

function testCollaborativeTripMerge() {
  const existing = {
    ...sampleTrip(),
    status: "finalized" as const,
    decisionStatus: "waiting_on_partner" as const,
    decisionUpdatedAt: "2026-03-22T10:00:00.000Z",
    decisionUpdatedBy: "Owner",
    reactions: [
      {
        id: "reaction-1",
        visitorId: "visitor-a",
        author: "Alex",
        reaction: "love" as const,
        createdAt: "2026-03-22T10:00:00.000Z",
      },
    ],
    comments: [
      {
        id: "comment-1",
        visitorId: "visitor-a",
        author: "Alex",
        message: "Looks good.",
        createdAt: "2026-03-22T10:01:00.000Z",
      },
    ],
    travelerRoster: [
      {
        id: "traveler-1",
        name: "Alex",
        status: "confirmed" as const,
      },
    ],
  };

  const incoming = {
    ...existing,
    destinationName: "Hacked destination",
    summary: "Malicious overwrite attempt",
    decisionStatus: "approved" as const,
    decisionUpdatedAt: "2026-03-22T12:00:00.000Z",
    decisionUpdatedBy: "Jamie",
    reactions: [
      {
        id: "reaction-2",
        visitorId: "visitor-a",
        author: "Alex",
        reaction: "pass" as const,
        createdAt: "2026-03-22T12:00:00.000Z",
      },
      {
        id: "reaction-3",
        visitorId: "visitor-b",
        author: "Jamie",
        reaction: "maybe" as const,
        createdAt: "2026-03-22T12:01:00.000Z",
      },
    ],
    comments: [
      {
        id: "comment-2",
        visitorId: "visitor-b",
        author: "Jamie",
        message: "Can we leave earlier?",
        createdAt: "2026-03-22T12:02:00.000Z",
      },
    ],
    travelerRoster: [
      {
        id: "traveler-2",
        name: "Jamie",
        status: "needs_response" as const,
      },
    ],
  };

  const merged = mergeCollaborativeTripFields(existing, incoming);

  assert.equal(merged.destinationName, existing.destinationName);
  assert.equal(merged.summary, existing.summary);
  assert.equal(merged.ownerUserId, existing.ownerUserId);
  assert.equal(merged.decisionStatus, "approved");
  assert.equal(merged.decisionUpdatedBy, "Jamie");
  assert.equal(merged.reactions?.length, 2);
  assert.equal(
    merged.reactions?.find((entry) => entry.visitorId === "visitor-a")?.reaction,
    "pass"
  );
  assert.equal(merged.comments?.length, 2);
  assert.equal(
    merged.comments?.some((entry) => entry.id === "comment-1"),
    true
  );
  assert.equal(
    merged.comments?.some((entry) => entry.id === "comment-2"),
    true
  );
  assert.equal(merged.travelerRoster?.length, 2);
  assert.equal(
    merged.travelerRoster?.some((entry) => entry.id === "traveler-1"),
    true
  );
  assert.equal(
    merged.travelerRoster?.some((entry) => entry.id === "traveler-2"),
    true
  );
}

function testRouteGuards() {
  const crossSiteRequest = new Request("https://app.example.com/api/save-trip", {
    method: "POST",
    headers: {
      origin: "https://evil.example.com",
    },
  });
  assert.equal(enforceSameOrigin(crossSiteRequest)?.status, 403);

  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;
  const sameOriginRequest = new Request("https://app.example.com/api/save-trip", {
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "content-length": "2048",
    },
  });
  assert.equal(enforceSameOrigin(sameOriginRequest), null);
  assert.equal(rejectOversizedJsonRequest(sameOriginRequest, 1024)?.status, 413);

  env.NODE_ENV = "development";
  const localLoopbackRequest = new Request("http://127.0.0.1:3000/api/rank-trips", {
    method: "POST",
    headers: {
      origin: "http://localhost:3001",
    },
  });
  assert.equal(enforceSameOrigin(localLoopbackRequest), null);
  env.NODE_ENV = originalNodeEnv;

  const rateLimitKey = `security-test-${Date.now()}`;
  const limitedRequest = new Request("https://app.example.com/api/rank-trips");
  assert.equal(
    enforceRateLimit(limitedRequest, {
      key: rateLimitKey,
      limit: 1,
      windowMs: 60_000,
    }),
    null
  );
  assert.equal(
    enforceRateLimit(limitedRequest, {
      key: rateLimitKey,
      limit: 1,
      windowMs: 60_000,
    })?.status,
    429
  );
}

function testIdAndRedirectValidation() {
  assert.equal(
    isValidPublicTripId("550e8400-e29b-41d4-a716-446655440000"),
    true
  );
  assert.equal(isValidPublicTripId("../etc/passwd"), false);
  assert.equal(isValidPublicTripId("user:123"), false);

  assert.equal(isSafeInternalRedirect("/trip/123"), true);
  assert.equal(isSafeInternalRedirect("//evil.example.com"), false);
  assert.equal(isSafeInternalRedirect("https://evil.example.com"), false);

  assert.equal(
    isAllowedExternalFetchUrl(
      "https://lh3.googleusercontent.com/photo.jpg",
      ["googleusercontent.com", "googleapis.com"]
    ),
    true
  );
  assert.equal(
    isAllowedExternalFetchUrl(
      "https://places.googleapis.com/v1/photo",
      ["googleusercontent.com", "googleapis.com"]
    ),
    true
  );
  assert.equal(
    isAllowedExternalFetchUrl(
      "http://lh3.googleusercontent.com/photo.jpg",
      ["googleusercontent.com"]
    ),
    false
  );
  assert.equal(
    isAllowedExternalFetchUrl(
      "https://googleusercontent.com.evil.example/photo.jpg",
      ["googleusercontent.com"]
    ),
    false
  );
  assert.equal(
    isAllowedExternalFetchUrl(
      "https://user:pass@lh3.googleusercontent.com/photo.jpg",
      ["googleusercontent.com"]
    ),
    false
  );
}

function testNavigationUrlSanitizer() {
  assert.equal(
    sanitizeExternalNavigationUrl(
      "https://example.com/stay?utm_source=test&fbclid=123"
    ),
    "https://example.com/stay"
  );
  assert.equal(
    sanitizeExternalNavigationUrl("http://example.com/trip?utm_campaign=spring"),
    "http://example.com/trip"
  );
  assert.equal(
    sanitizeExternalNavigationUrl("javascript:alert('xss')"),
    undefined
  );
  assert.equal(
    sanitizeExternalNavigationUrl("data:text/html,<script>alert(1)</script>"),
    undefined
  );
  assert.equal(
    sanitizeExternalNavigationUrl("https://user:pass@example.com/private"),
    undefined
  );
  assert.equal(
    sanitizeExternalNavigationUrl("https://www.google.com/aclk?foo=bar"),
    undefined
  );
  assert.equal(sanitizeExternalNavigationUrl("/trip/123"), undefined);
}

function main() {
  testTripSanitizers();
  testCollaborativeTripMerge();
  testRouteGuards();
  testIdAndRedirectValidation();
  testNavigationUrlSanitizer();
  console.log("Security helper tests passed.");
}

main();
