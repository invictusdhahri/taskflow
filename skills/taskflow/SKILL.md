---
name: taskflow
description: Generates and maintains GitHub-backed task flows. Use when the user wants to bootstrap a repository and GitHub Project, create a Project and issues for an existing repository, audit an existing Project or backlog, deduplicate issues, or turn project requirements into implementation-ready GitHub work.
license: MIT
metadata:
  version: "3.7.0"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(gh *)
  - Bash(git *)
  - Bash(python *)
  - Bash(python3 *)
---

# TaskFlow

Create an ordered, non-redundant task flow and the GitHub structure needed to run it. Prefer evidence over assumptions. Treat every external mutation as a write that requires approval.

## Non-negotiable rules

1. **No GitHub content writes without plan approval.** First produce a numbered `GITHUB CHANGE PLAN`. Then ask a **Continue / Refuse** chooser (native multiple-choice when available). Do not ask the user to type free-form approval text. Content writes include repository creation or push, issue/comment edits, labels, milestones, assignments, Project creation/configuration, item moves, closures, and duplicate marking.
2. **Ask tool permission once per TaskFlow run — not on every `gh` call.** At session start (before evidence gathering), ask a single Continue / Refuse chooser for GitHub CLI / git / shell access. After **Continue**, do not re-ask for the same class of read/inspect commands mid-run. Plan Continue / Refuse still gates mutations.
3. **Unknown is not absent.** Authentication, authorization, SSO, network, rate-limit, and target-resolution failures must never be interpreted as proof that a repository or Project does not exist.
4. **Evidence first, questions second.** Inspect the repository, tracking state, and code first. Ask unresolved questions in one batch.
5. **Code shape is not proof of intent.** Commented-out code, hardcoded disable flags, private/underscore-prefixed routes, and bare TODOs describe a *state*, not a decision. Before proposing to restore/wire up/enable/fix such code, look for corroborating evidence (commit message, PR, linked issue, changelog, doc) explaining why. If none exists, do not draft a ready CREATE issue guessing at intent — add a targeted question to the batch and hold the item as `NEEDS CONFIRMATION` until answered.
6. **One issue, one independently verifiable outcome.** Use checklist items for implementation steps that do not need separate ownership or delivery.
7. **Reuse existing conventions.** Do not invent labels, milestones, Project fields, status options, or assignments without approval.
8. **Open PRs are in-flight, not done.** Keep the canonical issue open until completion satisfies the Definition of Done. Do not create a redundant issue solely to mirror a PR.
9. **Native relationships are mandatory when supported.** Body text like “Blocked by #12” is not enough. Set GitHub Relationships (`blocked by` / `blocks`, and parent/sub-issue when it is a true hierarchy). Verify the sidebar is non-empty after writes.
10. **Project fields and labels are real writes.** If the plan states Size, Estimate, Priority, Status, or Labels, set them on the Project item and/or repository issue. Planning prose in the issue body does not populate the Project sidebar.
11. **Stop safely on failure.** Record completed operation identities, emit a partial verification report, and create a residual plan. Never rerun the whole plan blindly.
12. **Verify after writes.** Re-read GitHub state and report actual URLs, numbers, relationships, fields, labels, and mismatches.

For command-level GitHub and Projects V2 handling, read [github-operations.md](github-operations.md) before any GitHub inspection or write.

## 0. Session tooling permission (ask once)

Hosts like Claude Code / Cursor may prompt on every shell/`gh` call. TaskFlow must not add to that noise.

**At the very start of a TaskFlow run**, before listing issues or touching GitHub, ask one chooser:

> TaskFlow needs GitHub CLI (`gh`), git, and light shell/python to inspect and (later) update your repo/Project.
> 1. **Continue** — allow these tools for this TaskFlow run
> 2. **Refuse** — stop; no tool access

Then:

| Choice | Behavior |
|--------|----------|
| Continue | Proceed with evidence gathering. Do **not** re-ask for the same tool class on each `gh issue list`, `gh project …`, etc. |
| Refuse | Stop TaskFlow; explain what cannot run |

