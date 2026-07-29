import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type { ModelConfig } from "./types.js";

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  usd: number;
  model_used: string;
  raw_text: string;
  latency_ms: number;
}

function loadDotEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

export function defaultMaxUsdPerRun(): number {
  return Number(process.env.TASKFLOW_MAX_USD_PER_RUN ?? 0.4);
}

/** Higher default for full-codebase `pnpm plan` runs. */
export function defaultPlanMaxUsd(): number {
  return Number(process.env.TASKFLOW_PLAN_MAX_USD ?? 2.0);
}

/** Per-attempt HTTP timeout (SDK default is 10 minutes). */
export function openRouterTimeoutMs(): number {
  return Number(process.env.OPENROUTER_TIMEOUT_MS ?? 120_000);
}

/** Longer default for large plan prompts when env unset — callers may set OPENROUTER_TIMEOUT_MS. */
export function openRouterPlanTimeoutMs(): number {
  return Number(process.env.OPENROUTER_TIMEOUT_MS ?? 300_000);
}

export function openRouterMaxRetries(): number {
  return Number(process.env.OPENROUTER_MAX_RETRIES ?? 1);
}

/** Cap completion length so providers cannot stream 16k+ runaway outputs. */
export function openRouterMaxTokens(): number {
  return Number(process.env.OPENROUTER_MAX_TOKENS ?? 2500);
}

export function createOpenRouterClient(): OpenAI {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy runner/.env.example to runner/.env and add your key.",
    );
  }
  const baseURL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const timeout = openRouterTimeoutMs();
  const maxRetries = openRouterMaxRetries();
  return new OpenAI({
    apiKey: key,
    baseURL,
    timeout,
    maxRetries,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/invictusdhahri/taskflow",
      "X-Title": "TaskFlow Runner",
    },
  });
}

export function estimateUsd(
  model: ModelConfig,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * model.estInputPerMillion +
    (outputTokens / 1_000_000) * model.estOutputPerMillion
  );
}

/** Rough token estimate: ~4 chars per token. */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export async function completePlan(opts: {
  model: ModelConfig;
  system: string;
  user: string;
  maxUsdPerRun?: number;
}): Promise<ChatUsage> {
  const { model, system, user } = opts;
  const maxUsd = opts.maxUsdPerRun ?? defaultMaxUsdPerRun();

  const estIn = estimateTokensFromChars(system.length + user.length);
  const maxTokens = openRouterMaxTokens();
  const estOut = maxTokens;
  const estCost = estimateUsd(model, estIn, estOut);
  if (estCost > maxUsd) {
    throw new Error(
      `Pre-flight estimate $${estCost.toFixed(3)} exceeds max $${maxUsd.toFixed(2)} for ${model.slug} (in~${estIn}). Truncate evidence or raise TASKFLOW_MAX_USD_PER_RUN.`,
    );
  }

  const client = createOpenRouterClient();
  const timeout = openRouterTimeoutMs();
  const maxRetries = openRouterMaxRetries();

  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
    plugins?: Array<Record<string, unknown>>;
  } = {
    model: model.slug,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  if (model.slug === "openrouter/auto-beta") {
    body.plugins = [
      {
        id: "auto-router",
        cost_quality_tradeoff: model.costQualityTradeoff ?? 8,
        ...(model.allowModels?.length ? { allowed_models: model.allowModels } : {}),
      },
    ];
  }

  console.log(
    `  [api] POST ${model.slug} estIn~${estIn} chars=${system.length + user.length} ` +
      `max_tokens=${maxTokens} timeout=${timeout}ms retries=${maxRetries}`,
  );

  const started = Date.now();
  const heartbeat = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`  [api] still waiting on ${model.slug}… ${secs}s`);
  }, 15_000);

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await client.chat.completions.create(body);
  } catch (e) {
    const elapsed = Date.now() - started;
    console.error(
      `  [api] fail after ${elapsed}ms: ${(e as Error).name}: ${(e as Error).message}`,
    );
    throw e;
  } finally {
    clearInterval(heartbeat);
  }

  const latency_ms = Date.now() - started;
  const raw_text = completion.choices[0]?.message?.content ?? "";
  const usage = completion.usage;

  // Providers sometimes return usage with zeros; fall back to char estimates.
  let input_tokens = usage?.prompt_tokens ?? 0;
  let output_tokens = usage?.completion_tokens ?? 0;
  let usageSource = "api";
  if (input_tokens <= 0) {
    input_tokens = estIn;
    usageSource = "est";
  }
  if (output_tokens <= 0) {
    output_tokens = estimateTokensFromChars(raw_text.length);
    usageSource = usageSource === "est" ? "est" : "est-out";
  }

  const usd = estimateUsd(model, input_tokens, output_tokens);
  const model_used = completion.model ?? model.slug;
  const finish = completion.choices[0]?.finish_reason ?? "?";

  console.log(
    `  [api] ok ${latency_ms}ms routed=${model_used} finish=${finish} ` +
      `tokens=${input_tokens}+${output_tokens} (${usageSource}) ` +
      `rawUsage=${usage?.prompt_tokens ?? "?"}+${usage?.completion_tokens ?? "?"} charsOut=${raw_text.length}`,
  );

  if (finish === "length") {
    console.warn(
      `  [api] truncated at max_tokens=${maxTokens} — plan may be incomplete`,
    );
  }

  if (usd > maxUsd * 1.25) {
    console.warn(
      `Warning: actual $${usd.toFixed(4)} exceeded soft cap $${maxUsd} for ${model_used}`,
    );
  }

  return {
    input_tokens,
    output_tokens,
    usd,
    model_used,
    raw_text,
    latency_ms,
  };
}
