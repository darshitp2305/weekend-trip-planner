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
};

function formatMoney(value?: number) {
  return value !== undefined ? `$${value}` : "-";
}

function BudgetChip({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  return (
    <div className="min-w-0 rounded-[1rem] border border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-100">
        {formatMoney(value)}
      </div>
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
          ? "rounded-[1rem] border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-500/30 dark:bg-violet-500/10"
          : "rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-700 dark:bg-slate-900"
      }
    >
      <div
        className={
          featured
            ? "text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300"
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

export default function BudgetBreakdown({ breakdown }: Props) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
          Budget breakdown
        </h2>
        <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">
          Estimated cost split into useful buckets, plus a realistic trip range.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <BudgetChip label="Gas" value={breakdown?.gas} />
        <BudgetChip label="Hotel" value={breakdown?.hotel} />
        <BudgetChip label="Food" value={breakdown?.food} />
        <BudgetChip label="Activities" value={breakdown?.activities} />
        <BudgetChip label="Misc" value={breakdown?.misc} />
      </div>

      <div className="mt-4 grid gap-2.5 md:grid-cols-3">
        <TotalCard label="Low" value={breakdown?.totalLow} />
        <TotalCard label="Expected" value={breakdown?.totalExpected} featured />
        <TotalCard label="High" value={breakdown?.totalHigh} />
      </div>
    </section>
  );
}