Still keep the later **plan** Continue / Refuse before any GitHub **mutations**.

If the host keeps showing its own system permission dialogs, that is outside the skill — point the user at README allowlist settings. While waiting, batch commands so one host approval covers the next burst when possible.

`allowed-tools` in this skill’s frontmatter pre-approves `gh` / `git` / read tools on agents that honor it (for example Claude Code on the skill-invoke turn). For whole-session quiet mode, the user should add matching allow rules in their agent settings.

## 1. Resolve the target and preflight

Resolve the explicit GitHub host and `OWNER/REPO`. Do not assume `origin` is correct when multiple remotes, forks, or transfers exist.

Classify repository lookup as exactly one of:

- `EXISTS` — accessible repository identity confirmed
- `ABSENT` — nonexistence confirmed and the user intends to create it
- `UNKNOWN` — auth, permission, SSO, network, rate limit, wrong target, or other unresolved failure

If `UNKNOWN`, remain read-only and report the blocker. Do not choose a creation mode.

Before an executable plan, check:

- authentication, host, scopes, SSO, and rate limits
- repository owner, visibility, default branch, fork/parent, archived state, Issues enabled, and viewer permission
- Project owner, access, visibility, linked repositories, fields, workflows, and applicable views
- for new Projects: Board view is in the plan by default; ask whether Table/Roadmap are also wanted
- **existing persisted context** (see §1a) — check before assuming a fresh start
- **coding team roster** (required — see §1b) **and planning context** (required — see §1c)
- whether proposed assignees are assignable on the target repo
- whether the evidence set is complete or sampled
- **every** authenticated `gh` account, not just the one marked `Active`. `gh auth status` can list several logged-in accounts; the active one may have no access at all to the target while a second account does. Test the actual target repo/org against each listed account before concluding access is `UNKNOWN` or `ABSENT` — do not stop at the first 404.

## 1a. Check for existing TaskFlow context

Before evidence-gathering (§3), check whether the resolved repo already carries persisted TaskFlow context from a prior run — this is what lets a brand-new chat session (this user's, or a teammate's, in any environment) pick up where an earlier one left off, instead of re-deriving the Project link, roster, or deadline from scratch.

```bash
gh api repos/OWNER/REPO/contents/.taskflow/project.json --jq '.content' 2>/dev/null | base64 -d
```

**Missing file → no prior context.** Proceed to §1b/§1c as normal fresh questions. This is expected and normal on a repo's first TaskFlow run — never treat it as an error.

**Found → treat it as a claim as of its `updatedAt` timestamp, not ground truth.** Spot-check before trusting:

- `gh project view NUMBER --owner OWNER --format json` — confirms the Project still exists
- if `milestones` is populated, `gh api repos/OWNER/REPO/milestones/N` (the stored milestone **number**, never a title-string match — titles can contain non-ASCII punctuation that breaks exact comparison silently) — confirms the milestone still exists

A 404 here means the persisted context is **stale/invalidated**, which is a different, more important thing to say out loud than "no context" — tell the user explicitly ("this repo's TaskFlow context pointed at Project #N, which no longer resolves") rather than silently falling back, then proceed as if no file existed.

If the Project and any referenced milestones resolve, surface a single confirmation line instead of re-asking everything or silently trusting everything:

> Found existing TaskFlow context: Project `OWNER/#N` (`<url>`), deadline `<date>`, roster: `<coderCount> coders, <assignmentMode>`, linked repos: `<list>`. Still accurate?

- **Yes / mostly** → feed these values into §1b/§1c as pre-filled confirmations, not fresh questions; only ask about what changed.
- **No / things changed** → fall through to §1b/§1c as normal; the refreshed answers overwrite the file on the next write-back (see [github-operations.md](github-operations.md)).

If `.taskflow/roster.json` also exists (a separate, pre-existing convention — login → skill tags for auto-assignment), read it when the roster's assignment mode is **Automatic**, instead of re-collecting skill tags from the user by hand.

