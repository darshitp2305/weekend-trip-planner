/**
 * Reusable UI component for the budget breakdown section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */

import type { BudgetOptimizationSummary } from "../lib/types";
import { formatSharedCurrency } from "../lib/priceFormatting";

type BudgetBreakdownData = {
  gas?: number;
  hotel?: number;
  food?: number;
  activities?: number;
  misc?: number;
  totalLow?: number;
  totalExpected?: number;
  totalHigh?: number;
};

type Props = {
  breakdown?: BudgetBreakdownData;
  notes?: string[];
  targetTotalBudget?: number;
  estimatedTotalCost?: number;
  travelerCount?: number;
  fitStatus?: {
    label: string;
    detail: string;
  } | null;
  optimization?: BudgetOptimizationSummary;
  variant?: "full" | "compact";
};

function formatMoney(value?: number) {
  return value !== undefined ? `$${value}` : "-";
}

function optimizationHeadline(summary?: BudgetOptimizationSummary) {
  if (!summary || summary.actions.length === 0) return null;

  if (summary.status === "optimized_to_target") {
    return `Budget-fit defaults saved ${formatMoney(summary.totalSavings)}.`;
  }

  if (summary.status === "optimized_but_over") {
    return `Cheaper defaults saved ${formatMoney(summary.totalSavings)}, but the trip still lands over target.`;
  }

  return null;
}

function fitToneClasses(label?: string) {
  if (label === "Over target") {
    return "border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100";
  }

  return "border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100";
}

function BudgetChip({
  label,
  value,
  info,
}: {
  label: string;
  value?: number;
  info?: string;
}) {
  return (
    <div className="group relative min-w-0 rounded-[1rem] border border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        {info ? (
          <button
            type="button"
            aria-label={`${label} explanation`}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold normal-case tracking-normal text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
            title={info}
          >
            i
          </button>
        ) : null}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-100">
        {formatMoney(value)}
      </div>

      {info ? (
        <div className="pointer-events-none absolute left-3.5 top-full z-10 mt-2 max-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] normal-case tracking-normal text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {info}
        </div>
      ) : null}
    </div>
  );
}

function TotalCard({
  label,
  value,
  featured = false,
}: {
  label: string;
  value?: number;
  featured?: boolean;
}) {
  return (
    <div
      className={
        featured
          ? "rounded-[1rem] border border-[#b2f6df] bg-[#effff8] px-4 py-3.5 dark:border-[#06d8a0]/30 dark:bg-[#06d8a0]/10"
          : "rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-700 dark:bg-slate-900"
      }
    >
      <div
        className={
          featured
            ? "text-[11px] font-semibold uppercase tracking-[0.1em] text-[#048f69] dark:text-[#7decc7]"
            : "text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400"
        }
      >
        {label}
      </div>
      <div className="mt-1.5 text-[1.45rem] font-semibold tracking-tight text-slate-950 dark:text-slate-100">
        {formatMoney(value)}
      </div>
    </div>
  );
}

