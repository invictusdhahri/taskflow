# GitHub Operations Reference

Read this before inspecting or mutating GitHub. GitHub CLI features vary by version and host; inspect `gh help <command>` before relying on a flag that is not demonstrated below.

## Authentication and target resolution

Start with:

```bash
gh auth status
git remote -v
git status --short
```

Resolve:

- GitHub host (`github.com` or GitHub Enterprise)
- authenticated account
- explicit `OWNER/REPO`
- intended remote name
- whether `origin` is a fork, parent, stale URL, or unrelated repository

Then inspect the explicit target:

```bash
gh repo view OWNER/REPO --json nameWithOwner,url,visibility,isArchived,hasIssuesEnabled,viewerPermission,isFork,defaultBranchRef
```

Do not infer absence from a nonzero exit alone. Classify failure:

- Authentication: fix/refresh auth; no writes
- Authorization/SSO: request appropriate access; no writes
- Network/rate limit: retry later or report; no writes
- Wrong/ambiguous target: clarify target; no writes
- Confirmed not found plus user intent to create: repository may be `ABSENT`

If the repository is archived, Issues are disabled, or permission is insufficient, produce a blocker or separate remediation operation in the change plan.

## Permission and capability preflight

Before presenting an executable plan, establish:

- repository create rights (Mode 1)
- repository issue/metadata rights
- Project read/write/admin rights under the selected user or organization
- required `project` scope and organization SSO authorization
- whether organization policy restricts repository or Project creation
- assignee eligibility
- Project and repository visibility/access implications

Project access and repository access are independent. A user may see one but not the other.

## Evidence completeness

CLI defaults truncate many listings. Use pagination or sufficiently high explicit limits, and compare fetched counts to totals when available.

Repository evidence should include:

```bash
gh issue list --repo OWNER/REPO --state open --limit 1000 \
  --json number,title,state,labels,assignees,milestone,updatedAt,url

gh issue list --repo OWNER/REPO --state closed --limit 1000 \
  --json number,title,state,stateReason,closedAt,updatedAt,url

gh pr list --repo OWNER/REPO --state open --limit 1000 \
  --json number,title,state,isDraft,baseRefName,headRefName,updatedAt,url

gh pr list --repo OWNER/REPO --state merged --limit 1000 \
  --json number,title,state,mergedAt,baseRefName,url

gh label list --repo OWNER/REPO --limit 1000
```

Define a recent-history window appropriate to the project. If the inventory exceeds practical analysis size, state the selection rule (for example, active milestone + updated in 90 days) and what was excluded.

GitHub CLI has no general `gh milestone list` command. Enumerate milestones through the API:

```bash
gh api --paginate \
  -H "Accept: application/vnd.github+json" \
  "/repos/OWNER/REPO/milestones?state=all&per_page=100"
```

Use issue/PR `view --json` or `gh api graphql` for closing references, parent/sub-issues, blocking relationships, and other fields not present in list output.

## Projects V2 discovery

Projects V2 are owned by users or organizations, not repositories. Record each candidate as:

- owner login
- Project number
- node ID
- URL
- visibility/access
- linked repositories

Search every plausible owner (repository organization and relevant user owner), including closed Projects when appropriate:

```bash
gh project list --owner OWNER --limit 100
gh project list --owner OWNER --limit 100 --closed
```

For each candidate, inspect:

```bash
gh project view NUMBER --owner OWNER --format json
gh project field-list NUMBER --owner OWNER --format json
gh project item-list NUMBER --owner OWNER --limit 1000 --format json
```

Also inspect Project membership on representative issues/PRs when a Project may contain repository work without being linked. Include:

- issue items
- PR items
- draft items
- relevant archived items
- linked repositories
- fields and options
- workflows that may close issues or mutate fields

If multiple Projects apply, ask the user to select. Do not create a duplicate Project.

## Projects V2 model

Use Projects V2 terminology:

- **Project** — user- or organization-owned container
- **Item** — issue, PR, or draft item
- **Field** — Status, Priority, iteration, number, date, text, etc.
- **Field option** — value of a single-select field, such as `Ready`
- **View** — table, board, or roadmap presentation
- **Workflow** — automation that may add items, set fields, archive items, or close issues

A board “column” is a displayed value of a field such as `Status` (for example Backlog / Ready / In progress / In review / Done). It is not a classic Project column object.

### Default view policy (TaskFlow)

When creating a Project in Mode 1 or Mode 2:

1. **Board is required and default.** Every new Project plan must include a Board view grouped/laid out by **Status**.
2. **Ask about extras.** After confirming Board, ask once whether to also add:
   - Table (spreadsheet-style triage)
   - Roadmap (timeline)
