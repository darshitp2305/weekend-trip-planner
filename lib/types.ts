export type TripStyle =
  | "chill"
  | "outdoors"
  | "foodie"
  | "solo reset"
  | "adventure";

export interface StyleScores {
  chill: number;
  outdoors: number;
  foodie: number;
  "solo reset": number;
  adventure: number;
}

export interface Activity {
  name: string;
  type: string;
  costEstimate: number;
  bookingLink?: string;
}

export interface HotelOption {
  name: string;
  pricePerNight: number;
  bookingLink: string;
}

export interface FoodSpot {
  name: string;
  tags: string[];
  link?: string;
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
  }[];
  neighborhoods: {
    name: string;
    reason: string;
  }[];
}

export interface TripInput {
  startCity: "Edmonton" | "Calgary";
  maxDriveHours: number;
  budget: number;
  tripLengthDays: number;
  season: string;
  style: TripStyle;
  veganFriendly: boolean;
  includeStaycations: boolean;
  strictBudget: boolean;
}

export interface RankedDestination extends Destination {
  score: number;
  estimatedCost: number;
  budgetBreakdown: BudgetBreakdown;
  matchReasons: string[];
  warnings: string[];
  styleMatchStrength: "strong" | "medium" | "weak" | "poor";
  aiSummary?: string;
  aiItinerary?: string[];
  aiBudgetNote?: string;
  aiBestFit?: string;
}

export interface ItineraryStop {
  time?: string;
  title: string;
  description?: string;
  mapsUrl?: string;
  websiteUrl?: string;
  estimatedCost?: number;
}

export interface ItineraryDayData {
  title?: string;
  summary?: string;
  stops: ItineraryStop[];
}

export interface TripPlan {
  id: string;
  destinationName: string;
  region?: string;
  summary: string;
  driveTimeText: string;
  imageUrl?: string;
  score?: number;
  styleMatchStrength?: RankedDestination["styleMatchStrength"];
  tags: string[];
  budgetBreakdown: BudgetBreakdown;
  hotelOptions: HotelOption[];
  foodSpots: FoodSpot[];
  topActivities: Activity[];
  itineraryDays: ItineraryDayData[];
  aiSummary?: string;
  aiBudgetNote?: string;
  aiBestFit?: string;
  createdAt: string;
}