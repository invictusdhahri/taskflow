# TaskFlow Templates and Quality Gates

Templates exist so a stranger can open an issue and know exactly:

1. what “done” looks like (in caveman-simple words first)
2. which files are in play
3. how to prove it
4. what is intentionally not included

**Rule:** Prefer short, concrete language. Prefer checkboxes a reviewer can mark pass/fail without debate. If a section does not apply, write `N/A — <reason>`. Never leave a relevant section blank.

---

## Writing rules for observable work

### Titles
- Start with a verb: `Add`, `Fix`, `Implement`, `Document`, `Migrate`, `Remove`
- Name the outcome, not the activity: `Implement JWT auth for API routes` — not `Work on auth`
- One outcome per title

### Caveman (required — always first)
Put a **Caveman** section at the very top of the body (right after the taskflow marker). Goal: a tired developer understands the issue in under 20 seconds.

Rules:
- Tiny words. Short sentences. No jargon if a plain word works.
- Exactly three beats: **Problem** · **Do this** · **Done when**
- No tables, no links dump, no architecture essay
- Still accurate — simple ≠ wrong

| Bad Caveman | Good Caveman |
|-------------|--------------|
| Leverage the orchestration layer to surface clarifiers | Agent asks “how much?” Chat must show that question and wait for the answer. |
| Refactor activity retrieval pipeline | After send money works, web must show the recent payment in activity. |
| Ensure resilient degradation for media APIs | No mic? User still types. App must not break. |

Shape:

```markdown
## Caveman
- **Problem:** <what is broken or missing, plain words>
- **Do this:** <what to build/fix, plain words>
- **Done when:** <how a human can see it worked, plain words>
```

### Files to change (required for code issues)
List the paths the implementer should open first. Be honest about uncertainty.

Rules:
- Prefer concrete repo paths (`apps/web/src/...`) over vague areas (“the backend”)
- Mark confidence: `likely` / `maybe` / `verify`
- Include tests/docs paths when they must change
- If unknown, write what to search and where — not a fake file list
- Update the list in a PR comment if reality diverges

```markdown
## Files to change
| Path | Why | Confidence |
|------|-----|------------|
| `src/foo.ts` | main logic | likely |
| `src/foo.test.ts` | cover AC1–AC3 | likely |
| `docs/api.md` | document contract | maybe |

**Search if unsure:** <symbol, route, or folder to grep>
```

For non-code issues (pitch, video, docs-only): use `N/A — no code` and list doc/asset paths instead.

### Acceptance criteria (required)
Each criterion must be:

- **Observable** — someone can see, call, click, or measure it
- **Binary** — clearly pass or fail
- **Actor-aware** — who/what performs the action when it matters
- **Independent of internals** — describe behavior, not “add a middleware class,” unless the contract *is* the implementation

| Bad (vague) | Good (observable) |
|-------------|-------------------|
| Auth works correctly | Given valid email/password, `POST /login` returns `200` and a JWT |
| Handle errors properly | Given an expired JWT, protected routes return `401` with `{ "error": "unauthorized" }` |
| Improve performance | p95 for `GET /feed` stays under 300ms at 100 RPS in staging |
| Update the UI | Logged-in user sees their display name in the header within 1s of navigation |
| Add tests | Unit tests cover valid, expired, and malformed token cases and pass in CI |

Prefer this shape:

```text
Given <precondition>,
when <action>,
then <observable result>.
```

Or a flat checkbox with the same information packed into one line.

### Test plan vs acceptance criteria
- **Acceptance criteria** = what must be true
- **Test plan** = how we will prove those truths (commands, jobs, manual steps, evidence)

### Scope discipline
- **Scope** = what this issue delivers
- **Out of scope** = adjacent work someone might assume is included
- If out-of-scope work is needed, link a follow-up issue instead of stuffing it in

---

## Definition of Ready

Move an issue to `Ready` only when all boxes pass:

