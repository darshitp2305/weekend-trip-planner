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
  return value !== undefined ? `$${value}` : "—";
}

function BudgetChip({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
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
          ? "rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4"
          : "rounded-2xl border border-slate-200 bg-white px-5 py-4"
      }
    >
      <div
        className={
          featured
            ? "text-xs font-semibold uppercase tracking-[0.14em] text-violet-700"
            : "text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"
        }
      >
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        {formatMoney(value)}
      </div>
    </div>
  );
}

export default function BudgetBreakdown({ breakdown }: Props) {
  return (
    <section>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
          Budget breakdown
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          Estimated cost split into useful buckets, plus a realistic trip range.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <BudgetChip label="Gas" value={breakdown?.gas} />
        <BudgetChip label="Hotel" value={breakdown?.hotel} />
        <BudgetChip label="Food" value={breakdown?.food} />
        <BudgetChip label="Activities" value={breakdown?.activities} />
        <BudgetChip label="Misc" value={breakdown?.misc} />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <TotalCard label="Low" value={breakdown?.totalLow} />
        <TotalCard label="Expected" value={breakdown?.totalExpected} featured />
        <TotalCard label="High" value={breakdown?.totalHigh} />
      </div>
    </section>
  );
}