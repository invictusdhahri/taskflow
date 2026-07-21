# TaskFlow

Publishable Agent Skill for generating and maintaining GitHub-backed task flows.

TaskFlow helps an AI coding agent:

- bootstrap a GitHub repository + Project + MVP issues
- stand up a Project for an existing repository
- audit, deduplicate, and clean an existing Project/backlog
- produce implementation-ready issues with Caveman summaries, file lists, acceptance criteria, native Relationships, and safe write plans

It follows the open [Agent Skills](https://agentskills.io) standard and works with Cursor, Claude Code, Codex, and other compatible agents.

New Projects default to a **Board** view (Status columns). Table and Roadmap are optional extras the agent can ask about.

## Install

```bash
# project-local (recommended)
npx skills add invictusdhahri/taskflow

# install only this skill if the repo grows later
npx skills add invictusdhahri/taskflow --skill taskflow

# global install (available across projects)
npx skills add -g invictusdhahri/taskflow
```

Local / unpublished checkout:

```bash
npx skills add ./skills/taskflow
# or from the repo root
npx skills add .
```

### After install

- **Cursor:** `/taskflow` or `@taskflow`, or ask to create/audit GitHub issues and Projects
- **Claude Code / Codex / others:** ask the agent to run the TaskFlow skill, or invoke it by name if your client lists installed skills

## Discoverability

- [skills.sh](https://skills.sh/) is a directory/leaderboard, not a store
- Listing comes from install telemetry when people run `npx skills add invictusdhahri/taskflow`
- Cursor can also import via **Customize → Rules → Add Rule → Remote Rule (GitHub)** using this repo URL

## Repo layout

```text
taskflow/
├── LICENSE
├── README.md
└── skills/
    └── taskflow/
        ├── SKILL.md                 # required entrypoint
        ├── github-operations.md     # Projects V2 / gh CLI reference
        ├── templates.md             # Caveman, files, Ready/Done, issue templates
        └── examples.md              # mode and recovery examples
```

## Requirements

- GitHub CLI (`gh`) authenticated to the target host
- permission to inspect/create repositories, issues, and Projects as needed
- user confirmation before any GitHub write

## What this is not

- Not an npm library
- Not a hosted SaaS
- Not automatic issue spam — TaskFlow proposes a versioned change plan and waits for approval

## License

[MIT](./LICENSE)
