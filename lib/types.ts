/**
 * Helper module for types concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import type { StartCity } from "./startCities";

export type TripStyle =
  | "chill"
  | "outdoors"
  | "foodie"
  | "solo reset"
  | "adventure"
  | "hidden gems";

export type ActivityFocus = "skiing" | "hiking" | "camping";

export interface StyleScores {
  chill: number;
  outdoors: number;
  foodie: number;
  "solo reset": number;
  adventure: number;
}

export interface Coordinate {
  lat: number;
  lon: number;
  label?: string;
}

export interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: {
    type: string;
    coordinates: number[][];
  } | null;
  origin?: Coordinate;
  destination?: Coordinate;
}

export interface Activity {
  name: string;
  type: string;
  costEstimate: number;
  bookingLink?: string;
  allTrailsUrl?: string;
  shortDescription?: string;
  rating?: number;
  estimatedCost?: number;
  websiteUrl?: string;
  mapsUrl?: string;
  photoRef?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
}

export interface HotelOption {
  name: string;
  pricePerNight?: number;
  totalStayPrice?: number;
  pricingSource?: string;
  availabilityStatus?: "available" | "sold_out" | "unverified";
  availabilitySource?: string;
  hotelId?: string;
  destinationId?: string;
  bookingLink: string;
  shortDescription?: string;
  rating?: number;
  estimatedCost?: number;
  websiteUrl?: string;
  mapsUrl?: string;
  photoRef?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
}

export interface FoodSpot {
  name: string;
  tags: string[];
  link?: string;
  shortDescription?: string;
  category?: string;
  priceLevel?: string;
  rating?: number;
  estimatedCost?: number;
  websiteUrl?: string;
  mapsUrl?: string;
  photoRef?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
}

export interface BudgetBreakdown {
  hotel: number;
  food: number;
  gas: number;
  activities: number;
  misc: number;
  total: number;
  totalLow: number;
  totalExpected: number;
  totalHigh: number;
}

export interface Destination {
  name: string;
  province: string;
  driveHoursFromStart: number;
  bestSeasons: string[];
  avoidSeasons: string[];
  tripStyles: TripStyle[];
  styleScores: StyleScores;
  budgetLevel: "low" | "medium" | "high";
  veganFriendly: boolean;
  summary: string;
  imageUrl?: string;
  latitude?: number;
  longitude?: number;
  topActivities: Activity[];
  hotelOptions: HotelOption[];
  foodSpots: FoodSpot[];
  homeBaseCity: string;
  rawVibes: string[];
  isStaycation: boolean;
}

export interface RawDestination {
  id: string;
  name: string;
  region: string;
  home_base_city: string;
  is_staycation: boolean;
  image_url?: string;
  latitude?: number;
  longitude?: number;
  drive_time_hours_from: {
    edmonton?: number;
    calgary?: number;
    [key: string]: number | undefined;
  };
  distance_km_from: {
    edmonton?: number;
    calgary?: number;
    [key: string]: number | undefined;
  };
  cost_level: "low" | "mid" | "high" | "low_mid";
  vibes: string[];
  best_seasons: string[];
  avoid_seasons: string[];
  style_scores: StyleScores;
  anchor_experiences: {
    title: string;
    type: string;
    description?: string;
    link?: string;
  }[];
  neighborhoods: {
    name: string;
    reason: string;
    link?: string;
  }[];
  hotel_options?: {
    name: string;
    price_per_night?: number;
    booking_link?: string;
    description?: string;
  }[];
  food_spots?: {
    name: string;
    tags?: string[];
    link?: string;
    description?: string;
  }[];
}

export interface TripInput {
  startCity: StartCity;
  maxDriveHours: number;
  maxDriveMinutesBetweenStops: number;
  budget: number;
  budgetPerTraveler: number;
  travelerCount: number;
  tripLengthDays: number;
  season: string;
  style: TripStyle;
  tripPrompt?: string;
  activityFocus?: ActivityFocus;
  veganFriendly: boolean;
  includeStaycations: boolean;
  strictBudget: boolean;
  preferredDestination?: string;
  tripStartDate?: string;
  tripEndDate?: string;
  departureTime?: string;
}

export type ConfidenceLevel = "high" | "medium" | "low";
export type ProviderOutcome =
  | "live_success"
  | "live_unavailable"
  | "fallback_used";

export interface ProviderStatusSummary {
  places?: ProviderOutcome;
  hotels?: ProviderOutcome;
  tripCopy?: ProviderOutcome;
}

export interface LiveDataSummary {
  restaurantCount: number;
  avgRestaurantRating?: number;
  activityCount: number;
  avgActivityRating?: number;
  hotelCount: number;
  usedPlacesData: boolean;
  usedFallbackData: boolean;
}

export interface RankingReason {
  label: string;
  impact: "positive" | "negative" | "neutral";
}

export interface RankedDestination extends Destination {
  score: number;
  estimatedCost: number;
  budgetBreakdown: BudgetBreakdown;
  matchReasons: string[];
  warnings: string[];
  styleMatchStrength: "strong" | "medium" | "weak" | "poor";
  confidence?: ConfidenceLevel;
  liveDataSummary?: LiveDataSummary;
  rankingReasons?: RankingReason[];
  aiSummary?: string;
  aiItinerary?: string[];
  aiBudgetNote?: string;
  aiBestFit?: string;
  routeSummary?: RouteSummary;
  sourceCheckedAt?: string;
  providerStatus?: ProviderStatusSummary;
}

export interface ItineraryStop {
  time?: string;
  title: string;
  description?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  allTrailsUrl?: string;
  estimatedCost?: number;
  kind?: "travel" | "stay" | "food" | "activity";
}

export interface ItineraryDayData {
  title?: string;
  summary?: string;
  stops: ItineraryStop[];
}

export interface TripCustomStop extends ItineraryStop {
  id: string;
  kind: "stay" | "food" | "activity";
  category?: string;
  rating?: number;
  photoRef?: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  insertAfterStopIndex?: number;
  sourcePrompt?: string;
  sourceType?: "custom_request" | "catalog_match";
}

export interface TripSelectionState {
  hotelName?: string;
  foods: Record<string, string>;
  activities: Record<string, string>;
  customStops?: Record<string, TripCustomStop>;
  addedStops?: Record<string, TripCustomStop[]>;
}

export type TripFeedbackReaction = "love" | "maybe" | "pass";
export type TripDecisionStatus =
  | "waiting_on_partner"
  | "needs_changes"
  | "approved"
  | "booked";

export interface TripReactionEntry {
  id: string;
  visitorId: string;
  userId?: string;
  author?: string;
  reaction: TripFeedbackReaction;
  createdAt: string;
}

export interface TripCommentEntry {
  id: string;
  visitorId: string;
  userId?: string;
  author?: string;
  message: string;
  createdAt: string;
}

export interface TripChecklistItemState {
  done: boolean;
  updatedAt?: string;
  updatedBy?: string;
  visitorId?: string;
  userId?: string;
}

export interface TripBookingChecklist {
  reservedStay: TripChecklistItemState;
  exportedCalendar: TripChecklistItemState;
  confirmedTravelers: TripChecklistItemState;
  sharedItinerary: TripChecklistItemState;
}

export type TravelerCoordinationStatus =
  | "pending"
  | "confirmed"
  | "needs_response";

export interface TravelerCoordinationEntry {
  id: string;
  name: string;
  status: TravelerCoordinationStatus;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
  visitorId?: string;
  userId?: string;
}

export interface TripDepartureTask {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  dueAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  visitorId?: string;
  userId?: string;
}

export type TripOperationsNoteKind = "logistics" | "warning" | "update";

export interface TripOperationsNote {
  id: string;
  message: string;
  author?: string;
  kind?: TripOperationsNoteKind;
  createdAt: string;
  visitorId?: string;
  userId?: string;
}

export interface TripDeparturePlan {
  meetupTime?: string;
  meetupLocation?: string;
  transportNote?: string;
  packingNote?: string;
  updatedAt?: string;
  updatedBy?: string;
  visitorId?: string;
  userId?: string;
}

export interface TripPaymentStatus {
  settled: boolean;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
  visitorId?: string;
  userId?: string;
}

export type TripDataSource =
  | "live-google-places"
  | "static-fallback"
  | "static-ranking";

export interface TripPlan {
  id: string;
  editToken?: string;
  destinationName: string;
  startCity?: StartCity;
  region?: string;
  summary: string;
  driveTimeText: string;
  imageUrl?: string;
  score?: number;
  styleMatchStrength?: RankedDestination["styleMatchStrength"];
  confidence?: ConfidenceLevel;
  liveDataSummary?: LiveDataSummary;
  rankingReasons?: RankingReason[];
  tags: string[];
  budgetBreakdown: BudgetBreakdown;
  hotelOptions: HotelOption[];
  foodSpots: FoodSpot[];
  topActivities: Activity[];
  itineraryDays: ItineraryDayData[];
  aiSummary?: string;
  aiBudgetNote?: string;
  aiBestFit?: string;
  routeSummary?: RouteSummary;
  dataSource: TripDataSource;
  createdAt: string;
  sourceCheckedAt?: string;
  providerStatus?: ProviderStatusSummary;
  travelerCount?: number;
  budgetPerTraveler?: number;
  totalBudget?: number;
  tripLengthDays?: number;
  tripStartDate?: string;
  tripEndDate?: string;
  departureTime?: string;
  tripPrompt?: string;
  maxDriveMinutesBetweenStops?: number;
  savedSelectionState?: TripSelectionState;
  status?: "draft" | "finalized";
  finalizedAt?: string;
  decisionStatus?: TripDecisionStatus;
  decisionUpdatedAt?: string;
  decisionUpdatedBy?: string;
  reactions?: TripReactionEntry[];
  comments?: TripCommentEntry[];
  bookingChecklist?: TripBookingChecklist;
  travelerRoster?: TravelerCoordinationEntry[];
  departureTasks?: TripDepartureTask[];
  operationsNotes?: TripOperationsNote[];
  departurePlan?: TripDeparturePlan;
  paymentStatus?: TripPaymentStatus;
  ownerUserId?: string;
  ownerEmail?: string;

  // compatibility fields used by saved trip page / header
  name?: string;
  title?: string;
  destination?: string;
  province?: string;
  driveHoursFromStart?: number;
  rawVibes?: string[];
  source?: TripDataSource;
  isStaycation?: boolean;
  homeBaseCity?: string;
  latitude?: number;
  longitude?: number;
}
