/**
 * Shared prompt-length limits for traveler input that can reach paid providers.
 * Keeping the limits in one place makes it easier to tune abuse protection without
 * letting the UI and API drift apart.
 */

export const TRIP_PROMPT_MAX_CHARS = 600;
export const BUILDER_PROMPT_MAX_CHARS = 400;
export const PROMPT_PLACE_SEARCH_MAX_CHARS = 160;

export function normalizePromptText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isPromptTooLong(prompt: string, maxChars: number) {
  return prompt.length > maxChars;
}

export function getPromptLimitError(label: string, maxChars: number) {
  return `${label} must be ${maxChars} characters or fewer.`;
}