- [ ] **Caveman** is present (Problem / Do this / Done when) in plain language
- [ ] **Files to change** lists paths or an honest search plan (`N/A` only for true non-code work)
- [ ] **Outcome** is one sentence a new teammate understands
- [ ] **Scope** and **Out of scope** are explicit
- [ ] **Acceptance criteria** are observable and binary (at least one happy path + relevant failure/edge cases)
- [ ] **Test plan** says how each major criterion will be proven
- [ ] **Dependencies** are `None`, linked, or owned with a next action/date
- [ ] **NFR / docs / rollout** are filled or `N/A — reason`
- [ ] No open product/architecture decision blocks coding
- [ ] Size fits in ~2 weeks, or the issue is split
- [ ] Assignee is a real GitHub login (or `@me`); Unassigned only if the team chose **Manual** assignment (§1b) with 2+ coders

If Ready fails → keep in Backlog and `UPDATE`, split, or open a discovery issue.

---

## Definition of Done

Close as delivered only when applicable evidence exists:

- [ ] Every acceptance criterion is checked off with proof
- [ ] Code is merged to the intended branch
- [ ] Required CI/checks are green
- [ ] Manual validation is recorded when the test plan requires it
- [ ] Docs/migration/rollout items for this issue are done or `N/A`
- [ ] Residual work is linked as follow-ups, not implied
- [ ] Closure evidence comment is attached

Completion levels (state the intended one on the issue):

| Level | Means |
|-------|--------|
| **Implemented** | Merged to the intended branch |
| **Released** | Available in the target environment |
| **Validated** | Acceptance criteria confirmed with evidence |

A merge alone is Done only if the issue explicitly targets **Implemented**.

---

## Template A — Standard implementation issue

Use for features, integrations, migrations, and most bugs with non-trivial verification.

```markdown
<!-- taskflow:PLAN-vN:TN -->

## Caveman
- **Problem:** ...
- **Do this:** ...
- **Done when:** ...

## Files to change
| Path | Why | Confidence |
|------|-----|------------|
| `path/to/file` | ... | likely / maybe / verify |

**Search if unsure:** ...

## Outcome
<!-- One sentence: who gets what capability, and why it matters. -->

## Why this matters
<!-- 1–2 sentences of context. Link product/docs if useful. -->

## Scope
- [ ] ...

## Out of scope
- ...
- Follow-ups (if any): ...

## Acceptance criteria
<!-- Each line must be observable and pass/fail. -->
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

## Test plan
| Criterion | How we prove it | Evidence |
|-----------|-----------------|----------|
| AC1 | `pnpm test -- auth` / CI job `unit` | CI link |
| AC2 | Manual: steps in staging | Screenshot/notes |
| AC3 | `curl` script against staging | Command output |

**Automated**
- Commands/jobs: ...
- Required to pass before merge: yes/no

**Manual** (or `N/A — reason`)
- Environment:
- Data setup:
- Steps:
- Validator:

**Regression surface**
- Areas that could break: ...

## Non-functional requirements
| Area | Requirement | N/A? |
|------|-------------|------|
| Security / authz | ... | |
| Privacy / retention | ... | |
| Accessibility | ... | |
| Performance | ... | |
| Reliability / retries / idempotency | ... | |
| Observability / alerts | ... | |
| Compatibility / i18n / time zones | ... | |

## Documentation
- [ ] User-facing
- [ ] API / schema
- [ ] Developer setup
- [ ] Runbook / ops
- [ ] Release notes
- N/A: ...

## Release / rollout
- Done means: Implemented / Released / Validated
- Target environment: local merge / staging / production
- Strategy: direct / flag / staged / N/A — ...
- Migration / backward compatibility: ...
- Rollback: trigger + steps, or N/A — ...
- Watch: metric + window, or N/A — ...

## Dependencies
- Blocked by: None / #… / URL…
- Blocks: None / #… / URL…
- External: owner · needed by · last verified · next check

> **Required write:** also set native GitHub Relationships (`gh issue edit … --add-blocked-by` / `--add-blocking`, and `--parent` / `--add-sub-issue` when hierarchical). Body links alone leave the sidebar as “None yet”.

## Risks and assumptions
| Risk / assumption | Impact | Mitigation | Owner | Review by |
|-------------------|--------|------------|-------|-----------|
| ... | L/M/H | ... | ... | YYYY-MM-DD |

## Subtasks
<!-- Implementation steps that are not separate deliverables. -->
- [ ] ...
- [ ] ...

## Planning
- Priority: Critical / High / Medium / Low — because ...
- Size: S (1–2d) / M (3–5d) / L (1–2w)
- Estimate (proposal): ...
- Assignee: @login or `@me` (required when 1 coder or **Automatic** assignment; Unassigned only under **Manual** assignment)
- Labels: ...
- Milestone: ...
- Related: #… · PR #… · docs…

> **Required writes:** set Project **Size**, **Estimate**, **Priority**, and **Status** via `gh project item-edit`; repo **Labels** via `gh issue edit --add-label`; and **Assignee** via `gh issue edit --add-assignee` (use `@me` for the solo coder). Planning bullets alone leave the sidebar empty.
```

