import { logger } from "./logger";

export const defaultOpenRouterModel = "meta-llama/llama-3.3-70b-instruct:free";

const fallbackOpenRouterModels = [
  defaultOpenRouterModel,
  "mistralai/mistral-small-3.2-24b-instruct:free",
  "google/gemma-3-27b-it:free",
  "qwen/qwen3-14b:free",
  "deepseek/deepseek-r1-0528:free",
];

type OpenRouterModelList = {
  data?: Array<{
    id?: unknown;
    name?: unknown;
    pricing?: {
      prompt?: unknown;
      completion?: unknown;
    };
  }>;
};

let cachedFreeModels: { expiresAt: number; models: string[] } | null = null;

function isBrokenKnownModel(model: string) {
  return [
    "nex-agi/nex-n2-pro:free",
    "deepseek/deepseek-chat-v3-0324:free",
    "qwen/qwen3-235b-a22b:free",
  ].includes(model);
}

function isFreePricing(value: unknown) {
  const numericValue = typeof value === "string" ? Number(value) : value;
  return typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue === 0;
}

function modelPriority(model: string) {
  const lower = model.toLowerCase();
  if (lower.includes("instruct")) return 0;
  if (lower.includes("chat")) return 1;
  if (lower.includes("gemma")) return 2;
  if (lower.includes("qwen")) return 3;
  return 4;
}

async function fetchAvailableFreeModels() {
  const now = Date.now();
  if (cachedFreeModels && cachedFreeModels.expiresAt > now) {
    return cachedFreeModels.models;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "HTTP-Referer": process.env.AUTH_URL || "http://localhost:3000",
        "X-Title": "Bolao Copa 2026",
      },
      next: { revalidate: 30 * 60 },
    });

    if (!response.ok) {
      logger.warn("openrouter_models_fetch_failed", { status: response.status });
      return [];
    }

    const body = await response.json() as OpenRouterModelList;
    const models = (body.data ?? [])
      .filter((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        return id.endsWith(":free")
          && !isBrokenKnownModel(id)
          && isFreePricing(model.pricing?.prompt)
          && isFreePricing(model.pricing?.completion);
      })
      .map((model) => model.id as string)
      .sort((a, b) => modelPriority(a) - modelPriority(b) || a.localeCompare(b))
      .slice(0, 8);

    cachedFreeModels = { expiresAt: now + 30 * 60 * 1000, models };
    return models;
  } catch (error) {
    logger.warn("openrouter_models_fetch_failed", { message: error instanceof Error ? error.message : "unknown" });
    return [];
  }
}

export async function getOpenRouterModels() {
  const availableFreeModels = await fetchAvailableFreeModels();
  return Array.from(new Set([
    process.env.OPENROUTER_MODEL,
    ...availableFreeModels,
    ...fallbackOpenRouterModels,
  ].filter((model): model is string => typeof model === "string" && model.length > 0 && !isBrokenKnownModel(model))));
}