3. Do not ship a Project that only has an unnamed default table with no Board unless the API cannot create views — then say so in VERIFY and give a one-step UI fallback (“New view → Board → Group by Status”).

Default Status options to reuse or create when missing:

- `Backlog`
- `Ready`
- `In progress`
- `In review`
- `Done`

(If the Project already has a close variant such as `In Progress`, reuse it — do not invent duplicates.)

`gh project create` creates a Project but does not configure Board for you. After create:

1. decide owner and visibility
2. create the Project
3. link the repository explicitly if approved
4. inspect built-in fields (especially Status) before creating custom fields
5. create/configure Priority, Size, Estimate when approved
6. **create the Board view** (required), then optional Table/Roadmap if approved
7. verify views exist before claiming Project setup is complete

### Creating views via REST

Prefer the Projects views REST API (GraphQL still lacks reliable view create mutations):

```bash
# Org-owned project
gh api \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  "/orgs/ORG/projectsV2/PROJECT_NUMBER/views" \
  -f name='Board' \
  -f layout='board'

# User-owned project (numeric user id from `gh api user --jq .id`)
USER_ID=$(gh api user --jq .id)
gh api \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  "/users/${USER_ID}/projectsV2/PROJECT_NUMBER/views" \
  -f name='Board' \
  -f layout='board'
```

Optional extras (only if the user approved them):

```bash
-f name='Table' -f layout='table'
-f name='Roadmap' -f layout='roadmap'
```

After create, open the Project URL and confirm the Board is present and Status columns appear. If the API creates the Board but grouping is wrong, report that limitation and provide the UI step: set the Board to group by **Status**.

Never claim an unsupported UI configuration succeeded.

Adding an issue and setting its Status are separate operations:

1. add the issue to the Project
2. capture the Project item ID
3. capture the Project field ID and selected option ID
4. edit that Project item’s field value
5. verify the resulting value

**Body “Planning” text does not set Project fields.** If Size, Estimate, Priority, Status, Start date, or Target date are part of the plan, write them with `gh project item-edit` (one field per invocation):

```bash
# Size / Priority / Status (single-select)
gh project item-edit --id ITEM_ID --project-id PROJECT_ID \
  --field-id SIZE_FIELD_ID --single-select-option-id OPTION_ID

# Estimate (number)
gh project item-edit --id ITEM_ID --project-id PROJECT_ID \
  --field-id ESTIMATE_FIELD_ID --number 4

# Dates
gh project item-edit --id ITEM_ID --project-id PROJECT_ID \
  --field-id DATE_FIELD_ID --date 2026-07-25
```

**Labels are repository metadata.** The Project “Labels” column mirrors issue labels. Set them with:

```bash
gh label list --repo OWNER/REPO --limit 100
gh issue edit N --repo OWNER/REPO --add-label enhancement,web
```

**Assignees are real writes.** Body “Assignee: …” does not assign anyone.

```bash
# Solo coder (most common for new projects)
gh issue edit N --repo OWNER/REPO --add-assignee "@me"

# Named teammate (must be assignable on the repo)
gh issue edit N --repo OWNER/REPO --add-assignee their-login

# On create
gh issue create --repo OWNER/REPO --assignee "@me" --title "..." --body-file ...
```

Verify with `gh issue view N --json assignees`. If assignment fails, report it in VERIFY and ask for a valid login — do not silently leave the issue unassigned when the plan named an owner.

Reuse existing labels. Create new labels only when approved in the change plan. Include label/field/assignee operations explicitly (for example `OP-XX SET_SIZE #18=M`, `OP-XX ADD_LABELS #18 enhancement,web`, `OP-XX ASSIGN #18 @me`).

Project linking does not automatically add existing issues. Auto-add workflows may not backfill existing matching items.

## Issue bodies and comments

Avoid shell interpolation for Markdown containing backticks, quotes, `$()`, or multiline content. Write the approved content to a file and use:

```bash
gh issue create --repo OWNER/REPO --title "..." --body-file /path/to/body.md
gh issue edit NUMBER --repo OWNER/REPO --body-file /path/to/body.md
```

Use a stable approved marker when recovery/idempotency requires it:

```html
<!-- taskflow:PLAN-v2:T3 -->
```

Do not expose temporary files containing sensitive data.

## Native issue relationships

**Prose in the issue body does not create GitHub Relationships.** The sidebar `Relationships` field stays empty until native links are set.

Use native sub-issue and dependency relationships when supported by the installed CLI and target host. Check:

```bash
gh issue create --help
gh issue edit --help
gh issue view --help
```

Current GitHub CLI supports:

```bash
gh issue edit N --repo OWNER/REPO --add-blocked-by 10,11
gh issue edit N --repo OWNER/REPO --add-blocking 20,21
gh issue edit N --repo OWNER/REPO --parent 100
gh issue edit N --repo OWNER/REPO --add-sub-issue 101,102
```

