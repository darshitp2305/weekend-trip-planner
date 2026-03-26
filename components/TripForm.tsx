"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
} from "../lib/tripIntent";
import { isStartCity, START_CITY_OPTIONS, type StartCity } from "../lib/startCities";
import {
  clampTripEndDate,
  clampTripStartDate,
  deriveTripEndDate,
  deriveTripLengthDays,
  deriveSeasonFromDateRange,
  formatDateRange,
  getTodayIsoDate,
} from "../lib/tripDates";
import { ActivityFocus, TripInput, TripStyle } from "../lib/types";

type Props = {
  onGenerate?: (input: TripInput) => Promise<void> | void;
  onSubmit?: (input: TripInput) => Promise<void> | void;
  loading?: boolean;
  initialInput?: Partial<TripInput>;
};

type FormState = {
  startCity: StartCity;
  travelerCount: string;
  budgetPerTraveler: string;
  maxDriveHours: string;
  tripPrompt: string;
  tripStartDate: string;
  tripEndDate: string;
};

const DEFAULT_FORM: FormState = {
  startCity: "Edmonton",
  travelerCount: "2",
  budgetPerTraveler: "",
  maxDriveHours: "",
  tripPrompt: "",
  tripStartDate: "",
  tripEndDate: "",
};

const DATE_INPUT_CLASS =
  "date-input-fix h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20 dark:[&::-webkit-calendar-picker-indicator]:invert";

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
    startCity: isStartCity(initialInput?.startCity)
      ? initialInput.startCity
      : DEFAULT_FORM.startCity,
    travelerCount: String(initialInput?.travelerCount ?? 2),
    budgetPerTraveler:
      typeof initialInput?.budgetPerTraveler === "number"
        ? String(initialInput.budgetPerTraveler)
        : "",
    maxDriveHours:
      typeof initialInput?.maxDriveHours === "number"
        ? String(initialInput.maxDriveHours)
        : "",
    tripPrompt: initialInput?.tripPrompt ?? "",
    tripStartDate,
    tripEndDate,
  };
}

function parsePositiveInt(value: string, fallback: number) {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return fallback;

  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return parsed;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function displayStyleLabel(style: TripStyle) {
  switch (style) {
    case "solo reset":
      return "Solo reset";
    case "hidden gems":
      return "Hidden gems";
    case "foodie":
      return "Foodie";
    case "outdoors":
      return "Outdoors";
    case "adventure":
      return "Adventure";
    case "chill":
      return "Chill";
    default:
      return style;
  }
}

function displayActivityFocusLabel(activityFocus?: ActivityFocus) {
  switch (activityFocus) {
    case "skiing":
      return "Skiing";
    case "hiking":
      return "Hiking";
    case "camping":
      return "Camping";
    default:
      return null;
  }
}

function budgetSignalLabel(options: {
  manualBudgetPerTraveler?: number;
  promptBudgetAmount?: number;
  promptBudgetScope?: "per_traveler" | "group_total";
  promptBudgetApproximate?: boolean;
  resolvedBudgetPerTraveler: number;
  travelerCount: number;
}) {
  if (typeof options.manualBudgetPerTraveler === "number") {
    return `Budget override: ${formatCurrency(options.manualBudgetPerTraveler)} each`;
  }

  if (
    typeof options.promptBudgetAmount === "number" &&
    options.promptBudgetScope === "per_traveler"
  ) {
    return `${options.promptBudgetApproximate ? "Budget from prompt: about" : "Budget from prompt:"} ${formatCurrency(options.promptBudgetAmount)} each`;
  }

  if (
    typeof options.promptBudgetAmount === "number" &&
    options.promptBudgetScope === "group_total"
  ) {
    return `${options.promptBudgetApproximate ? "Budget from prompt: about" : "Budget from prompt:"} ${formatCurrency(options.promptBudgetAmount)} total (${formatCurrency(options.resolvedBudgetPerTraveler)} each)`;
  }

  return `Budget assumption: ${formatCurrency(options.resolvedBudgetPerTraveler)} each`;
}

function hardConstraintLabels(intent: ReturnType<typeof deriveTripIntentFromPrompt>) {
  const labels: string[] = [];

  if (intent.hardConstraints.activityAnchor === "summit_hike") {
    labels.push("Hard: summit-style hike");
  } else if (intent.hardConstraints.activityAnchor === "campground_base") {
    labels.push("Hard: camping base");
  } else if (intent.hardConstraints.activityAnchor === "ski_trip") {
    labels.push("Hard: ski-focused trip");
  }

  if (intent.hardConstraints.hikeDistanceKmTarget) {
    labels.push(`Hard: about ${Math.round(intent.hardConstraints.hikeDistanceKmTarget)} km`);
  }

  if (intent.hardConstraints.requiresScenicView) {
    labels.push("Hard: scenic payoff");
  }

  if (intent.hardConstraints.requiresVegetarianOptions) {
    labels.push(
      intent.hardConstraints.mixedDietGroup
        ? "Hard: vegetarian-friendly for the group"
        : intent.hardConstraints.dietaryPreference === "vegan"
          ? "Hard: vegan-friendly food"
          : "Hard: vegetarian-friendly food"
    );
  }

  return labels;
}

function softPreferenceLabels(intent: ReturnType<typeof deriveTripIntentFromPrompt>) {
  const labels: string[] = [];

  if (intent.softPreferences.wantsGoodFood) {
    labels.push("Soft: good food");
  }

  if (intent.softPreferences.wantsGetawayFeel && !intent.includeStaycations) {
    labels.push("Soft: real getaway feel");
  }

  if (intent.softPreferences.wantsLowEffort) {
    labels.push("Soft: low-friction pacing");
  }

  if (intent.softPreferences.wantsRecoveryDays) {
    labels.push("Soft: relax on the other days");
  }

  return labels;
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
    >
      {children}
    </label>
  );
}

function SignalPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {children}
    </span>
  );
}

export default function TripForm({
  onGenerate,
  onSubmit,
  loading = false,
  initialInput,
}: Props) {
  const minTripStartDate = getTodayIsoDate();
  const [form, setForm] = useState<FormState>(() =>
    buildFormState(initialInput, minTripStartDate)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const derivedIntent = useMemo(
    () => deriveTripIntentFromPrompt(form.tripPrompt),
    [form.tripPrompt]
  );
  const promptBudget = useMemo(
    () => extractPromptBudget(form.tripPrompt),
    [form.tripPrompt]
  );

  const resolvedTravelerCount = clampNumber(
    parsePositiveInt(form.travelerCount, 2),
    1,
    12
  );
  const manualBudgetPerTraveler = form.budgetPerTraveler
    ? clampNumber(parsePositiveInt(form.budgetPerTraveler, 300), 50, 5000)
    : undefined;
  const promptBudgetPerTraveler =
    promptBudget?.scope === "per_traveler"
      ? promptBudget.amount
      : promptBudget?.scope === "group_total"
        ? clampNumber(
            Math.max(1, Math.round(promptBudget.amount / resolvedTravelerCount)),
            50,
            5000
          )
        : undefined;
  const resolvedBudgetPerTraveler = clampNumber(
    manualBudgetPerTraveler ??
      promptBudgetPerTraveler ??
      derivedIntent.suggestedBudgetPerTraveler ??
      300,
    50,
    5000
  );
  const resolvedMaxDriveHours = clampNumber(
    parsePositiveInt(form.maxDriveHours, derivedIntent.suggestedMaxDriveHours ?? 5),
    1,
    12
  );

  const totalBudget = resolvedTravelerCount * resolvedBudgetPerTraveler;
  const tripDateRange = formatDateRange(
    form.tripStartDate || undefined,
    form.tripEndDate || undefined
  );
  const maxTripEndDate =
    deriveTripEndDate(form.tripStartDate, 7) ?? form.tripStartDate;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleNumericChange(
    key: "travelerCount" | "budgetPerTraveler" | "maxDriveHours",
    value: string
  ) {
    updateField(key, value.replace(/[^\d]/g, "") as FormState[typeof key]);
  }

  function handleTripStartDateChange(value: string) {
    const tripStartDate = clampTripStartDate(value, minTripStartDate);

    setForm((prev) => {
      const tripLengthDays =
        deriveTripLengthDays(prev.tripStartDate, prev.tripEndDate) ?? 2;
      const tripEndDate =
        clampTripEndDate(
          deriveTripEndDate(tripStartDate, tripLengthDays),
          tripStartDate,
          7
        ) ?? tripStartDate;

      return {
        ...prev,
        tripStartDate,
        tripEndDate,
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.tripStartDate || !form.tripPrompt.trim()) {
      return;
    }

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
      maxDriveHours: resolvedMaxDriveHours,
      maxDriveMinutesBetweenStops: 45,
      budget: totalBudget,
      budgetPerTraveler: resolvedBudgetPerTraveler,
      travelerCount: resolvedTravelerCount,
      tripLengthDays,
      season,
      style: derivedIntent.style,
      tripPrompt: form.tripPrompt.trim(),
      activityFocus: derivedIntent.activityFocus,
      veganFriendly: derivedIntent.veganFriendly,
      includeStaycations: derivedIntent.includeStaycations,
      strictBudget: derivedIntent.strictBudget,
      preferredDestination: derivedIntent.preferredDestination,
      tripStartDate,
      tripEndDate,
    };

    const submitHandler = onGenerate ?? onSubmit;

    if (typeof submitHandler !== "function") {
      console.error("TripForm requires an onGenerate or onSubmit prop.");
      return;
    }

    await submitHandler(cleanedInput);
  }

  return (
    <section className="w-full">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#f0fdf4,#ecfeff)] p-6 shadow-sm dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(6,78,59,0.35),rgba(15,23,42,0.95))] sm:p-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            One trip, not a shortlist
          </div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
            Tell us the dates, group size, and what this trip needs to be.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-200">
            Trippify will infer the trip style from your brief, pick one Alberta
            plan with conviction, and then let you reshape the days in the
            builder.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <FieldLabel htmlFor="tripStartDate">Start date</FieldLabel>
            <input
              id="tripStartDate"
              type="date"
              min={minTripStartDate}
              required
              value={form.tripStartDate}
              onChange={(event) => handleTripStartDateChange(event.target.value)}
              className={DATE_INPUT_CLASS}
            />
          </div>

          <div>
            <FieldLabel htmlFor="tripEndDate">End date</FieldLabel>
            <input
              id="tripEndDate"
              type="date"
              min={form.tripStartDate}
              max={maxTripEndDate}
              required
              value={form.tripEndDate}
              onChange={(event) => handleTripEndDateChange(event.target.value)}
              className={DATE_INPUT_CLASS}
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
              onChange={(event) =>
                handleNumericChange("travelerCount", event.target.value)
              }
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20"
            />
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <FieldLabel htmlFor="tripPrompt">What do you want from this trip?</FieldLabel>
              <p className="mb-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                Describe the kind of weekend people would actually say yes to.
                Mention the vibe, pace, food, scenery, or any destination you
                already have in mind.
              </p>
            </div>
            <SignalPill>
              {tripDateRange ?? "Flexible dates"}
            </SignalPill>
          </div>

          <textarea
            id="tripPrompt"
            required
            minLength={8}
            value={form.tripPrompt}
            onChange={(event) => updateField("tripPrompt", event.target.value)}
            placeholder="Example: We want a low-effort mountain weekend with good coffee, one scenic hike, and enough payoff that four of us would actually commit to going."
            className="min-h-[160px] w-full rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {hardConstraintLabels(derivedIntent).map((label) => (
              <SignalPill key={label}>{label}</SignalPill>
            ))}
            <SignalPill>Style: {displayStyleLabel(derivedIntent.style)}</SignalPill>
            {displayActivityFocusLabel(derivedIntent.activityFocus) ? (
              <SignalPill>
                Activity: {displayActivityFocusLabel(derivedIntent.activityFocus)}
              </SignalPill>
            ) : null}
            {derivedIntent.preferredDestination ? (
              <SignalPill>
                Destination signal: {derivedIntent.preferredDestination}
              </SignalPill>
            ) : null}
            <SignalPill>
              Drive assumption: up to {resolvedMaxDriveHours}h
            </SignalPill>
            <SignalPill>
              {budgetSignalLabel({
                manualBudgetPerTraveler,
                promptBudgetAmount: promptBudget?.amount,
                promptBudgetScope: promptBudget?.scope,
                promptBudgetApproximate: promptBudget?.approximate,
                resolvedBudgetPerTraveler,
                travelerCount: resolvedTravelerCount,
              })}
            </SignalPill>
            {derivedIntent.includeStaycations ? (
              <SignalPill>Local trips allowed</SignalPill>
            ) : (
              <SignalPill>Getaway-first</SignalPill>
            )}
            {softPreferenceLabels(derivedIntent).map((label) => (
              <SignalPill key={label}>{label}</SignalPill>
            ))}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
          <button
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Optional planning assumptions
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Only open this if you want to override the prompt-led budget or
                drive assumptions.
              </p>
            </div>
            <span className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {advancedOpen ? "Hide" : "Edit"}
            </span>
          </button>

          {advancedOpen ? (
            <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 dark:border-slate-700 md:grid-cols-3">
              <div>
                <FieldLabel htmlFor="startCity">Starting city</FieldLabel>
                <select
                  id="startCity"
                  value={form.startCity}
                  onChange={(event) =>
                    updateField("startCity", event.target.value as StartCity)
                  }
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20"
                >
                  {START_CITY_OPTIONS.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel htmlFor="maxDriveHours">Max drive hours</FieldLabel>
                <input
                  id="maxDriveHours"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="text"
                  value={form.maxDriveHours}
                  onChange={(event) =>
                    handleNumericChange("maxDriveHours", event.target.value)
                  }
                  placeholder={`Auto: ${resolvedMaxDriveHours}`}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <FieldLabel htmlFor="budgetPerTraveler">Budget per traveler</FieldLabel>
                <input
                  id="budgetPerTraveler"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="text"
                  value={form.budgetPerTraveler}
                  onChange={(event) =>
                    handleNumericChange("budgetPerTraveler", event.target.value)
                  }
                  placeholder={
                    promptBudget
                      ? `Prompt: ${resolvedBudgetPerTraveler}`
                      : `Auto: ${resolvedBudgetPerTraveler}`
                  }
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-500/20"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                Estimated target budget: {formatCurrency(totalBudget)}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Based on {resolvedTravelerCount} traveler
                {resolvedTravelerCount === 1 ? "" : "s"} at{" "}
                {formatCurrency(resolvedBudgetPerTraveler)} each.
                {promptBudget?.scope === "group_total"
                  ? ` That comes from ${formatCurrency(promptBudget.amount)} total in your brief.`
                  : promptBudget?.scope === "per_traveler"
                    ? " That comes from the budget written in your brief."
                    : ""}
                {" "}You will get one trip recommendation, then you can swap stops day by day in the builder.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !form.tripStartDate || !form.tripPrompt.trim()}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
            >
              {loading ? "Building your trip..." : "Build my trip"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
