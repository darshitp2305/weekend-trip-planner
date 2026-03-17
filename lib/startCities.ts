export const START_CITY_OPTIONS = [
  "Edmonton",
  "Calgary",
  "Red Deer",
  "Lethbridge",
  "Medicine Hat",
  "Grande Prairie",
  "Fort McMurray",
  "Airdrie",
  "St. Albert",
  "Sherwood Park",
] as const;

export type StartCity = (typeof START_CITY_OPTIONS)[number];

const PLANNING_HUB_BY_CITY: Record<StartCity, "Edmonton" | "Calgary"> = {
  Edmonton: "Edmonton",
  Calgary: "Calgary",
  "Red Deer": "Calgary",
  Lethbridge: "Calgary",
  "Medicine Hat": "Calgary",
  "Grande Prairie": "Edmonton",
  "Fort McMurray": "Edmonton",
  Airdrie: "Calgary",
  "St. Albert": "Edmonton",
  "Sherwood Park": "Edmonton",
};

export function isStartCity(value: unknown): value is StartCity {
  return START_CITY_OPTIONS.includes(value as StartCity);
}

export function getPlanningHubForStartCity(
  startCity: StartCity
): "Edmonton" | "Calgary" {
  return PLANNING_HUB_BY_CITY[startCity];
}
