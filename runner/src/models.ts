import type { ModelConfig } from "./types.js";

/**
 * Production default — won real-repo holdout (4/4 valid plans with codebase context).
 * Synthetic matrix often favors cheaper models; reliability on real code wins for ship.
 */
export const DEFAULT_MODEL_ID = "gemini-flash";

export const DEFAULT_MODEL: ModelConfig = {
  id: "gemini-flash",
  slug: "google/gemini-2.5-flash",
  tier: "cheap",
  estInputPerMillion: 0.3,
  estOutputPerMillion: 2.5,
};

/** Optional models for offline bench comparisons only — not used by `pnpm plan`. */
export const BENCH_MODELS: ModelConfig[] = [
  DEFAULT_MODEL,
  {
    id: "deepseek-chat",
    slug: "deepseek/deepseek-chat-v3-0324",
    tier: "cheap",
    estInputPerMillion: 0.27,
    estOutputPerMillion: 0.4,
  },
  {
    id: "gpt41-mini",
    slug: "openai/gpt-4.1-mini",
    tier: "mid",
    estInputPerMillion: 0.4,
    estOutputPerMillion: 1.6,
  },
  {
    id: "gemini-pro",
    slug: "google/gemini-2.5-pro",
    tier: "mid",
    estInputPerMillion: 1.25,
    estOutputPerMillion: 10,
  },
];

/** @deprecated Use BENCH_MODELS — kept so existing bench smoke CLI keeps working. */
export const SMOKE_MODELS = BENCH_MODELS;

/** Optional alias kept for older docs / scripts. */
export const KIMI_SLUG = "moonshotai/kimi-k2.5";

export function getModelById(id: string): ModelConfig | undefined {
  return BENCH_MODELS.find((m) => m.id === id || m.slug === id);
}

export function resolveModels(ids: string[]): ModelConfig[] {
  return ids.map((id) => {
    const m = getModelById(id);
    if (!m) {
      throw new Error(
        `Unknown model id/slug: ${id}. Known: ${BENCH_MODELS.map((x) => x.id).join(", ")}`,
      );
    }
    return m;
  });
}