export default function BudgetBreakdown({
  breakdown,
  notes = [],
  targetTotalBudget,
  estimatedTotalCost,
  travelerCount,
  fitStatus,
  optimization,
  variant = "full",
}: Props) {
  const isCompact = variant === "compact";
  const optimizationTitle = optimizationHeadline(optimization);
  const targetPerTraveler =
    targetTotalBudget && travelerCount
      ? Math.round(targetTotalBudget / Math.max(1, travelerCount))
      : undefined;
  const selectedPerTravelerLabel =
    estimatedTotalCost && travelerCount
      ? formatSharedCurrency(estimatedTotalCost, travelerCount)
      : "-";

  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2
          className={`font-semibold tracking-tight text-slate-950 dark:text-slate-100 ${
            isCompact ? "text-lg" : "text-xl"
          }`}
        >
          {isCompact ? "Budget snapshot" : "Budget breakdown"}
        </h2>
        <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
          {isCompact
            ? "Current estimate, target, and range."
            : "Estimated cost split into useful buckets, plus a realistic trip range."}
        </p>
        {!isCompact ? (
          <p className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">
            Food and activity totals are planning estimates based on your current selections.
          </p>
        ) : null}
        {(isCompact ? notes.slice(0, 1) : notes).map((note) => (
          <p
            key={note}
            className="text-[12px] leading-5 text-slate-500 dark:text-slate-400"
          >
            {note}
          </p>
        ))}
      </div>

      {fitStatus || targetTotalBudget ? (
        <div
          className={`mt-4 rounded-[1.2rem] border ${
            isCompact ? "px-3 py-3" : "px-4 py-4"
          } ${fitToneClasses(
            fitStatus?.label
          )}`}
        >
          <div
            className={
              isCompact
                ? "flex flex-col gap-3"
                : "flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
            }
          >
            <div className={isCompact ? "min-w-0" : "max-w-xl"}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-current/70">
                Budget fit
              </div>
              <div className="mt-1 text-lg font-semibold tracking-tight text-current">
                {fitStatus?.label ?? "Budget target loaded"}
              </div>
              {fitStatus?.detail ? (
                <p
                  className={`mt-1 text-sm text-current/80 ${
                    isCompact ? "leading-5" : "leading-6"
                  }`}
                >
                  {fitStatus.detail}
                </p>
              ) : (
                <p
                  className={`mt-1 text-sm text-current/80 ${
                    isCompact ? "leading-5" : "leading-6"
                  }`}
                >
                  Use the current total against your saved target to keep the draft realistic.
                </p>
              )}
            </div>

            <div
              className={
                isCompact
                  ? "grid grid-cols-2 gap-2"
                  : "grid gap-2 sm:grid-cols-3 lg:min-w-[360px]"
              }
            >
              <div className="rounded-[1rem] border border-current/10 bg-white/70 px-3.5 py-3 dark:bg-slate-950/20">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-current/60">
                  Target total
                </div>
                <div className="mt-1 text-lg font-semibold text-current">
                  {formatMoney(targetTotalBudget)}
                </div>
              </div>
              <div className="rounded-[1rem] border border-current/10 bg-white/70 px-3.5 py-3 dark:bg-slate-950/20">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-current/60">
                  Current total
                </div>
                <div className="mt-1 text-lg font-semibold text-current">
                  {formatMoney(estimatedTotalCost)}
                </div>
              </div>
              <div
                className={`rounded-[1rem] border border-current/10 bg-white/70 px-3.5 py-3 dark:bg-slate-950/20 ${
                  isCompact ? "col-span-2" : ""
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-current/60">
                  Per traveler
                </div>
                <div className="mt-1 text-lg font-semibold text-current">
                  {selectedPerTravelerLabel}
                </div>
                {targetPerTraveler ? (
                  <div className="mt-1 text-[11px] text-current/60">
                    Target {formatMoney(targetPerTraveler)} each
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {!isCompact && optimization && optimizationTitle ? (
            <div className="mt-4 rounded-[1rem] border border-current/10 bg-white/70 px-4 py-3.5 dark:bg-slate-950/20">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-current/60">
                Budget-fit defaults
              </div>
              <p className="mt-1 text-sm leading-6 text-current/85">
                {optimizationTitle}
              </p>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-current/75">
                {optimization.actions.slice(0, 3).map((action) => (
                  <li key={`${action.kind}-${action.from}-${action.to}`}>
                    {action.label}: {action.from} to {action.to} ({formatMoney(action.savings)} saved)
                  </li>
                ))}
                {optimization.actions.length > 3 ? (
                  <li>
                    {optimization.actions.length - 3} more cost-cutting swap
                    {optimization.actions.length - 3 === 1 ? "" : "s"} applied.
                  </li>
                ) : null}
                {optimization.status === "optimized_but_over" &&
                optimization.targetTotalBudget ? (
                  <li>
                    Cheapest matching picks still land about{" "}
                    {formatMoney(
                      Math.max(
                        0,
                        optimization.optimizedTotal - optimization.targetTotalBudget
                      )
                    )}{" "}
                    over target.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={`mt-4 grid gap-2.5 ${
          isCompact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
        }`}
      >
        <BudgetChip label="Gas" value={breakdown?.gas} />
        <BudgetChip label="Hotel" value={breakdown?.hotel} />
        <BudgetChip label="Food" value={breakdown?.food} />
        <BudgetChip label="Activities" value={breakdown?.activities} />
        <BudgetChip
          label="Misc"
          value={breakdown?.misc}
          info="10% contingency buffer for small trip costs like parking, park or conservation passes, tips, snacks, and incidental fees."
        />
      </div>

      <div className={`mt-4 grid gap-2.5 ${isCompact ? "grid-cols-3" : "md:grid-cols-3"}`}>
        <TotalCard label="Low" value={breakdown?.totalLow} />
        <TotalCard label="Expected" value={breakdown?.totalExpected} featured />
        <TotalCard label="High" value={breakdown?.totalHigh} />
      </div>
    </section>
  );
}
