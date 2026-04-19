/**
 * Helper module for start cities concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  CANADIAN_DEPARTURE_LOCATIONS,
  getDepartureLocation,
  getProvinceNameByCode,
  type StartCityName,
} from "./canadaGeography";

export const START_CITY_OPTIONS = Object.freeze(
  CANADIAN_DEPARTURE_LOCATIONS.map((location) => location.name)
) as readonly StartCityName[];

export type StartCity = StartCityName;

const START_CITY_SET = new Set<string>(START_CITY_OPTIONS);

export function isStartCity(value: unknown): value is StartCity {
  return typeof value === "string" && START_CITY_SET.has(value);
}

export function getPlanningHubForStartCity(
  startCity: StartCity
): "edmonton" | "calgary" | undefined {
  return getDepartureLocation(startCity)?.routingOriginKey;
}

export function getStartCityProvinceName(startCity: StartCity): string | undefined {
  return getProvinceNameByCode(getDepartureLocation(startCity)?.provinceCode);
}
