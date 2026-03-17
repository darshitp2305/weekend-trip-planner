"use client";

import { CSSProperties, useState } from "react";
import rawDestinations from "../data/destinations.json";
import {
  clampTripEndDate,
  clampTripStartDate,
  deriveTripEndDate,
  deriveTripLengthDays,
  deriveSeasonFromDateRange,
  formatDateRange,
  getTodayIsoDate,
} from "../lib/tripDates";
import { RankedDestination, TripInput, TripStyle } from "../lib/types";

type Props = {
  onGenerate?: (input: TripInput) => Promise<void> | void;
  onSubmit?: (input: TripInput) => Promise<void> | void;
  loading?: boolean;
  results?: RankedDestination[];
  initialInput?: Partial<TripInput>;
};

type FormState = {
  startCity: "Edmonton" | "Calgary";
  maxDriveHours: string;
  budgetPerTraveler: string;
  travelerCount: string;
  style: TripStyle;
  veganFriendly: boolean;
  includeStaycations: boolean;
  strictBudget: boolean;
  preferredDestination: string;
  tripStartDate: string;
  tripEndDate: string;
};

const DEFAULT_FORM: FormState = {
  startCity: "Edmonton",
  maxDriveHours: "5",
  budgetPerTraveler: "300",
  travelerCount: "2",
  style: "foodie",
  veganFriendly: false,
  includeStaycations: false,
  strictBudget: false,
  preferredDestination: "",
  tripStartDate: "",
  tripEndDate: "",
};

function buildFormState(
  initialInput?: Partial<TripInput>,
  minimumDate = getTodayIsoDate()
): FormState {
  const tripStartDate = clampTripStartDate(
    initialInput?.tripStartDate,
    minimumDate
  );
  const requestedTripEndDate =
    initialInput?.tripEndDate ??
    deriveTripEndDate(tripStartDate, initialInput?.tripLengthDays ?? 2);
  const tripEndDate =
    clampTripEndDate(requestedTripEndDate, tripStartDate, 7) ?? tripStartDate;

  return {
    ...DEFAULT_FORM,
    startCity: initialInput?.startCity === "Calgary" ? "Calgary" : "Edmonton",
    maxDriveHours: String(initialInput?.maxDriveHours ?? 5),
    budgetPerTraveler: String(initialInput?.budgetPerTraveler ?? 300),
    travelerCount: String(initialInput?.travelerCount ?? 2),
    style: initialInput?.style ?? "foodie",
    veganFriendly: Boolean(initialInput?.veganFriendly),
    includeStaycations: Boolean(initialInput?.includeStaycations),
    strictBudget: Boolean(initialInput?.strictBudget),
    preferredDestination: initialInput?.preferredDestination ?? "",
    tripStartDate,
    tripEndDate,
  };
}

const TRIP_STYLES: TripStyle[] = [
  "chill",
  "outdoors",
  "foodie",
  "solo reset",
  "adventure",
  "hidden gems",
];

const DESTINATION_OPTIONS = Array.from(
  new Set(
    (rawDestinations as Array<{ name?: string }>)
      .map((destination) => destination.name?.trim())
      .filter((name): name is string => Boolean(name))
  )
).sort((a, b) => a.localeCompare(b));

function parsePositiveInt(value: string, fallback: number) {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return fallback;

  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return parsed;
}

function normalizeNumericString(
  value: string,
  options: { min: number; max: number; fallback: number }
) {
  const parsed = parsePositiveInt(value, options.fallback);
  const clamped = Math.min(options.max, Math.max(options.min, parsed));
  return String(clamped);
}

function displayStyleLabel(style: TripStyle) {
  switch (style) {
    case "solo reset":
      return "Solo reset";
    case "foodie":
      return "Foodie";
    case "outdoors":
      return "Outdoors";
    case "adventure":
      return "Adventure";
    case "chill":
      return "Chill";
    case "hidden gems":
      return "Hidden gems";
    default:
      return style;
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-medium text-slate-700"
    >
      {children}
    </label>
  );
}

function ToggleRow({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
      <span className="text-sm font-medium text-slate-800">{title}</span>

      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-violet-500" />
        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
      </div>
    </label>
  );
}

const DATE_INPUT_CLASS =
  "h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-date-and-time-value]:text-slate-900 [&::-webkit-datetime-edit]:text-slate-900 [&::-webkit-datetime-edit-fields-wrapper]:text-slate-900";
const DATE_INPUT_STYLE: CSSProperties = {
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  opacity: 1,
};

