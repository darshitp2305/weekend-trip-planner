export function isIsoDate(value?: string): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function addDaysToIsoDate(
  startDate?: string,
  daysToAdd = 0
): string | undefined {
  if (!isIsoDate(startDate)) return undefined;

  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;

  date.setDate(date.getDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

export function deriveTripEndDate(
  startDate?: string,
  tripLengthDays = 2
): string | undefined {
  return addDaysToIsoDate(startDate, Math.max(0, tripLengthDays - 1));
}

export function formatDisplayDate(value?: string): string | undefined {
  if (!isIsoDate(value)) return undefined;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;

  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateRange(startDate?: string, endDate?: string): string | undefined {
  const start = formatDisplayDate(startDate);
  const end = formatDisplayDate(endDate);

  if (start && end) return `${start} - ${end}`;
  return start ?? end;
}
