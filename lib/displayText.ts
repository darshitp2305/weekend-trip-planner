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
