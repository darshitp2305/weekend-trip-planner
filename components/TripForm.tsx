"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildConversationalDraft,
  buildTripInputFromDraft,
  ConversationalAnswers,
  getNextIntakeQuestion,
  getQuestionCopy,
  getRetryCopy,
  IntakeQuestionField,
  parseFollowUpAnswer,
} from "../lib/conversationalPlanner";
import {
  getPromptLimitError,
  TRIP_PROMPT_MAX_CHARS,
} from "../lib/promptLimits";
import { StartCity } from "../lib/startCities";
import { ActivityFocus, TripInput, TripStyle } from "../lib/types";

type Props = {
  onGenerate?: (input: TripInput) => Promise<void> | void;
  onSubmit?: (input: TripInput) => Promise<void> | void;
  loading?: boolean;
  initialInput?: Partial<TripInput>;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

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
      return "Food-led";
    case "outdoors":
      return "Outdoors";
    case "adventure":
      return "Adventure";
    case "chill":
      return "Slow and easy";
    default:
      return style;
  }
}

function displayActivityLabel(activityFocus?: ActivityFocus) {
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

function buildSeedAnswers(initialInput?: Partial<TripInput>): ConversationalAnswers {
  const answers: ConversationalAnswers = {};

  if (
    typeof initialInput?.travelerCount === "number" &&
    initialInput.travelerCount >= 1
  ) {
    answers.travelerCount = initialInput.travelerCount;
  }

  if (typeof initialInput?.tripLengthDays === "number") {
    answers.tripLengthDays = initialInput.tripLengthDays;
  }

  if (typeof initialInput?.season === "string") {
    if (
      initialInput.season === "Spring" ||
      initialInput.season === "Summer" ||
      initialInput.season === "Fall" ||
      initialInput.season === "Winter"
    ) {
      answers.season = initialInput.season;
    }
  }

  if (typeof initialInput?.tripStartDate === "string") {
    answers.tripStartDate = initialInput.tripStartDate;
  }

  if (typeof initialInput?.startCity === "string") {
    answers.startCity = initialInput.startCity as StartCity;
  }

  if (
    typeof initialInput?.budgetPerTraveler === "number" &&
    Number.isFinite(initialInput.budgetPerTraveler) &&
    initialInput.budgetPerTraveler >= 75
  ) {
    answers.budgetPerTraveler = Math.round(initialInput.budgetPerTraveler);
  }

  return answers;
}

function buildAssumptionPills(draft: ReturnType<typeof buildConversationalDraft>) {
  const pills: string[] = [];

  if (draft.startCity) {
    pills.push(`Starting from ${draft.startCity}`);
  }

  if (draft.travelerCount) {
    pills.push(
      `${draft.travelerCount} traveler${draft.travelerCount === 1 ? "" : "s"}`
    );
  }

  if (draft.tripLengthDays) {
    pills.push(`${draft.tripLengthDays} day${draft.tripLengthDays === 1 ? "" : "s"}`);
  }

  if (draft.season) {
    pills.push(draft.season);
  }

  pills.push(displayStyleLabel(draft.intent.style));

  const activityLabel = displayActivityLabel(draft.intent.activityFocus);
  if (activityLabel) {
    pills.push(activityLabel);
  }

  if (draft.intent.preferredDestination) {
    pills.push(draft.intent.preferredDestination);
  }

  if (draft.hasExplicitBudget) {
    pills.push(`Budget target ${formatCurrency(draft.budgetPerTraveler)} each`);
  }
  pills.push(`Drive up to ${draft.maxDriveHours}h`);

  return pills;
}

function nextComposerPlaceholder(field: IntakeQuestionField | null) {
  switch (field) {
    case "travelerCount":
      return "Example: 4 people";
    case "startCity":
      return "Example: Calgary";
    case "tripTiming":
      return "Example: this summer or June 14";
    case "tripLengthDays":
      return "Example: 3 days";
    case "budgetPerTraveler":
      return "Example: $300 each";
    default:
      return "Describe the Alberta trip you want to take";
  }
}

export default function TripForm({
  onGenerate,
  onSubmit,
  loading = false,
  initialInput,
}: Props) {
  const [prompt, setPrompt] = useState(initialInput?.tripPrompt ?? "");
  const [composerValue, setComposerValue] = useState(initialInput?.tripPrompt ?? "");
  const [answers, setAnswers] = useState<ConversationalAnswers>(() =>
    buildSeedAnswers(initialInput)
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingField, setPendingField] = useState<IntakeQuestionField | null>(null);
  const [mode, setMode] = useState<"prompt" | "followup">("prompt");
  const [errorMessage, setErrorMessage] = useState("");
  const messageIdRef = useRef(0);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);

  const previewPrompt = mode === "prompt" ? composerValue : prompt;
  const draft = buildConversationalDraft(previewPrompt, answers);
  const trimmedComposerValue = composerValue.trim();
  const tripPromptTooLong = trimmedComposerValue.length > TRIP_PROMPT_MAX_CHARS;
  const submitHandler = onGenerate ?? onSubmit;

  function nextMessageId(prefix: string) {
    messageIdRef.current += 1;
    return `${prefix}-${messageIdRef.current}`;
  }

  useEffect(() => {
    if (!chatViewportRef.current || messages.length === 0) {
      return;
    }

    chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
  }, [messages]);

  async function handleResolvedDraft(
    resolvedDraft: ReturnType<typeof buildConversationalDraft>,
    nextMessages: ChatMessage[]
  ) {
    const input = buildTripInputFromDraft(resolvedDraft);
    if (!input) {
      return;
    }

    setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant-ready"),
          role: "assistant",
          text: "Perfect. Building your Alberta trip now.",
        },
    ]);

    if (typeof submitHandler === "function") {
      await submitHandler(input);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || !submitHandler) {
      return;
    }

    setErrorMessage("");

    if (mode === "prompt") {
      if (!trimmedComposerValue) {
        setErrorMessage("Start with the kind of Alberta trip you want.");
        return;
      }

      if (tripPromptTooLong) {
        setErrorMessage(
          getPromptLimitError("Trip prompt", TRIP_PROMPT_MAX_CHARS)
        );
        return;
      }

      const nextPrompt = trimmedComposerValue;
      const nextDraft = buildConversationalDraft(nextPrompt, answers);
      const nextQuestion = getNextIntakeQuestion(nextDraft);
      const initialMessages: ChatMessage[] = [
        {
          id: nextMessageId("user-prompt"),
          role: "user",
          text: nextPrompt,
        },
      ];

      setPrompt(nextPrompt);

      if (nextQuestion) {
        setMode("followup");
        setPendingField(nextQuestion);
        setComposerValue("");
        setMessages([
          ...initialMessages,
          {
            id: nextMessageId("assistant-question"),
            role: "assistant",
            text: getQuestionCopy(nextQuestion),
          },
        ]);
        return;
      }

      setPendingField(null);
      setMode("followup");
      setComposerValue("");
      await handleResolvedDraft(nextDraft, initialMessages);
      return;
    }

    if (!pendingField || !trimmedComposerValue) {
      setErrorMessage("Reply to the question so I can finish the plan.");
      return;
    }

    const parsedAnswer = parseFollowUpAnswer(
      pendingField,
      trimmedComposerValue,
      new Date(),
      draft
    );
    const userMessage: ChatMessage = {
      id: nextMessageId("user-answer"),
      role: "user",
      text: trimmedComposerValue,
    };

    if (!parsedAnswer) {
      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: `assistant-retry-${Date.now()}`,
          role: "assistant",
          text: getRetryCopy(pendingField),
        },
      ]);
      setComposerValue("");
      return;
    }

    const nextAnswers = { ...answers, ...parsedAnswer };
    const nextDraft = buildConversationalDraft(prompt, nextAnswers);
    const nextQuestion = getNextIntakeQuestion(nextDraft);
    const nextMessages = [...messages, userMessage];

    setAnswers(nextAnswers);
    setComposerValue("");

    if (nextQuestion) {
      setPendingField(nextQuestion);
      setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant-question"),
          role: "assistant",
          text: getQuestionCopy(nextQuestion),
        },
      ]);
      return;
    }

    setPendingField(null);
    await handleResolvedDraft(nextDraft, nextMessages);
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();

    if (loading || !submitHandler || tripPromptTooLong) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  const assumptionPills = buildAssumptionPills(draft);

  return (
    <section className="w-full rounded-[2rem] border border-slate-200/70 bg-[linear-gradient(180deg,rgba(247,244,238,0.82),rgba(241,245,249,0.76))] p-5 text-slate-950 shadow-[0_28px_70px_rgba(148,163,184,0.14)] backdrop-blur-lg sm:p-7 dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(8,14,22,0.78),rgba(10,18,29,0.54))] dark:text-white dark:shadow-[0_32px_90px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white sm:text-[2rem]">
            Tell me the trip you actually want.
          </h2>
        </div>
        <div className="rounded-full border border-slate-200/70 bg-[#fbf7ef]/76 px-4 py-2 text-xs font-medium text-slate-700 dark:border-white/12 dark:bg-white/8 dark:text-white/72">
          I&apos;ll ask for anything important that&apos;s missing.
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {assumptionPills.slice(0, 6).map((pill) => (
          <span
            key={pill}
            className="inline-flex items-center rounded-full border border-slate-200/70 bg-[#fbf7ef]/76 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/12 dark:bg-white/8 dark:text-white/84"
          >
            {pill}
          </span>
        ))}
      </div>

      {messages.length > 0 ? (
        <div className="mt-6 rounded-[1.6rem] border border-slate-200/70 bg-[#fbf7ef]/72 p-4 dark:border-white/10 dark:bg-black/12">
          <div
            ref={chatViewportRef}
            className="h-[25rem] space-y-3 overflow-y-auto pr-1 sm:h-[27rem]"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[92%] rounded-[1.35rem] px-4 py-3 text-sm leading-6 sm:max-w-[80%] ${
                    message.role === "user"
                      ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                      : "border border-slate-200/70 bg-[#fbf7ef]/82 text-slate-800 dark:border-white/10 dark:bg-white/8 dark:text-white/88"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[1.6rem] border border-slate-200/70 bg-[#fbf7ef]/72 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-black/12 dark:text-white/74">
          Try something like: &quot;Plan a low-effort mountain trip from Edmonton
          with good coffee, one scenic hike, and enough payoff that four friends
          would actually commit.&quot;
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="rounded-[1.7rem] border border-slate-200/70 bg-[#f7f3eb]/82 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/14 dark:bg-white/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <textarea
            value={composerValue}
            onChange={(event) => setComposerValue(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={nextComposerPlaceholder(pendingField)}
            disabled={loading}
            className={`w-full resize-none border-0 bg-transparent px-2 text-[15px] leading-7 text-slate-950 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-white/42 ${
              mode === "prompt" ? "min-h-[150px]" : "min-h-[88px]"
            }`}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-2 pt-3 dark:border-white/10">
            <div className="text-xs text-slate-700 dark:text-white/58">
              {mode === "prompt"
                ? "Start with the full idea. I’ll ask one follow-up at a time if I need it."
                : "Reply naturally. Short answers are fine."}
            </div>
            <div className="text-xs font-medium text-slate-600 dark:text-white/52">
              {trimmedComposerValue.length}/{TRIP_PROMPT_MAX_CHARS}
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-300/24 dark:bg-rose-400/10 dark:text-rose-100">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-medium leading-6 text-slate-700 dark:text-white/70">
            {draft.intent.preferredDestination
              ? `Destination signal detected: ${draft.intent.preferredDestination}.`
              : "The planner will infer style and driving tolerance, then ask for any missing trip facts."}
          </div>
          <button
            type="submit"
            disabled={loading || !submitHandler || tripPromptTooLong}
            className="inline-flex h-12 items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-[#f5efe5]"
          >
            {loading
              ? "Building your trip..."
              : mode === "prompt"
                ? "Plan my trip"
                : "Send answer"}
          </button>
        </div>
      </form>
    </section>
  );
}