## 1b. Coding team roster (required)

Always learn who will code before generating or assigning work. This is mandatory in **Mode 1**, and still required in Modes 2–3 unless a roster was already confirmed earlier in the same run.

Ask with a chooser when possible:

> How many people will write code on this project?
> 1. Just me (1 coder)
> 2. 2 coders
> 3. 3+ coders
> 4. Not sure yet

Then collect:

| If | Ask / do |
|----|----------|
| **1 coder** | Confirm their GitHub login (default `@me` / the authenticated `gh` user). **Assign every created/updated actionable issue to them** unless they explicitly refuse assignment. |
| **2+ coders** | Ask **first**, before collecting anyone's login, how assignment should work (see below). Then act on the answer. |
| **Not sure** | Default to **1 coder = current `gh` user** and say so; assign to `@me` unless they correct you. |

For **2+ coders**, ask the assignment-mode chooser before any roster/skillset collection:

> How should issues get assigned?
> 1. **Automatic** — I'll collect each person's GitHub login + focus area, then assign by skill match
> 2. **Manual** — leave every new/updated issue Unassigned; a manager/founder will assign by hand (or tell me one person, e.g. a lead, to receive everything instead of leaving items Unassigned — still Manual, no skill-matching runs)

| Answer | Do |
|--------|----|
| **Automatic** | Ask for each person's GitHub login + focus (frontend/backend/full-stack/etc.). Assign each created/updated issue to the best skill match. |
| **Manual** | Skip roster/skillset collection entirely. Leave all new/updated issues Unassigned (or all assigned to one stated lead login, if given). State that a manager/founder will assign by hand. |

Rules:

- Do **not** default the whole backlog to Unassigned when there is a known solo coder.
- “Suggested assignee” in the issue body is not enough — use `gh issue edit N --add-assignee LOGIN` (or `@me`) on create/update.
- Verify assignability before the plan; if someone cannot be assigned, say why and ask for an alternate login.
- Non-coding stakeholders (PM, design-only) are optional; do not count them as coders unless they will open PRs.

## 1c. Planning context (ask alongside the roster, same batch)

Ask these together with the §1b roster questions, before drafting Plan v1 —
not as follow-ups after the user notices a gap in an already-approved plan.
Learning these late is what forces repeated re-plans over the same ground.

**Deadline / timeline.** Ask directly:

> Is there a deadline or target date for this work?

A deadline changes task sizing and ordering, not just scheduling. It decides
whether the first wave should split a large foundational task into smaller,
faster-landing pieces (so a second coder has something to pick up sooner) or
can stay as fewer, larger issues. Convert any relative date the user gives
("next Friday", "in two weeks") to an absolute date before using it, and set
it as the relevant GitHub Milestone's due date once one exists.

**Parallelization, whenever there are 2+ coders.** Do not wait for the user
to notice one person is idle partway through. Ask directly:

> With N coders, should the first wave guarantee at least one dependency-free
> item so both people can start on day one, or is sequential work fine?

If a deadline exists, default to assuming the answer is yes: make sure Plan
v1's first wave contains at least one zero-dependency item per coder —
splitting a monolithic foundation task if that's what it takes — rather than
proposing the split reactively after the user raises "we don't want to block
each other."

**Cross-cutting concerns checklist.** Ask once, as part of the same batch,
whether any of these should get tracked issues in this pass. Do not wait for
the user to bring each one up individually across several turns:

- Security / rate-limiting / abuse hardening on public or write endpoints
- CI / automated testing (lint, typecheck, unit, e2e) — check whether it
  already exists (`.github/workflows/`, deploy pipelines) before assuming
  it's missing, and check whether docs (README) describe CI that doesn't
  actually exist yet — that mismatch is itself worth flagging
- Design system / branding assets (colors, logo, typography) if the project
  has a frontend and no established visual identity yet
