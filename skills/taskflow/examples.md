# TaskFlow Examples

These examples demonstrate decisions and safety behavior. Adapt details to repository conventions.

## Example 1 — Unknown GitHub state is not Mode 1

Observed:

- local directory has code and no configured remote
- user says a private repository may already exist in their organization
- `gh auth status` reports expired credentials

Correct response:

```text
Repository state: UNKNOWN
Reason: GitHub authentication failed, and no local remote identifies the target.

I cannot safely classify this as Fresh Bootstrap because an inaccessible
repository may already exist. No creation plan will be executed.

Needed:
1. Restore GitHub authentication/SSO.
2. Confirm the intended OWNER/REPO.
3. Re-run repository and Project discovery.
```

Incorrect: entering Mode 1 and proposing a repository with a guessed name.

## Example 2 — Mode 1 Fresh Bootstrap

Evidence:

- user explicitly requests a new private `acme/threads` repository
- target nonexistence is confirmed
- local files contain no unresolved secret findings
- no application scaffolding was requested

Task flow:

```text
Wave A: T1 repository/CI baseline, T2 architecture decision
Wave B: T3 user schema → T4 authentication API
Wave C: T5 login UI (blocked by T4), T6 deployment validation
Critical path: T1 → T3 → T4 → T5 → T6
```

Plan excerpt:

```text
GITHUB CHANGE PLAN — Plan v1 (awaiting approval)
Target: github.com/acme/threads (ABSENT), Mode 1

OP-01 CREATE_REPOSITORY acme/threads private
OP-02 CREATE_PROJECT acme/"Threads MVP" (depends on OP-01)
OP-02b CREATE_VIEW "Board" layout=board (required; Status columns)
OP-02c ASK/SKIP Table + Roadmap unless user wants extras
OP-03 CREATE_ISSUE T1 "Establish repository and CI baseline" assignee=@me
OP-04 CREATE_ISSUE T3 "Define user persistence schema" assignee=@me
OP-05 CREATE_ISSUE T4 "Implement email/password authentication API" assignee=@me
OP-06 RELATE T4 blocked-by T3
OP-07 ADD_PROJECT_ITEMS T1,T3,T4 status=Ready

Approval requested: chooser — (1) Continue execute Plan v1  (2) Refuse no writes
```

After the plan, ask that Continue / Refuse question with the host’s multiple-choice UI when available. Do not ask the user to type “Approve Plan v1”.

## Example 3 — Mode 2 with an existing issue backlog

Evidence:

- `acme/payments` exists and Issues are enabled
- 28 open issues, no applicable active Project
- two open PRs implement parts of existing issues
- repository organization owns two unrelated Projects

Correct classification: **Mode 2**, because no applicable Project exists. The 28 issues affect triage depth but do not make it Mode 3.

Proposal:

- select/create one Project under `acme`
- reconcile all 28 issues within the agreed audit boundary
- link open PRs to canonical issues and keep those issues open
- update issues that fail Definition of Ready
- create only evidence-backed gaps
- add approved existing/new issues to the Project and set fields separately

Do not create a second repository or select an unrelated organization Project merely because it exists.

## Example 4 — Mode 3 duplicate and open PR

Evidence:

- active Project `acme/#12`
- #23 “Redesign dashboard” has the detailed discussion and current milestone
- #45 “Update dashboard components” duplicates the same outcome
- PR #70 is open and references #23

Reconciliation:

```text
KEEP #23 as canonical.
UPDATE #23 with any approved missing acceptance criteria from #45.
DEDUPLICATE #45 into #23 and close #45 with a pointer.
KEEP #23 open while PR #70 is open.
After PR #70 merges, evaluate Definition of Done before closing #23.
```

Incorrect: closing #23 because PR #70 exists, or claiming #45’s history was merged.

## Example 5 — Project draft prevents a duplicate

Evidence:

- Project draft “Define retention policy” has an owner and upcoming iteration
- no repository issue has that title

Correct action:

- treat the draft as existing tracking intent
- determine whether it should stay a draft or become an issue
- propose conversion/update instead of creating a parallel issue

The Project audit includes draft and archived items, not only issue items.

## Example 6 — Partial failure and residual plan

Approved Plan v3:

- OP-01 create Project
- OP-02 create issue T1
- OP-03 create issue T2
- OP-04 add T1/T2 to Project
- OP-05 set Status values

Execution:

- OP-01 succeeds: Project owner `acme`, number `15`, node ID recorded
- OP-02 succeeds: issue #41 recorded
- OP-03 fails due to validation
- dependent OP-04/OP-05 stop

Report:

```text
VERIFY — Plan v3
- OP-01 success: Project acme/#15, verified
- OP-02 success: issue #41, verified
- OP-03 failed: invalid milestone
- OP-04/OP-05 skipped because they depend on OP-03
- No duplicate resources detected
- Residual plan required
```

Residual Plan v4:

```text
OP-01 KEEP existing Project acme/#15 (no write)
OP-02 KEEP existing issue #41 (no write)
OP-03 CREATE_ISSUE T2 without invalid milestone
OP-04 ADD_PROJECT_ITEMS #41 and new T2
OP-05 SET_STATUS for both items
```

Do not rerun Plan v3.

## Example 7 — Stale is not automatically obsolete

Issue #80 has had no comments for 60 days, but:

- it is scheduled for the next release
- it is blocked by a vendor contract
- the owner updated the dependency last week

Action: `KEEP/UPDATE`, record blocker owner, next action, and review date. Do not close for inactivity.

An issue with no activity, no owner, no milestone, no linked code, superseded requirements, and no response after the agreed status window may be proposed as `CLOSE AS OBSOLETE` with evidence.

## Example 8 — Approval is a chooser, not typed text

Assistant presents Plan v1, then asks:

> Plan v1 is ready. What do you want to do?
> 1. Continue — execute Plan v1 as written
> 2. Refuse — no GitHub writes

- User picks **Continue** → execute Plan v1
- User picks **Refuse** → no writes; offer Revise only if they want changes
- User types “ok” / “sure” → re-ask the same Continue / Refuse chooser
- User says “make the repo public” → treat as revise intent; issue Plan v2; ask Continue / Refuse again for Plan v2

## Example 9 — Solo coder must be asked and assigned

Mode 1 or empty backlog. Agent asks:

> How many people will write code on this project?
> 1. Just me (1 coder)
> 2. 2 coders
> 3. 3+ coders

User picks **Just me**. Agent confirms `@me` (or their login).

Correct create plan: every new issue includes `assignee=@me` and VERIFY shows assignees populated.

Incorrect: leaving issues Unassigned “for the board” when there is only one coder.
