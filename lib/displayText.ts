/**
 * Helper module for display text concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatDisplayText(value?: string | null) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDisplayTag(value?: string | null) {
  const normalized = formatDisplayText(value);
  if (!normalized) {
    return "";
  }

  return toTitleCase(normalized);
}