On create:

```bash
gh issue create --repo OWNER/REPO --blocked-by 10,11 --blocking 20 --parent 100 ...
```

Rules:

- checklist items remain appropriate for non-independent implementation steps
- create parents and blockers first, then dependents
- prefer setting `--add-blocked-by` on the dependent issue (GitHub usually mirrors `blocks` on the other side)
- use parent/sub-issue only for true hierarchy (epic/umbrella → child deliverables), not for every related link
- “Related” mentions that are not blocking stay in the body; do not invent fake blocked-by edges
- use full URLs for supported cross-repository relationships
- reject dependency cycles before writing
- after writes, verify with `gh issue view N --json blockedBy,blocking,parent,subIssues` and confirm the issue sidebar is not “None yet”

Every `GITHUB CHANGE PLAN` that mentions dependencies must include explicit relationship operations (for example `OP-XX RELATE #25 blocked-by #21,#24`). Updating body markdown alone is incomplete.

If native relationships are unavailable on the host/CLI, record relationships in issue bodies **and** report that limitation in VERIFY.

## PR and issue reconciliation

An open PR is not delivered work.

- If a canonical issue exists, link the PR and keep the issue open.
- Prefer a supported closing keyword in a PR targeting the default branch when automatic closure is desired.
- A merged PR to a non-default branch may not close its linked issue.
- Confirm repository auto-closing behavior.
- Close manually only after Definition of Done and closure evidence pass.
- Create an issue alongside a PR only when independent coordination, acceptance criteria, follow-up, or remaining scope justifies it.

## Deduplicating issues

GitHub does not merge issue histories.

1. Select the canonical issue using scope, age, discussion, links, and current relevance.
2. Update the canonical body with approved missing scope/criteria.
3. Close the duplicate with a pointer and reason.
4. Use the CLI’s duplicate relationship support when available:

```bash
gh issue close DUPLICATE --repo OWNER/REPO \
  --duplicate-of CANONICAL \
  --comment "Consolidating into #CANONICAL."
```

Verify the duplicate relationship and state reason. Use `completed` only for delivered work; use `not planned` only when that meaning is accurate.

## Project item lifecycle versus issue lifecycle

Treat these as separate operations:

- close/reopen issue
- set Project Status
- archive/restore Project item
- delete Project item

Audit workflows before setting Status because a workflow may close issues when Status becomes Done. Prefer archival over deletion when preserving history matters.

Never treat `Done` status alone as delivery evidence.

## Fresh repository push safety

Before any push:

1. inspect tracked files and commit history that will actually be pushed
2. inspect staged, untracked, and ignored sensitive files as separate risks
3. use an available secret scanner and state its coverage/limitations
4. confirm there is at least one intended commit
5. confirm branch/ref selection and whether additional branches/tags will be pushed
6. confirm repository visibility and remote name
7. stop if suspected credentials/private keys remain unresolved

Do not claim “secrets check passed” from filename matching alone.

## Safe execution order

After approval:

1. revalidate auth, permissions, target identity, repository capability, and plan version
2. create/verify repository if approved
3. create/select Project under the approved owner
4. link repository to Project if approved
5. inspect/create only approved missing fields and options (Status required for Board columns)
6. **create Board view (required)**; create Table/Roadmap only if approved
7. create approved repository-scoped labels/milestones
8. create parent/foundation/blocker issues in topological order
9. create native relationships and replace provisional IDs
10. add issues to Project and capture item IDs
11. set Project fields in separate operations
12. perform approved issue updates, duplicate closures, and other state changes
13. verify every operation — including that a Board view exists — and report mismatches

## Operation ledger and recovery

Record after every operation:

```text
OP-07 | Plan v2 | CREATE_ISSUE T3
Target: OWNER/REPO
Result: success
Identity: issue #42, URL ..., node ID ...
Project item: ID ... (if added)
Verified: yes/no
```

On failure:

- stop operations that depend on the failure
- continue only independent operations already explicitly approved when doing so is unquestionably safe
- verify all successful writes
- re-list resources before retrying
- produce a residual plan containing only uncompleted or corrective operations
- do not match by title alone

## Verification checklist

Verify actual state, not only command success:

- repository host/owner/name, visibility, archived state, Issues capability, default branch, remote
- Project owner/number/visibility/access, linked repositories, fields/options/views/workflows
- **Board view present** (required for newly created Projects); note optional Table/Roadmap if any
- issue number/title/body marker, labels, milestone, assignees, state reason
- parent/sub-issue/dependency relationships
- Project item identity and every approved field value
- duplicate relationship and canonical pointer
- expected count versus actual count
- no accidental duplicate resource
