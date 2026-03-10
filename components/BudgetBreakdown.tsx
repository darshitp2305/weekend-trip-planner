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

function BudgetBox({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">
        {formatMoney(value)}
      </div>
    </div>
  );
}

function TotalBox({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">
        {formatMoney(value)}
      </div>
    </div>
  );
}

export default function BudgetBreakdown({ breakdown }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold text-gray-900">Budget breakdown</h2>
      <p className="mt-1 text-sm text-gray-600">
        Estimated cost split into buckets, with a realistic range instead of fake precision.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <BudgetBox label="Gas" value={breakdown?.gas} />
        <BudgetBox label="Hotel" value={breakdown?.hotel} />
        <BudgetBox label="Food" value={breakdown?.food} />
        <BudgetBox label="Activities" value={breakdown?.activities} />
        <BudgetBox label="Misc" value={breakdown?.misc} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <TotalBox label="Low" value={breakdown?.totalLow} />
        <TotalBox label="Expected" value={breakdown?.totalExpected} />
        <TotalBox label="High" value={breakdown?.totalHigh} />
      </div>
    </section>
  );
}