import assert from "node:assert/strict";
import {
  enforceRateLimit,
  enforceSameOrigin,
  isSafeInternalRedirect,
  isValidPublicTripId,
  rejectOversizedJsonRequest,
} from "../lib/apiSecurity";
import {
  ensureTripEditToken,
  sanitizeTripForPersistence,
  sanitizeTripForResponse,
} from "../lib/tripSecurity";
import type { TripPlan } from "../lib/types";

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

function testRouteGuards() {
  const crossSiteRequest = new Request("https://app.example.com/api/save-trip", {
    method: "POST",
    headers: {
      origin: "https://evil.example.com",
    },
  });
  assert.equal(enforceSameOrigin(crossSiteRequest)?.status, 403);

  const sameOriginRequest = new Request("https://app.example.com/api/save-trip", {
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "content-length": "2048",
    },
  });
  assert.equal(enforceSameOrigin(sameOriginRequest), null);
  assert.equal(rejectOversizedJsonRequest(sameOriginRequest, 1024)?.status, 413);

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
}

function main() {
  testTripSanitizers();
  testRouteGuards();
  testIdAndRedirectValidation();
  console.log("Security helper tests passed.");
}

main();