---

## Template B — Small issue (bugfix or tiny change)

Use when the change is small, risk is low, and Ready still holds.

```markdown
<!-- taskflow:PLAN-vN:TN -->

## Caveman
- **Problem:** ...
- **Do this:** ...
- **Done when:** ...

## Files to change
| Path | Why | Confidence |
|------|-----|------------|
| `path/to/file` | ... | likely |

**Search if unsure:** ...

## Outcome
<!-- One sentence. -->

## Current behavior
<!-- What happens today. Include repro if a bug. -->

## Expected behavior
<!-- What should happen instead. -->

## Acceptance criteria
- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

## Test plan
- Automated: ...
- Manual: ... / N/A — ...
- Regression: ...

## Out of scope
- ...

## Dependencies
- Blocked by: None / #…
- Blocks: None / #…

## Planning
- Priority: ... — because ...
- Size: S
- Assignee: @login or `@me` (required when 1 coder or **Automatic** assignment; Unassigned only under **Manual** assignment)
- Related: ...
```

---

## Template C — Timeboxed discovery

Use only when you cannot responsibly write implementation ACs yet.

```markdown
<!-- taskflow:PLAN-vN:TN -->

## Caveman
- **Problem:** we do not know enough to build yet
- **Do this:** answer the questions in the timebox
- **Done when:** we pick a path (or say we still cannot) and write follow-up issues

## Files to change
- N/A — discovery only (unless a tiny prototype path is listed below)
- Prototype paths (optional): ...

## Decision needed
<!-- One decision this spike must unlock. -->

## Why we cannot implement yet
<!-- Missing evidence / unknown constraint. -->

## Questions to answer
1. ...
2. ...
3. ...

## Timebox
- Budget: ... hours/days
- Stop when: answers are good enough to write implementation issues **or** budget is spent

## Required outputs
- [ ] Written recommendation with options and tradeoffs
- [ ] Recommendation owner + date
- [ ] Chosen option recorded (or explicit “no decision yet”)
- [ ] Follow-up implementation issues drafted for approval (not created unless approved)

## Non-goals
- Open-ended research with no decision artifact
- Shipping production code inside the spike unless explicitly approved

## Planning
- Priority: ...
- Assignee: ...
- Related: ...
```

---

## Template D — Closure evidence

Paste as a closing comment (or final issue section) before marking Done.

```markdown
## Closure evidence
- Resolution: delivered / duplicate of #… / obsolete / declined / cannot reproduce
- Completion level: implemented / released / validated
- Acceptance criteria:
  - [x] AC1 — evidence: ...
  - [x] AC2 — evidence: ...
- PR/commit: ...
- CI: ...
- Deployed to: ... (version/date) / N/A — issue targeted Implemented only
- Docs updated: ... / N/A — ...
- Validated by: @user on YYYY-MM-DD
- Residual risk: None / ...
- Follow-ups: None / #…
```

For duplicates: name the canonical issue and what scope moved. Do not claim “delivered.”

---

## Template E — Stale review

Inactivity is a signal, never an automatic close reason.

```markdown
## Stale review
- Issue: #…
- Last meaningful activity: YYYY-MM-DD — what happened
- Owner: @user / none
- Milestone / priority: ...
- Linked PR: none / #… (state)
- Dependency activity: ...
- Blocker: none / … — owner @user
- Next action: ...
- Review again by: YYYY-MM-DD
- Exemption: none / scheduled / external blocker / security / long-running
- Proposal: KEEP / UPDATE / MOVE TO LATER / ESCALATE / CLOSE AS OBSOLETE
- Evidence for proposal: ...
```

