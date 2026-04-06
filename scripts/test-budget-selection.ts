import { calculateSelectedBudget } from "../lib/tripSelections";
import { BudgetBreakdown, HotelOption, ItineraryDayData, TripSelectionState } from "../lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const hotelOptions: HotelOption[] = [
  {
    name: "Charmed Resorts Crowsnest Pass",
    bookingLink: "",
    shortDescription: "Mountain resort base in Blairmore.",
    rating: 4.7,
    availabilityStatus: "unverified",
  },
];

const itineraryDays: ItineraryDayData[] = [
  {
    title: "Day 1",
    stops: [
      {
        kind: "stay",
        title: "Check in at Charmed Resorts Crowsnest Pass",
      },
    ],
  },
  {
    title: "Day 2",
    stops: [],
  },
  {
    title: "Day 3",
    stops: [],
  },
];

const selection: TripSelectionState = {
  hotelName: "Charmed Resorts Crowsnest Pass",
  foods: {},
  activities: {},
};

const initialFallback: BudgetBreakdown = {
  hotel: 300,
  food: 400,
  gas: 60,
  activities: 120,
  misc: 88,
  total: 968,
  totalLow: 870,
  totalExpected: 968,
  totalHigh: 1115,
};

const firstPass = calculateSelectedBudget({
  tripLengthDays: 3,
  travelerCount: 4,
  hotelOptions,
  foodSpots: [],
  activities: [],
  itineraryDays,
  selection,
  fallbackBreakdown: initialFallback,
});

const secondPass = calculateSelectedBudget({
  tripLengthDays: 3,
  travelerCount: 4,
  hotelOptions,
  foodSpots: [],
  activities: [],
  itineraryDays,
  selection,
  fallbackBreakdown: firstPass,
});

const corruptedFallback = calculateSelectedBudget({
  tripLengthDays: 3,
  travelerCount: 4,
  hotelOptions,
  foodSpots: [],
  activities: [],
  itineraryDays,
  selection,
  fallbackBreakdown: {
    ...initialFallback,
    hotel: 80344,
    misc: 8092,
    total: 88916,
    totalExpected: 88916,
    totalHigh: 102254,
  },
});

assert(
  firstPass.hotel === 300,
  `Expected first pass hotel cost to stay on the saved fallback, got ${firstPass.hotel}.`
);
assert(
  secondPass.hotel === firstPass.hotel,
  `Expected unpriced hotel estimate to stay stable across recalculations, got ${firstPass.hotel} then ${secondPass.hotel}.`
);
assert(
  secondPass.totalExpected === firstPass.totalExpected,
  `Expected total budget to stay stable across recalculations, got ${firstPass.totalExpected} then ${secondPass.totalExpected}.`
);
assert(
  corruptedFallback.hotel === 360,
  `Expected corrupted fallback hotel cost to recover to a sane estimate, got ${corruptedFallback.hotel}.`
);

console.log("Budget selection regression checks passed.");
