# TaskFlow Runner

Planner (`pnpm plan`, propose-only) plus an optional apply step (`pnpm apply`) for real GitHub repos, plus an optional model bench.

**Production default:** [`google/gemini-2.5-flash`](https://openrouter.ai/google/gemini-2.5-flash).

The agent skill under `skills/taskflow/` is **unchanged** — `plan` reads it to produce a change plan (no GitHub writes). `apply` is a separate, narrower write path: it only ever executes `CREATE_ISSUE` operations from a plan, gated onto Status=Ready vs Status=Backlog — see [Apply](#apply-scheduled--unattended-issue-creation) below. Every other operation type stays propose-only and still requires the human/chat skill flow.

## Quick start (real repo)

```bash
cd runner
cp .env.example .env   # set OPENROUTER_API_KEY
pnpm install

# Snapshot + plan (read-only gh + OpenRouter) — full text codebase required
pnpm plan -- --repo OWNER/REPO

# Reuse an existing snapshot pack
pnpm plan -- --snapshot R01-my-snapshot

# Size / cache / cost estimate only
pnpm plan -- --repo OWNER/REPO --dry-run

# Force full re-analyze (ignore findings cache)
pnpm plan -- --repo OWNER/REPO --refresh-code
```

Output: `results/plans/<id>.json` (propose-only). Review, then apply via the TaskFlow skill / `gh`.

Requires authenticated `gh` with read access to the target repo.

### Full codebase + incremental cache

- **Cold run:** reads **every** text source file (skips binaries / `node_modules` / lockfiles). If the prompt fits, one single-shot plan; otherwise chunked findings + merge. `omitted` must be `0`.
- **Later runs:** per-file findings are cached under `results/cache/<owner>__<repo>/` keyed by content hash. Unchanged files are reused; only deltas are re-sent to the model; issues/PRs are always refreshed; a merge call rebuilds the plan.
- **`--no-cache`:** neither read nor write cache. **`--refresh-code`:** re-analyze all files, then rewrite cache.
- Cost cap: `TASKFLOW_PLAN_MAX_USD` (default **$2**). Bench keeps the cheaper `TASKFLOW_MAX_USD_PER_RUN`.

For GitHub Actions, restore `results/cache/` between jobs (Actions cache / artifact) so nightlies stay incremental. Do not commit cache contents.

## Apply (scheduled / unattended issue creation)

`pnpm apply` executes a plan's `CREATE_ISSUE` operations as real GitHub issues. Nothing else in the plan is written — `UPDATE_ISSUE`, `DEDUPLICATE`, etc. are logged as skipped and still need a human running the interactive skill.

```bash
pnpm apply -- --plan results/plans/<id>.json            # real writes
pnpm apply -- --plan results/plans/<id>.json --dry-run   # render + duplicate-check run for real; gh writes skipped
```

**Precondition:** the target repo must already have a Projects v2 board with a Status field carrying `Backlog`/`Ready` options — bootstrap it once via the interactive TaskFlow skill. `apply.ts` fails fast with a clear error if it can't find that board; it never auto-provisions one, to keep an unattended first run's blast radius to "creates issues," not "creates issues and stands up new repo infrastructure."

**Per-issue gate — Status instead of a chat approval:** every `CREATE_ISSUE` is always created (low risk — it's just information landing on the board). What's gated is whether it lands on `Ready` (and gets assigned) or `Backlog` (unassigned, with a note):

1. A **live duplicate check** against currently-open issues (not the frozen plan snapshot), using the same "compare intent, affected surface, acceptance criteria, and delivery state" standard as the interactive skill.
2. The **Definition of Ready** checklist (`skills/taskflow/templates.md`), checked against the actual rendered issue body — not the model's self-reported `has_*` flags in the plan JSON, which are cheap hints only.
3. A **confident roster match** for an assignee, re-verified against freshly-fetched collaborators at apply time (not the plan-time snapshot).

All three clean → `Status=Ready`, assigned. Anything short of that → `Status=Backlog`, unassigned, with a one-line note on why. The board itself is the audit trail — filter by `Backlog` to see what needs a human look.

**Roster / skill tags:** commit `.taskflow/roster.json` to the *target* repo (not this repo):

```json
{ "github-login": ["frontend", "auth"] }
```

At plan/apply time this is layered on top of the repo's real, live collaborators (`gh api repos/OWNER/REPO/collaborators`) — you only maintain the skill tags, not the roster itself. Untagged collaborators are still valid assignees, just without a skill hint. Use `--roster PATH` on `plan`/`apply` to override with a local file (skips the live fetch).

**Scheduling:** copy [`ci/taskflow-schedule.yml.example`](ci/taskflow-schedule.yml.example) into `<target-repo>/.github/workflows/`. It authenticates as the TaskFlow GitHub App — see [GitHub App setup](#github-app-setup) below for the one-time (account-wide, not per-repo) setup — plus the `OPENROUTER_API_KEY` secret. See the file's header comments for the full precondition and deployment notes.

Other `apply` flags: `--max-creates N` (default 5, caps issues created per run), `--project-owner`/`--project-number` (disambiguate when a repo has more than one linked Project), `--model`, `--max-usd` (per-call soft cost cap, default `TASKFLOW_MAX_USD_PER_RUN` / $0.40 — `apply` makes one render call per `CREATE_ISSUE` plus one batched duplicate-check call, a smaller cost profile than `plan`'s full-codebase budget).

## GitHub App setup

One-time setup — done once for your whole account/org, not per repo. After this, adding TaskFlow to a new repo is just "bootstrap its board, copy a workflow file in" — no new secrets, no new token.

1. **Register the App.** GitHub → your avatar → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**. (Registering under an organization instead: that org's **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App** — do this if you want org-wide secret storage in step 5.)
   - **GitHub App name:** anything unique, e.g. `taskflow-bot-yourname`.
   - **Homepage URL:** anything — not used functionally.
   - **Webhook:** uncheck **Active** — TaskFlow runs on a schedule, it doesn't need webhook events.
   - **Repository permissions:** `Issues` → Read and write. `Metadata` is auto-selected read-only.
   - **Organization permissions** (org-registered Apps only): `Projects` → Read and write. (Personal-account Apps: Projects access comes from the repos you install it on — no separate toggle.)
   - **Where can this GitHub App be installed?** → "Only on this account" unless you have a reason to make it public.
   - **Create GitHub App**.
2. **Generate its private key.** On the App's settings page → **Private keys** → **Generate a private key**. Downloads a `.pem` file — this is the App's credential, keep it safe.
3. **Note the App ID.** Same page, near the top.
4. **Install the App.** Left sidebar → **Install App** → pick your account/org → **Only select repositories** → choose every repo you want TaskFlow on now. Add more later from this same screen when you add a new repo — this step doesn't need repeating for repos already selected.
5. **Store the two secrets.**
   - **Organization:** Org **Settings** → **Secrets and variables** → **Actions** → **New organization secret**, repository access set to the repos you installed the App on (or all). Add `TASKFLOW_APP_ID` (from step 3) and `TASKFLOW_APP_PRIVATE_KEY` (the full `.pem` contents from step 2), plus `OPENROUTER_API_KEY`.
   - **Personal account (no org):** GitHub doesn't offer account-wide Actions secrets outside an organization — add the same 3 secrets to each repo's own **Settings** → **Secrets and variables** → **Actions** once. The App *install* in step 4 is still one-time/account-wide either way; only secret *storage* is per-repo without an org.
6. **Use it.** Copy `ci/taskflow-schedule.yml.example` (or `ci/taskflow-cross-repo.yml.example`) into a repo's `.github/workflows/` as-is — it already reads these three secret names. Bootstrap that repo's Project board once via the interactive skill (still required — this can't be automated away), commit and push, then trigger it once by hand (Actions tab → the workflow → **Run workflow**) before waiting for the schedule.

## Cross-repo joint planning

`pnpm plan --repo` only ever looks at one repo — it has no idea a related repo (e.g. a separate frontend for a backend) exists, even if both land on the same Project board. Putting both on one board only changes *where results are displayed*, not what the planner reasons about. Joint mode fixes that:

```bash
pnpm plan -- --repos OWNER/BACKEND,OWNER/FRONTEND --id GROUP_ID
pnpm plan -- --repos OWNER/BACKEND,OWNER/FRONTEND --id GROUP_ID --dry-run
```

Each repo still runs through the normal per-repo findings pipeline (chunked, cached — exactly as cheap as planning it alone). The only new cost is **one additional joint merge call** across all repos' condensed findings plus each repo's own declared "surface" — not raw codebases, to keep this cheap:

```json
// .taskflow/surface.json, committed in a member repo
{ "globs": ["src/routes/**", "openapi.yaml", "**/*.schema.graphql"] }
```

These are the files that actually define a repo's public interface — sent in full to the joint call so the model can catch real mismatches (a frontend calling an endpoint/field the backend doesn't define, etc). Everything else contributes only as condensed per-file notes, same as single-repo mode. No `.taskflow/surface.json` → joint mode still works, just without that full-text precision boost.

Every operation in a group plan's output carries a `"repo"` field saying which member it targets; `pnpm apply` on a group plan validates every `CREATE_ISSUE`'s `repo` against the declared group (fails fast on an unrecognized one) and routes creation/duplicate-checking/assignment to each op's own target repo. Project resolution stays a single shared board — that part already worked across repos before this feature existed.

Scheduling: copy [`ci/taskflow-cross-repo.yml.example`](ci/taskflow-cross-repo.yml.example) — it can live in either member repo (or neither), since the TaskFlow App token already has access across every repo it's installed on (make sure the App from [GitHub App setup](#github-app-setup) is installed on *every* member repo in the group).

## Skip if unchanged

Both `plan --repo` and `plan --repos` accept `--skip-if-unchanged`: before doing anything else (no clone, no OpenRouter call), it checks whether the repo(s) have moved since the last successful run and exits immediately if not.

- **Single-repo:** compares the live HEAD sha against `last_head_sha` already stored in the per-repo findings cache (`results/cache/<owner>__<repo>/findings.json`) — no new state needed.
- **Group:** compares every member's live HEAD sha against a small stored state (`results/cache/groups/<id>/state.json`); skips only when **all** members are unchanged — one member moving still triggers the joint pass.

**Trade-off, accepted deliberately:** this only looks at commits. A repo with no new commits but new/closed issues since the last run will be skipped too — issue-only changes won't trigger a re-plan in this mode. Opt-in (`--skip-if-unchanged` is never on by default), so plain manual `pnpm plan` runs are unaffected; both CI templates pass it.

## Bench chart

Aggregate overview (no fixture or model callouts): [`assets/bench/overview.svg`](../assets/bench/overview.svg).

## Optional bench ($20 protocol)

Kept for re-validation — uses a **bounded** evidence budget (not full-codebase plan mode).

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
    plan.ts           # propose-only entrypoint (--repo and --repos modes)
    apply.ts          # executes CREATE_ISSUE ops, gated onto Ready/Backlog
    planCodebase.ts   # single-repo chunked / incremental orchestration
    planGroup.ts      # joint multi-repo orchestration (reuses planCodebase per repo)
    findingsCache.ts  # content-hash findings cache
    remoteState.ts    # cheap remote HEAD sha + skip-if-unchanged guards
    snapshot.ts       # read-only gh + codebase capture
    codebase.ts       # whole-file walk + hashes
    evidence.ts       # bench vs full plan evidence + prompt instructions
    surface.ts        # .taskflow/surface.json loader + glob matching
    gh.ts             # shared gh CLI wrappers
    roster.ts         # live collaborators + .taskflow/roster.json skill tags
    renderBody.ts     # renders the Template A issue body for one CREATE_ISSUE op
    dor.ts            # authoritative Definition of Ready check (no network)
    dupCheck.ts       # live duplicate check against open issues
    openrouter.ts
    parsePlan.ts
    bench.ts
  ci/
    taskflow-schedule.yml.example    # copy into a target repo's .github/workflows/
    taskflow-cross-repo.yml.example  # joint mode — can live in either member repo
  fixtures/
    synthetic/
    snapshots/       # gitignored
  results/           # gitignored (plans, cache, CSV, apply reports)
```

## Privacy

- `plan`'s snapshot is **read-only** (`gh` + shallow clone). `apply` performs real writes (issue creation, Project field edits, assignment) scoped to `CREATE_ISSUE` operations only — see [Apply](#apply-scheduled--unattended-issue-creation).
- Full source text is sent to OpenRouter on cold/delta analysis — only plan repos you are willing to expose.
- Do not commit private snapshots, `.env`, or `results/cache/`.

## Model ids (bench)

| id | slug | Role |
|----|------|------|
| `gemini-flash` | `google/gemini-2.5-flash` | **Default** (`pnpm plan`) |
| `deepseek-chat` | `deepseek/deepseek-chat-v3-0324` | Cheap synthetic |
| `gpt41-mini` | `openai/gpt-4.1-mini` | Mid bench |
| `gemini-pro` | `google/gemini-2.5-pro` | Mid bench |