Before `CLOSE AS OBSOLETE`: ask the owner, wait for the team response window, confirm no active PR/dependency/commit contradicts closure, then record evidence.

---

## Filled example — readable standard issue

```markdown
<!-- taskflow:PLAN-v1:T4 -->

## Caveman
- **Problem:** apps cannot log users in safely yet
- **Do this:** add login that gives a token, and lock protected API routes behind that token
- **Done when:** good login returns a token; bad/missing/expired token gets rejected

## Files to change
| Path | Why | Confidence |
|------|-----|------------|
| `src/auth/login.ts` | issue JWT on valid credentials | likely |
| `src/auth/middleware.ts` | reject bad/missing/expired tokens | likely |
| `src/auth/login.test.ts` | cover AC cases | likely |
| `src/auth/middleware.test.ts` | cover protected-route cases | likely |
| `openapi.yaml` | document `/auth/login` + 401 shape | likely |

**Search if unsure:** `JWT`, `/auth`, `Authorization`

## Outcome
API clients can log in with email/password and call protected routes using a JWT.

## Why this matters
The web and mobile clients are blocked on a shared auth contract before any user-specific features can ship.

## Scope
- [ ] `POST /auth/login` issues a JWT for valid credentials
- [ ] Auth middleware rejects missing/invalid/expired tokens on protected routes
- [ ] Token TTL and error payload are documented for clients

## Out of scope
- OAuth / social login
- Refresh-token rotation UI
- Password reset
- Follow-ups: #12 login UI, #18 token refresh

## Acceptance criteria
- [ ] Given an existing user with valid email/password, when `POST /auth/login` is called, then the response is `200` with `{ "token": "<jwt>" }`
- [ ] Given invalid credentials, when `POST /auth/login` is called, then the response is `401` with `{ "error": "invalid_credentials" }` and no token
- [ ] Given a missing or malformed Authorization header, when a protected route is called, then the response is `401` with `{ "error": "unauthorized" }`
- [ ] Given an expired token, when a protected route is called, then the response is `401` with `{ "error": "unauthorized" }`
- [ ] Given a valid unexpired token, when a protected route is called, then the request is not rejected by auth middleware

## Test plan
| Criterion | How we prove it | Evidence |
|-----------|-----------------|----------|
| Login success/failure | `pnpm test -- auth` | CI job `unit` |
| Protected route auth | Integration tests in `auth.middleware.test.ts` | CI job `unit` |
| Contract docs | Review OpenAPI diff in PR | PR checklist |

**Automated**
- Commands/jobs: `pnpm test -- auth`, CI `unit`
- Required to pass before merge: yes

**Manual**
- N/A — covered by automated API tests

**Regression surface**
- Existing public routes must remain callable without a token
- Error JSON shape used by clients

## Non-functional requirements
| Area | Requirement | N/A? |
|------|-------------|------|
| Security / authz | Passwords compared with existing hashing; tokens signed with server secret; no token in logs | |
| Privacy / retention | Do not log email+password together; do not persist raw passwords | |
| Accessibility | | N/A — API only |
| Performance | `POST /auth/login` p95 < 200ms locally under trivial load | |
| Reliability / retries / idempotency | Login is read-mostly; duplicate submits may mint distinct tokens | |
| Observability / alerts | Log auth failures without secrets; count `auth.login.failure` | |
| Compatibility / i18n / time zones | Error codes stable English machine strings | |

## Documentation
- [x] API / schema — OpenAPI for `/auth/login` and 401 payloads
- [ ] User-facing — N/A
- [ ] Developer setup — note required `JWT_SECRET`
- [ ] Runbook / ops — N/A for MVP
- [ ] Release notes — mention auth contract for clients

## Release / rollout
- Done means: Validated in staging
- Target environment: staging
- Strategy: direct deploy
- Migration / backward compatibility: additive endpoint; no DB migration
- Rollback: revert deploy; clients keep using unauthenticated public routes
- Watch: `auth.login.failure` rate for 24h after deploy

## Dependencies
- Blocked by: #18 user schema
- Blocks: #12 login UI
- External: None

## Risks and assumptions
| Risk / assumption | Impact | Mitigation | Owner | Review by |
|-------------------|--------|------------|-------|-----------|
| Clients assume refresh tokens exist | M | Document MVP as access-token-only; open follow-up | @alex | 2026-07-25 |

## Subtasks
- [ ] Login handler + validation
- [ ] JWT sign/verify helpers
- [ ] Auth middleware on protected routes
- [ ] Tests for valid/invalid/expired/malformed cases
- [ ] OpenAPI update

## Planning
- Priority: High — because it unblocks all authenticated features
- Size: M (3–5d)
- Estimate (proposal): 3–4 days
- Assignee: @me
- Labels: feature, backend, security
- Milestone: MVP
- Related: #12 · #18
```

