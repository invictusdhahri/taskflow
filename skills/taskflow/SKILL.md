---
name: taskflow
description: Generates and maintains GitHub-backed task flows. Use when the user wants to bootstrap a repository and GitHub Project, create a Project and issues for an existing repository, audit an existing Project or backlog, deduplicate issues, or turn project requirements into implementation-ready GitHub work.
license: MIT
metadata:
  version: "3.1.0"
---

# TaskFlow

Create an ordered, non-redundant task flow and the GitHub structure needed to run it. Prefer evidence over assumptions. Treat every external mutation as a write that requires approval.

## Non-negotiable rules

1. **No writes without approval.** First produce a numbered `GITHUB CHANGE PLAN`. Wait for approval that clearly refers to the latest plan. Writes include repository creation or push, issue/comment edits, labels, milestones, assignments, Project creation/configuration, item moves, closures, and duplicate marking.
2. **Unknown is not absent.** Authentication, authorization, SSO, network, rate-limit, and target-resolution failures must never be interpreted as proof that a repository or Project does not exist.
3. **Evidence before questions.** Inspect the repository, tracking state, and code first. Ask unresolved questions in one batch.
4. **One issue, one independently verifiable outcome.** Use checklist items for implementation steps that do not need separate ownership or delivery.
5. **Reuse existing conventions.** Do not invent labels, milestones, Project fields, status options, or assignments without approval.
6. **Open PRs are in-flight, not done.** Keep the canonical issue open until completion satisfies the Definition of Done. Do not create a redundant issue solely to mirror a PR.
7. **Native relationships are mandatory when supported.** Body text like “Blocked by #12” is not enough. Set GitHub Relationships (`blocked by` / `blocks`, and parent/sub-issue when it is a true hierarchy). Verify the sidebar is non-empty after writes.
8. **Project fields and labels are real writes.** If the plan states Size, Estimate, Priority, Status, or Labels, set them on the Project item and/or repository issue. Planning prose in the issue body does not populate the Project sidebar.
9. **Stop safely on failure.** Record completed operation identities, emit a partial verification report, and create a residual plan. Never rerun the whole plan blindly.
10. **Verify after writes.** Re-read GitHub state and report actual URLs, numbers, relationships, fields, labels, and mismatches.

For command-level GitHub and Projects V2 handling, read [github-operations.md](github-operations.md) before any GitHub inspection or write.

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
- whether proposed assignees are assignable
- whether the evidence set is complete or sampled

## 2. Detect the mode

Modes are mutually exclusive and based primarily on repository and Project state.

### Mode 1 — Fresh Bootstrap

Use only when a new GitHub repository is explicitly required and its target is confirmed absent.

Deliverable after approval:
- repository creation and optional initial push
- a Project under the confirmed user or organization owner with a **Board view as the default** (Status columns). Ask whether to also add Table and/or Roadmap views; Board is required.
- minimal approved metadata (Status at minimum; Priority/Size/Estimate when useful)
- an MVP-sized set of implementation-ready issues added to the Project

TaskFlow does not scaffold application code unless the user separately requests it.

### Mode 2 — Repository Without Applicable Project

Use when the repository exists but no applicable active Project exists, regardless of issue count.

Deliverable after approval:
- a new or intentionally selected Project with a **Board view as the default** (Status columns). Ask about optional Table/Roadmap; Board is required.
- triage/import of existing issues
- gap issues derived from code and user priorities
- Project membership and field values

Do not create another repository. Existing issues increase reconciliation depth; they do not change the mode.

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

Paginate rather than silently relying on default limits. If the backlog is too large for a full audit, sample only after declaring the boundary and obtaining agreement.

Summarize evidence in 5–10 lines before proposing work.

## 4. Generate the ordered task flow

Default to the next shippable slice or current milestone. For a roadmap, separate `Now`, `Next`, and `Later`; do not create every speculative item unless requested.

Each task must:

- lead with a **Caveman** section (Problem / Do this / Done when) in plain language
- include **Files to change** (concrete paths, or an honest search plan; `N/A` only for true non-code work)
- produce one user-visible or system-visible outcome
- pass the Definition of Ready in [templates.md](templates.md)
- have observable acceptance criteria and a test plan
- state scope and out-of-scope
- record applicable non-functional requirements
- include dependencies, risks, documentation, and rollout implications when relevant
- be independently verifiable and normally fit within two weeks

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

Approval rules:

- Full approval: execute only the latest plan
- Partial approval: execute only named operations
- Revision: issue a new plan version; prior approval becomes invalid
- Ambiguous acknowledgement (`ok`, `sure`, `thanks`): ask whether to execute the named plan
- Destructive operations (mass close, Project deletion, rebuild): require explicit approval naming the operation

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
