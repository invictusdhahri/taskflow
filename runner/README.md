# TaskFlow Runner

Propose-only planner for real GitHub repos, plus an optional model bench.

**Production default:** [`google/gemini-2.5-flash`](https://openrouter.ai/google/gemini-2.5-flash). Cheaper models can win on small synthetic fixtures; the default is chosen for reliability once a real codebase is in the prompt.

The agent skill under `skills/taskflow/` is **unchanged** — this package reads it and produces a change plan. No GitHub writes.

## Quick start (real repo)

```bash
cd runner
cp .env.example .env   # set OPENROUTER_API_KEY
pnpm install

# Snapshot + plan (read-only gh + OpenRouter)
pnpm plan -- --repo OWNER/REPO

# Or reuse an existing snapshot
pnpm plan -- --snapshot R01-my-snapshot

# Evidence only (no API spend)
pnpm plan -- --repo OWNER/REPO --dry-run
```

Output: `results/plans/<id>.json` (propose-only). Review, then apply via the TaskFlow skill / `gh`.

Requires authenticated `gh` with read access to the target repo.

## Bench chart

Aggregate overview (no fixture or model callouts): [`assets/bench/overview.svg`](../assets/bench/overview.svg).

## Optional bench ($20 protocol)

Kept for re-validation — not required for day-to-day planning.

```bash
pnpm bench smoke
pnpm bench matrix --models gemini-flash,deepseek-chat,gpt41-mini
pnpm bench holdout --models gemini-flash --snapshots R01-...,R02-...
pnpm bench report
```

Synthetic fixtures: `fixtures/synthetic/F01`–`F04`. Snapshots: `pnpm snapshot -- --repo OWNER/REPO --id R01-name`.

## Layout

```text
runner/
  src/
    plan.ts        # real-repo propose-only entrypoint
    snapshot.ts    # read-only gh + codebase capture
    evidence.ts    # prompt builder
    openrouter.ts  # Gemini Flash / OpenRouter client
    parsePlan.ts   # JSON plan parse + coerce
    bench.ts       # optional model comparison
  fixtures/
    synthetic/     # scored bench packs
    snapshots/     # gitignored real packs
  results/         # gitignored plans + CSV
```

## Privacy

- Snapshot is **read-only** (`gh` + optional shallow clone).
- Evidence (issues + source text) is sent to OpenRouter — only plan repos you are willing to expose.
- Do not commit private snapshots or `.env`.

## Model ids (bench)

| id | slug | Role |
|----|------|------|
| `gemini-flash` | `google/gemini-2.5-flash` | **Default** (`pnpm plan`) |
| `deepseek-chat` | `deepseek/deepseek-chat-v3-0324` | Cheap synthetic |
| `gpt41-mini` | `openai/gpt-4.1-mini` | Mid bench |
| `gemini-pro` | `google/gemini-2.5-pro` | Mid bench |
