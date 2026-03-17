export function isIsoDate(value?: string): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function formatDateAsIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayIsoDate(referenceDate: Date = new Date()): string {
  return formatDateAsIso(referenceDate);
}

function getUtcDayValue(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

function getDateFromIso(value?: string): Date | undefined {
  if (!isIsoDate(value)) return undefined;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;

  return date;
}

export function clampTripStartDate(
  value?: string,
  minimumDate = getTodayIsoDate()
): string {
  if (!isIsoDate(value) || value < minimumDate) {
    return minimumDate;
  }

  return value;
}

export function addDaysToIsoDate(
  startDate?: string,
  daysToAdd = 0
): string | undefined {
  if (!isIsoDate(startDate)) return undefined;

  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;

  date.setDate(date.getDate() + daysToAdd);
  return formatDateAsIso(date);
}

export function deriveTripEndDate(
  startDate?: string,
  tripLengthDays = 2
): string | undefined {
  return addDaysToIsoDate(startDate, Math.max(0, tripLengthDays - 1));
}

export function deriveTripLengthDays(
  startDate?: string,
  endDate?: string
): number | undefined {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return undefined;

  const startValue = getUtcDayValue(startDate);
  const endValue = getUtcDayValue(endDate);
  if (startValue === undefined || endValue === undefined || endValue < startValue) {
    return undefined;
  }

  return Math.round((endValue - startValue) / 86_400_000) + 1;
}

export function clampTripEndDate(
  value?: string,
  startDate?: string,
  maxTripLengthDays = 7
): string | undefined {
  if (!isIsoDate(startDate)) return undefined;

  const maxEndDate =
    deriveTripEndDate(startDate, Math.max(1, maxTripLengthDays)) ?? startDate;

  if (!isIsoDate(value) || value < startDate) {
    return startDate;
  }

  if (value > maxEndDate) {
    return maxEndDate;
  }

  return value;
}

export function deriveSeasonFromDateRange(
  startDate?: string,
  endDate?: string
): "Spring" | "Summer" | "Fall" | "Winter" {
  const startValue = getUtcDayValue(startDate ?? "");
  const endValue = getUtcDayValue(endDate ?? "");
  const midpointValue =
    startValue !== undefined
      ? endValue !== undefined && endValue >= startValue
        ? startValue + Math.floor((endValue - startValue) / 2)
        : startValue
      : undefined;

  const date =
    midpointValue !== undefined
      ? new Date(midpointValue)
      : getDateFromIso(startDate) ?? getDateFromIso(endDate) ?? new Date();

  const month = date.getUTCMonth() + 1;

  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  if (month >= 9 && month <= 11) return "Fall";
  return "Winter";
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
