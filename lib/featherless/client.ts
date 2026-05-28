import OpenAI from "openai";

export const featherlessClient = new OpenAI({
  baseURL: "https://api.featherless.ai/v1",
  apiKey: process.env.FEATHERLESS_API_KEY,
});

export const FEATHERLESS_TEXT_MODEL = process.env.FEATHERLESS_TEXT_MODEL?.trim() || "google/gemma-4-31B-it";

/** Primary vision model (override with FEATHERLESS_VISION_MODEL in .env). */
export const FEATHERLESS_VISION_MODEL =
  process.env.FEATHERLESS_VISION_MODEL?.trim() || "google/gemma-4-31B-it";

const DEFAULT_VISION_FALLBACKS = [
  "google/gemma-4-31B-it"
] as const;

function parseModelList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getVisionModelChain(): string[] {
  const fromEnv = parseModelList(process.env.FEATHERLESS_VISION_FALLBACK_MODELS);
  const chain = [
    FEATHERLESS_VISION_MODEL,
    ...(fromEnv.length ? fromEnv : [...DEFAULT_VISION_FALLBACKS]),
  ];
  return [...new Set(chain)];
}