---

## GitHub change plan

Use before any write. Number every version. Approval must refer to the latest plan.

```text
GITHUB CHANGE PLAN — Plan vN (awaiting approval)

Target
- Host:
- Repository: OWNER/REPO (EXISTS | ABSENT | UNKNOWN)
- Mode: 1 | 2 | 3
- Project: OWNER/#N | CREATE under OWNER | none
- Coding team: N coder(s) — logins: @me | user1, user2
- Assignment mode: solo (1 coder) | automatic (skill match) | manual (unassigned, or all to one stated lead)
- Audit boundary:
- Evidence: complete | sampled — exclusions: ...

Preflight
- Auth / scopes / SSO: pass | blocked — ...
- Repo permission / capability: pass | blocked — ...
- Project permission: pass | blocked — ...
- Assignee eligibility: pass | N/A | blocked
- Push secret/history check: pass | N/A | blocked

Operations (in order)
- OP-01 CREATE_REPOSITORY ... [precondition]
- OP-02 CREATE_PROJECT ... [depends on: OP-01]
- OP-02b CREATE_VIEW Board (layout=board, Status columns) [required]
- OP-02c CREATE_VIEW Table/Roadmap ... [optional — only if user approved]
- OP-03 CREATE_ISSUE T1 "<title>" assignee=@me [depends on ...]
- OP-03b ASSIGN #… @me / login   [if create did not set assignee]
- OP-04 UPDATE_ISSUE #... — reason: ...
- OP-05 DEDUPLICATE #... → #... — reason: ...
- OP-06 CLOSE_ISSUE #... — resolution/evidence: ...
- OP-07 ADD_PROJECT_ITEM #... — fields: ...
- OP-08 ARCHIVE_PROJECT_ITEM ... — reason: ...

Skipped on purpose
- ...

Critical path
- ...

Verify after execution
- Expected repos / projects / issues / relationships / field values: ...

Approval
- Ask a chooser (do not request typed approval text):
  1. Continue — execute Plan vN as written
  2. Refuse — no GitHub writes
```

Do not mark blocked operations as executable. Explain the remediation first.

**Anti-pattern:** ending with “Reply with Approve Plan vN”. **Required:** end with the Continue / Refuse question.

---

## Verification report

```text
VERIFY — Plan vN

Ledger
- OP-01 success — identity/URL ... — verified yes/no
- OP-02 failed — category ... — dependents stopped

Expected vs actual
- Repository: ...
- Project / fields / workflows: ...
- Issues / relationships: ...
- Project items / statuses: ...

Unexpected changes or duplicates
- None | ...

Residual plan
- Not required | Plan vN+1 needed for ...
```

---

## Quick quality checklist before creating an issue

- [ ] **Caveman** is first (Problem / Do this / Done when) in plain words
- [ ] **Files to change** lists real paths or an honest search plan
- [ ] Title names an outcome
- [ ] Outcome is one sentence
- [ ] Out of scope prevents surprise work
- [ ] Every AC is observable and binary
- [ ] Test plan maps to the ACs
- [ ] Done level is stated (Implemented / Released / Validated)
- [ ] Dependencies are honest (and native Relationships will be set)
- [ ] A new teammate could execute this without chat history
