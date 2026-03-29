import { reportProviderEvent } from "./providerTelemetry";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  ProviderOutcome,
} from "./types";

type ResponsesApiOutput = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

type BuilderPromptInterpretationPayload = {
  rewrittenPrompt?: unknown;
  confidence?: unknown;
};

export type OpenAiBuilderPromptInterpretation = {
  rewrittenPrompt: string;
  confidence?: "low" | "medium" | "high";
};

type BuilderPromptContext = {
  prompt: string;
  destinationLabel?: string;
  startCityLabel?: string;
  days: ItineraryDayData[];
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  activities: Activity[];
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getResponseText(data: ResponsesApiOutput): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts: string[] = [];
  if (!Array.isArray(data?.output)) {
    return "";
  }

  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const contentItem of item.content) {
      if (typeof contentItem?.text === "string") {
        parts.push(contentItem.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try fenced code block or embedded object.
  }

  const fencedMatch =
    trimmed.match(/```json\s*([\s\S]*?)```/i) ||
    trimmed.match(/```([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      return null;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function summarizeDay(day: ItineraryDayData, index: number) {
  return {
    day: index + 1,
    title: day.title ?? null,
    summary: day.summary ?? null,
    stops: (day.stops ?? []).map((stop) => ({
      kind: stop.kind,
      time: stop.time ?? null,
      title: stop.title,
      description: stop.description ?? null,
    })),
  };
}

function sanitizeInterpretation(
  value: unknown
): OpenAiBuilderPromptInterpretation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as BuilderPromptInterpretationPayload;
  const rewrittenPrompt = safeString(payload.rewrittenPrompt);
  const confidence = safeString(payload.confidence);

  if (!rewrittenPrompt) {
    return null;
  }

  return {
    rewrittenPrompt,
    confidence:
      confidence === "low" || confidence === "medium" || confidence === "high"
        ? confidence
        : undefined,
  };
}

export async function interpretBuilderPromptWithOpenAI(
  context: BuilderPromptContext
): Promise<{
  interpretation: OpenAiBuilderPromptInterpretation | null;
  status: ProviderOutcome;
}> {
  const prompt = safeString(context.prompt);
  if (!prompt) {
    return { interpretation: null, status: "fallback_used" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { interpretation: null, status: "fallback_used" };
  }

  const model =
    process.env.OPENAI_BUILDER_PROMPT_MODEL ||
    process.env.OPENAI_PROMPT_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini";

  const systemPrompt = [
    "You rewrite traveler itinerary-edit requests into explicit builder instructions.",
    "Return ONLY valid JSON and do not use markdown fences.",
    "Keep the traveler intent, but rewrite fuzzy language into 1-3 short imperative sentences the local itinerary editor can parse.",
    "Use explicit day numbers when possible, based on the current itinerary context.",
    "Do not invent places unless the traveler named them.",
    "If the traveler asks for a vibe rather than a named place, rewrite it into a concrete stop request that preserves that vibe, for example a scenic viewpoint, quiet cafe, lakeside walk, or casual dinner.",
    "Prefer existing destination context and current itinerary structure.",
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Rewrite this itinerary edit request into explicit builder instructions.",
      required_output_shape: {
        rewrittenPrompt: "string",
        confidence: '"low" | "medium" | "high"',
      },
      guidance: {
        builder_examples: [
          "Day 2 lunch to Wild Flour Bakery.",
          "Add a coffee stop on day 3 before we leave.",
          "Change day 1 activity to a quiet lakeside walk.",
          "Switch the stay to Rimrock Resort Hotel.",
        ],
        destination: context.destinationLabel ?? null,
        startCity: context.startCityLabel ?? null,
      },
      current_itinerary: context.days.map(summarizeDay),
      available_stays: context.hotels.slice(0, 12).map((hotel) => hotel.name),
      available_food: context.foodSpots.slice(0, 20).map((food) => food.name),
      available_activities: context.activities.slice(0, 20).map((activity) => activity.name),
      traveler_request: prompt,
    },
    null,
    2
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        max_output_tokens: 700,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      reportProviderEvent({
        provider: "openai",
        operation: "interpret_builder_prompt",
        outcome: "live_unavailable",
        statusCode: response.status,
        detail: `Responses API returned non-OK status: ${errorText.slice(0, 200)}`,
      });
      return { interpretation: null, status: "live_unavailable" };
    }

    const data = (await response.json()) as ResponsesApiOutput;
    const parsed = sanitizeInterpretation(parseJsonFromText(getResponseText(data)));
    if (!parsed) {
      reportProviderEvent({
        provider: "openai",
        operation: "interpret_builder_prompt",
        outcome: "fallback_used",
        detail: "Responses API returned no usable builder prompt interpretation.",
      });
      return { interpretation: null, status: "fallback_used" };
    }

    return { interpretation: parsed, status: "live_success" };
  } catch (error) {
    reportProviderEvent({
      provider: "openai",
      operation: "interpret_builder_prompt",
      outcome: "live_unavailable",
      error,
    });
    return { interpretation: null, status: "live_unavailable" };
  }
}