- Infrastructure/hosting decisions (database provider, hosting platform,
  deployment target) — these can arrive mid-session as a casual aside ("we're
  using X for the database") well after evidence-gathering; when they do,
  treat it as reason to re-open and rescope any already-drafted schema/infra
  task rather than filing it as unrelated new information

Skip any category the user says isn't relevant yet. Do not manufacture
issues for a category with no evidence and no expressed interest — ask,
then act on the answer, the same way the roster question works.

## 2. Detect the mode

Modes are mutually exclusive and based primarily on repository and Project state.

### Mode 1 — Fresh Bootstrap

Use only when a new GitHub repository is explicitly required and its target is confirmed absent.

Deliverable after approval:
- repository creation and optional initial push
- a Project under the confirmed user or organization owner with a **Board view as the default** (Status columns). Ask whether to also add Table and/or Roadmap views; Board is required.
- minimal approved metadata (Status at minimum; Priority/Size/Estimate when useful)
- an MVP-sized set of implementation-ready issues added to the Project
- coding team roster confirmed; assignees set on issues (solo coder → assign that person)

TaskFlow does not scaffold application code unless the user separately requests it.

### Mode 2 — Repository Without Applicable Project

Use when the repository exists but no applicable active Project exists, regardless of issue count.

Deliverable after approval:
- a new or intentionally selected Project with a **Board view as the default** (Status columns). Ask about optional Table/Roadmap; Board is required.
- triage/import of existing issues
- gap issues derived from code and user priorities
- Project membership and field values
- coding team roster confirmed; new/updated issues assigned per §1b

### Mode 3 — Existing Project Audit

Use when an applicable Project exists, or when the user explicitly asks for backlog-only cleanup without creating a Project.

Deliverable after approval:
- reconciliation of Project items, issues, PRs, code, and recent delivery history
- `CREATE`, `UPDATE`, `DEDUPLICATE`, `CLOSE`, `KEEP`, `MOVE`, or `ARCHIVE ITEM` proposals
- sparing gap-fill work

Reuse the applicable Project. Do not rebuild it unless the user explicitly approves a rebuild.

### Ambiguous Project selection

If multiple user- or organization-owned Projects could apply, compare linked repositories and contained items, then ask the user to select. Never create a new Project merely because the first listing missed an existing one.

## 3. Gather bounded evidence

State the audit boundary before analysis:

- repository or repositories
- Project owner and number, if applicable
- active milestone/view/labels, or date window
- total records versus records inspected
- inaccessible or excluded records

Inspect as applicable:

- local status, remotes, default branch, recent commits, manifests, README/docs
- tracked, staged, untracked, and ignored secret risks before any push
- all relevant open issues plus recently closed issues
- open PRs plus recently merged/closed PRs and closing relationships
- Project issue, PR, draft, and relevant archived items
- fields, status options, workflows, linked repositories, labels, milestones, and assignees
- TODOs, stubs, failing tests, incomplete migrations, and code/tracking mismatches
- Ambiguous-intent signals (rule 5) — inspect but do not treat as self-explanatory: commented-out blocks, hardcoded disabled/false flags, private/underscore-prefixed folders or routes, and TODOs with no ticket reference. Look for a commit message, PR, linked issue, changelog, or doc that explains *why* before assuming it's broken rather than deliberate.

Paginate rather than silently relying on default limits. If the backlog is too large for a full audit, sample only after declaring the boundary and obtaining agreement.

### 3a. Parallel evidence gathering (when the host supports subagent dispatch)

Split evidence gathering into independent, bounded missions instead of one long sequential pass:

1. **GitHub tracking-state mission** — issues/PRs/Project items/labels/milestones/relationships for the resolved `OWNER/REPO`, per the Evidence completeness section of [github-operations.md](github-operations.md).
2. **Codebase mission** — TODOs/stubs/failing tests/manifests/code-tracking mismatches, and rule 5's ambiguous-intent signals.
3. **Related-repository mission(s)** — one per repo confirmed in §3b, each answering a narrow stated question.

Rules:

- Dispatch missions that have no dependency on each other together, not one at a time.
- Each mission returns a **compact structured summary** (counts and flagged items), not raw command/grep output. The orchestrating turn merges summaries; it does not re-read everything a mission saw.
- If the host has no subagent-dispatch tool, run the same three bounded missions sequentially in the current turn instead — the structure (bounded scope, structured summary) still applies without the parallelism.
- Subagent dispatch is evidence-only. Mode detection (§2), task generation (§4), reconciliation (§5), and every write in §8 stay in the orchestrating turn — they need a single holistic view and a single operation ledger.

### 3b. Related-repository discovery (confirm before scanning)

After the target repo is resolved (§1), identify related-repo *candidates*: other git remotes/submodules, workspace siblings with README/naming cross-links, or repos the user names.

- Never scan a candidate without confirmation. Ask one batched question listing the candidates (chooser or numbered list) as part of the existing "ask unresolved questions in one batch" step (rule 4) — do not add a second round-trip.
- Dispatch a mission only for confirmed repos, each with a narrow question, for example: "does this repo reference OWNER/REPO's issues, share Project conventions, or contain code this backlog depends on?"
- Findings fold into the evidence summary with explicit repo attribution. Writes stay scoped to the originally resolved `OWNER/REPO` unless the user separately approves expanding scope.

Summarize evidence in 5–10 lines before proposing work.

## 4. Generate the ordered task flow

Default to the next shippable slice or current milestone. For a roadmap, separate `Now`, `Next`, and `Later`; do not create every speculative item unless requested.

When issues are organized into Now/Next/Later waves, create matching GitHub Milestones for the waves being tracked (or explicitly note why not, e.g. only one wave is in scope right now) — forward-looking issues should have a stated home rather than being left milestone-less by default.

Each task must:

- lead with a **Caveman** section (Problem / Do this / Done when) in plain language
- include **Files to change** (concrete paths, or an honest search plan; `N/A` only for true non-code work)
- produce one user-visible or system-visible outcome
- pass the Definition of Ready in [templates.md](templates.md)
- have observable acceptance criteria and a test plan
- state scope and out-of-scope
- record applicable non-functional requirements
- include dependencies, risks, documentation, and rollout implications when relevant
- include a real **Assignee** (GitHub login or `@me`) — Unassigned only when the team chose Manual assignment (§1b) with 2+ coders
- be independently verifiable and normally fit within two weeks

If a proposed task's premise rests only on code shape with no corroborating tracked evidence (rule 5), do not present it as a ready `CREATE` in the task flow. Mark it `NEEDS CONFIRMATION`, add a targeted question to the batched clarifying-questions set (rule 4), and hold it out of the plan until answered.

Use provisional IDs (`T1`, `T2`) before GitHub numbers exist. Produce:

1. delivery waves that show safe parallelism
2. explicit blocking relationships
3. a one-sentence critical path
4. a cycle check

Create parent issues and blockers before dependents so native relationships can reference real issue numbers.

## 5. Reconcile instead of duplicating

Compare intent, affected surface, acceptance criteria, and delivery state—not title keywords alone.

- Same outcome and surface: `DEDUPLICATE` or `KEEP` canonical issue
- Same feature, different independently deliverable surfaces: keep separate and link
- Existing issue is vague: `UPDATE`, not create a replacement
- Open PR implements it: link PR; keep canonical issue open
- Merged PR may complete it: evaluate Definition of Done and closure evidence
- Project draft already represents it: update/convert or keep; do not silently duplicate
- Closed item appears incomplete: propose `REOPEN` only with evidence

Closing a duplicate means updating the canonical issue, marking the other as duplicate where supported, and leaving a pointer. GitHub does not merge issue histories.

## 6. Apply lifecycle gates

Use the lifecycle definitions in [templates.md](templates.md).

- `Backlog → Ready`: Definition of Ready passes
- `Ready → In Progress`: owner/capacity is confirmed
- `In Progress → Validation`: implementation and test evidence are attached
- `Validation → Done`: Definition of Done passes
- `Blocked`: blocker, owner, next action, and review date are recorded

Never infer completion solely from a Project status, merged code, inactivity, or an open PR.

Stale candidates require evidence: configurable inactivity window, owner/milestone check, linked PR and dependency activity, status request, and exemptions for scheduled, externally blocked, security-sensitive, or long-running work. Never auto-close solely for inactivity.

## 7. Produce a versioned change plan

Use the exact plan format in [templates.md](templates.md). Number every plan (`Plan v1`, `Plan v2`).

### Approval UX (required — do not ask for free-typed approval text)

After showing the plan, **stop and ask a chooser question**. Do **not** tell the user to type sentences like `Approve Plan v1` or `looks good, create them`.

Prefer the host’s native multiple-choice / AskQuestion UI when available (Claude Code, Cursor, etc.). If no chooser exists, still present **numbered options** and ask them to pick a number.

**Default gate (always use this first):**

> Plan vN is ready. What do you want to do?
> 1. **Continue** — execute Plan vN exactly as written (GitHub writes allowed)
> 2. **Refuse** — do not write anything; keep this as proposal-only

Meaning:

| Choice | Action |
|--------|--------|
| Continue | Execute the latest plan fully |
| Refuse | No writes. Stay idle until they ask for a revision or a new plan |

**Only if they ask for more control**, or after Refuse when they want changes, offer a follow-up chooser:

> 1. **Revise** — I will update the plan (no writes yet)
> 2. **Partial** — I will ask which OP-## lines to run
> 3. **Cancel** — stop

Never treat `ok` / `sure` / `thanks` as Continue. If they reply with ambiguous chat text instead of picking an option, re-ask the Continue / Refuse chooser.

Destructive plans (mass close, Project delete, rebuild) use the same Continue / Refuse chooser, but the question label must name the destructive action clearly (for example “Continue — close 12 issues and rebuild the board”).

Rename issue consolidation as `DEDUPLICATE`, never `MERGE`, to avoid confusion with PR merging. PR merge is out of scope unless separately requested.

## 8. Execute and recover safely

Before each write, re-check that the target resource still matches the approved precondition.

Record an operation ledger containing:

- plan version and operation ID
- resource type and target
- created URL/number/node ID/Project item ID
- result and verification state

Use stable identity rather than title matching. An approved marker such as `<!-- taskflow:T3 -->` may be used in generated issue bodies to make recovery idempotent.

On failure:

1. stop dependent writes
2. inventory and verify completed writes
3. report partial success and failure
4. generate a residual `GITHUB CHANGE PLAN`
5. wait for approval if recovery changes scope or behavior

## 9. Verify delivery

Operational verification confirms GitHub state matches the plan. Delivery verification confirms work is actually done.

After GitHub writes, verify:

- repository identity, visibility, default branch, and remote
- Project owner, visibility, linked repository, fields/options/workflows
- issue title/body, labels, milestone, assignee, state reason, parent, dependencies
- Project membership, item ID, and intended field values
- duplicate relationships and absence of accidental duplicates

Before closing delivered work, require the Definition of Done and structured closure evidence from [templates.md](templates.md).

Report:

```text
VERIFY — Plan vN
- Successful operations: ...
- Failed/skipped operations: ...
- Created/updated URLs: ...
- State mismatches: ...
- Residual plan required: yes/no
```

## Supporting references

- [github-operations.md](github-operations.md) — authentication, discovery, Projects V2, issue relationships, execution, and recovery
- [templates.md](templates.md) — issue contract, Ready/Done gates, change plan, closure evidence
- [examples.md](examples.md) — end-to-end mode and recovery examples

## Success criteria

The correct target and mode are established; the task flow is ordered, implementation-ready, and non-redundant; GitHub state matches the latest approved plan; no writes occur without approval; and both operational and delivery verification are explicit.
