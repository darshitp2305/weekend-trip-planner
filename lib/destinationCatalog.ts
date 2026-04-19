import albertaDestinations from "../data/destinations.json";
import canadaDestinations from "../data/destinations-canada.json";
import canadaExpandedDestinations from "../data/destinations-canada-expanded.json";
import type { RawDestination } from "./types";

export const DESTINATION_CATALOG = [
  ...(albertaDestinations as RawDestination[]),
  ...(canadaDestinations as RawDestination[]),
  ...(canadaExpandedDestinations as RawDestination[]),
];

export default DESTINATION_CATALOG;
