/**
 * Reusable UI component for the budget breakdown section of the planner.
 * Keeping this logic in its own component makes the page-level containers easier to scan and keeps related rendering and state updates together.
 */

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
};

function formatMoney(value?: number) {
  return value !== undefined ? `$${value}` : "-";
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

export default function BudgetBreakdown({ breakdown, notes = [] }: Props) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Budget breakdown
        </h2>
        <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
          Estimated cost split into useful buckets, plus a realistic trip range.
        </p>
        <p className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">
          Food and activity totals are planning estimates based on your current selections.
        </p>
        {notes.map((note) => (
          <p
            key={note}
            className="text-[12px] leading-5 text-slate-500 dark:text-slate-400"
          >
            {note}
          </p>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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

      <div className="mt-4 grid gap-2.5 md:grid-cols-3">
        <TotalCard label="Low" value={breakdown?.totalLow} />
        <TotalCard label="Expected" value={breakdown?.totalExpected} featured />
        <TotalCard label="High" value={breakdown?.totalHigh} />
      </div>
    </section>
  );
}