export default function TripForm({
  onGenerate,
  onSubmit,
  loading = false,
  results = [],
  initialInput,
}: Props) {
  const minTripStartDate = getTodayIsoDate();
  const [form, setForm] = useState<FormState>(() =>
    buildFormState(initialInput, minTripStartDate)
  );
  const maxTripEndDate =
    deriveTripEndDate(form.tripStartDate, 7) ?? form.tripStartDate;
  const tripDateRange = formatDateRange(
    form.tripStartDate || undefined,
    form.tripEndDate || undefined
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleNumericChange(
    key: "maxDriveHours" | "budgetPerTraveler" | "travelerCount",
    value: string
  ) {
    const digitsOnly = value.replace(/[^\d]/g, "");
    updateField(key, digitsOnly as FormState[typeof key]);
  }

  function handleNumericBlur(
    key: "maxDriveHours" | "budgetPerTraveler" | "travelerCount"
  ) {
    if (key === "maxDriveHours") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 1,
          max: 12,
          fallback: 5,
        }) as FormState[typeof key]
      );
      return;
    }

    if (key === "budgetPerTraveler") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 50,
          max: 5000,
          fallback: 300,
        }) as FormState[typeof key]
      );
      return;
    }

    if (key === "travelerCount") {
      updateField(
        key,
        normalizeNumericString(form[key], {
          min: 1,
          max: 12,
          fallback: 2,
        }) as FormState[typeof key]
      );
      return;
    }
  }

  function handleTripStartDateChange(value: string) {
    const tripStartDate = clampTripStartDate(value, minTripStartDate);

    setForm((prev) => {
      const tripLengthDays =
        deriveTripLengthDays(prev.tripStartDate, prev.tripEndDate) ?? 2;
      const nextTripEndDate =
        clampTripEndDate(
          deriveTripEndDate(tripStartDate, tripLengthDays),
          tripStartDate,
          7
        ) ??
        tripStartDate;

      return {
        ...prev,
        tripStartDate,
        tripEndDate: nextTripEndDate,
      };
    });
  }

  function handleTripEndDateChange(value: string) {
    updateField(
      "tripEndDate",
      (clampTripEndDate(value, form.tripStartDate, 7) ??
        form.tripStartDate) as FormState["tripEndDate"]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!form.tripStartDate) {
      return;
    }

    const travelerCount = Math.min(
      12,
      Math.max(1, parsePositiveInt(form.travelerCount, 2))
    );

    const budgetPerTraveler = Math.min(
      5000,
      Math.max(50, parsePositiveInt(form.budgetPerTraveler, 300))
    );
    const tripStartDate = clampTripStartDate(
      form.tripStartDate,
      minTripStartDate
    );
    const tripEndDate =
      clampTripEndDate(form.tripEndDate, tripStartDate, 7) ?? tripStartDate;
    const tripLengthDays =
      deriveTripLengthDays(tripStartDate, tripEndDate) ?? 1;
    const season = deriveSeasonFromDateRange(tripStartDate, tripEndDate);

    const cleanedInput: TripInput = {
      startCity: form.startCity,
      maxDriveHours: Math.min(
        12,
        Math.max(1, parsePositiveInt(form.maxDriveHours, 5))
      ),
      budget: travelerCount * budgetPerTraveler,
      budgetPerTraveler,
      travelerCount,
      tripLengthDays,
      season,
      style: form.style,
      veganFriendly: form.veganFriendly,
      includeStaycations: form.includeStaycations,
      strictBudget: form.strictBudget,
      preferredDestination: form.preferredDestination.trim() || undefined,
      tripStartDate,
      tripEndDate,
    };

    setForm((prev) => ({
      ...prev,
      maxDriveHours: String(cleanedInput.maxDriveHours),
      budgetPerTraveler: String(cleanedInput.budgetPerTraveler),
      travelerCount: String(cleanedInput.travelerCount),
      tripStartDate,
      tripEndDate,
    }));

    const submitHandler = onGenerate ?? onSubmit;

    if (typeof submitHandler !== "function") {
      console.error("TripForm requires an onGenerate or onSubmit prop.");
      return;
    }

    await submitHandler(cleanedInput);
  }

  const liveTravelerCount = Math.min(
    12,
    Math.max(1, parsePositiveInt(form.travelerCount, 2))
  );

  const liveBudgetPerTraveler = Math.min(
    5000,
    Math.max(50, parsePositiveInt(form.budgetPerTraveler, 300))
  );

  const totalBudget = liveTravelerCount * liveBudgetPerTraveler;

  return (
    <section className="w-full">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <FieldLabel htmlFor="startCity">Start city</FieldLabel>
            <select
              id="startCity"
              value={form.startCity}
              onChange={(e) =>
                updateField("startCity", e.target.value as FormState["startCity"])
              }
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="Edmonton">Edmonton</option>
              <option value="Calgary">Calgary</option>
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="style">Trip style</FieldLabel>
            <select
              id="style"
              value={form.style}
              onChange={(e) => updateField("style", e.target.value as TripStyle)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              {TRIP_STYLES.map((style) => (
                <option key={style} value={style}>
                  {displayStyleLabel(style)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel htmlFor="budgetPerTraveler">
              Budget per traveller ($)
            </FieldLabel>
            <input
              id="budgetPerTraveler"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.budgetPerTraveler}
              onChange={(e) =>
                handleNumericChange("budgetPerTraveler", e.target.value)
              }
              onBlur={() => handleNumericBlur("budgetPerTraveler")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <FieldLabel htmlFor="travelerCount">How many people</FieldLabel>
            <input
              id="travelerCount"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.travelerCount}
              onChange={(e) => handleNumericChange("travelerCount", e.target.value)}
              onBlur={() => handleNumericBlur("travelerCount")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <FieldLabel htmlFor="maxDriveHours">Drive hours</FieldLabel>
            <input
              id="maxDriveHours"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={form.maxDriveHours}
              onChange={(e) => handleNumericChange("maxDriveHours", e.target.value)}
              onBlur={() => handleNumericBlur("maxDriveHours")}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div>
            <FieldLabel htmlFor="tripStartDate">Trip start date</FieldLabel>
            <input
              id="tripStartDate"
              type="date"
              min={minTripStartDate}
              required
              value={form.tripStartDate}
              onChange={(e) => handleTripStartDateChange(e.target.value)}
              className={DATE_INPUT_CLASS}
              style={DATE_INPUT_STYLE}
            />
          </div>

          <div>
            <FieldLabel htmlFor="tripEndDate">Trip end date</FieldLabel>
            <input
              id="tripEndDate"
              type="date"
              min={form.tripStartDate}
              max={maxTripEndDate}
              required
              value={form.tripEndDate}
              onChange={(e) => handleTripEndDateChange(e.target.value)}
              className={DATE_INPUT_CLASS}
              style={DATE_INPUT_STYLE}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-medium text-slate-800">
            Estimated total budget: {formatCurrency(totalBudget)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Based on {liveTravelerCount} traveler
            {liveTravelerCount === 1 ? "" : "s"} at{" "}
            {formatCurrency(liveBudgetPerTraveler)} each.
          </div>
          {tripDateRange ? (
            <div className="mt-1 text-xs text-slate-600">
              Trip window: {tripDateRange}
            </div>
          ) : null}
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">
              Already know where you want to go?
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Enter a destination and Trippify will try to build that trip directly
              instead of making you choose from recommendations.
            </p>
          </div>

          <div className="mt-4">
            <FieldLabel htmlFor="preferredDestination">Destination</FieldLabel>
            <select
              id="preferredDestination"
              value={form.preferredDestination}
              onChange={(e) => updateField("preferredDestination", e.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="">Pick from available destinations</option>
              {DESTINATION_OPTIONS.map((destination) => (
                <option key={destination} value={destination}>
                  {destination}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <ToggleRow
            title="Vegan-friendly only"
            checked={form.veganFriendly}
            onChange={(checked) => updateField("veganFriendly", checked)}
          />
          <ToggleRow
            title="Include staycations"
            checked={form.includeStaycations}
            onChange={(checked) => updateField("includeStaycations", checked)}
          />
          <ToggleRow
            title="Strict budget"
            checked={form.strictBudget}
            onChange={(checked) => updateField("strictBudget", checked)}
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-200 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-slate-600">
            {form.preferredDestination.trim()
              ? `Trippify will try to build a trip for ${form.preferredDestination.trim()}.`
              : results.length > 0
              ? `${results.length} destination${results.length === 1 ? "" : "s"} matched your filters.`
              : "Choose your preferences and generate ranked trip ideas."}
          </div>

          <div className="flex flex-col items-end gap-2">
            {!form.tripStartDate ? (
              <div className="text-sm text-amber-700">
                Select a trip start date to generate a trip.
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading || !form.tripStartDate}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? form.preferredDestination.trim()
                  ? "Building..."
                  : "Generating..."
                : form.preferredDestination.trim()
                  ? "Build my trip"
                  : "Generate trips"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
