/**
 * Shared currency-formatting helpers for trip pricing UI.
 * Totals stay rounded to whole dollars, while per-traveler splits keep cents
 * when needed so the displayed share always matches the displayed total.
 */

export function formatWholeCurrency(value?: number): string {
  const safeValue =
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `$${Math.round(safeValue)}`;
}

export function formatSharedCurrency(
  total?: number,
  travelerCount?: number
): string {
  const safeTotal =
    typeof total === "number" && Number.isFinite(total) ? total : 0;
  const safeTravelerCount =
    typeof travelerCount === "number" &&
    Number.isFinite(travelerCount) &&
    travelerCount > 0
      ? travelerCount
      : 1;
  const share = safeTotal / safeTravelerCount;

  if (Math.abs(share - Math.round(share)) < 0.005) {
    return formatWholeCurrency(share);
  }

  return `$${share.toFixed(2)}`;
}
