import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: "https://integrate.api.nvidia.com/v1"
});

export const NVIDIA_TEXT_MODEL = process.env.NVIDIA_TEXT_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b";

export const NVIDIA_VISION_MODEL =
  process.env.NVIDIA_VISION_MODEL?.trim() || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

const DEFAULT_VISION_FALLBACKS = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
] as const;

function parseModelList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getVisionModelChain(): string[] {
  const fromEnv = parseModelList(process.env.NVIDIA_VISION_FALLBACK_MODELS);
  const chain = [
    NVIDIA_VISION_MODEL,
    ...(fromEnv.length ? fromEnv : [...DEFAULT_VISION_FALLBACKS]),
  ];
  return [...new Set(chain)];
}