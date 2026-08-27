---
name: wayfinder
description: Use when picking up work in propositum, finding the next ticket, claiming one, or closing one. The wayfinder map is issue #1; tickets are its sub-issues. Covers the frontier query, the claim, the resolve, and the native issue-dependency calls with their one real trap.
---

# Wayfinder

Work in propositum is tracked as GitHub issues in `smukhyala/propositum` via the `gh` CLI. The **map** is
a single issue holding the Destination, the Notes, the Decisions so far, and the Fog. Everything else is
a **child ticket** of it.

The live map is [issue #1](https://github.com/smukhyala/propositum/issues/1).

`gh` infers the repo from `git remote -v` when run inside the clone.

## Ticket types

Children carry `wayfinder:<type>`:

| Label | What it is |
|---|---|
| `wayfinder:research` | A question to answer away from the keyboard (AFK). Produces a note in `docs/research/`. |
| `wayfinder:grilling` | A decision to take with a human in the loop. Produces an ADR. |
| `wayfinder:prototype` | A throwaway build to find out something a discussion cannot. |
| `wayfinder:task` | A build slice. Titles carry an `infra:` or `product:` prefix. |

The five triage labels — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` —
are described in `docs/agents/triage-labels.md`. `ready-for-agent` means fully specified and safe to hand
to an agent; `ready-for-human` means it needs judgment nobody has written down yet.

## Finding the next thing — the frontier query

List the map's open children, then **drop** any that has an open blocker or an assignee. First in map
order wins.

```bash
gh issue list --state open --json number,title,labels,assignees \
  --jq '[.[] | {number, title, labels: [.labels[].name], assigned: (.assignees | length > 0)}]'

# blockers, per candidate — open blockers only, which is the live gate
gh api repos/smukhyala/propositum/issues/<n> --jq .issue_dependencies_summary.blocked_by
```

A ticket is unblocked when every blocker is closed.

## Claiming

```bash
gh issue edit <n> --add-assignee @me
```

**This is the session's first write.** Claim before you start, so two agents do not converge on one
ticket.

## Blocking

GitHub's **native issue dependencies** are the canonical, UI-visible representation:

```bash
# the trap: issue_id is the numeric DATABASE id, not the #number and not the node_id
BLOCKER_ID=$(gh api repos/smukhyala/propositum/issues/<blocker> --jq .id)
gh api --method POST \
  repos/smukhyala/propositum/issues/<child>/dependencies/blocked_by \
  -F issue_id=$BLOCKER_ID
```

Where dependencies are not available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the
child body.

## Resolving

Three steps, in order:

```bash
gh issue comment <n> --body "<the answer, not a status update>"
gh issue close <n>
```

Then **append one line to the map's Decisions so far** with a pointer to where the answer lives. A
resolved ticket whose conclusion is not on the map is a conclusion nobody will find.

## Creating a child ticket

```bash
gh issue create --title "..." --label "wayfinder:task" --body "$(cat <<'BODY'
Part of #1

...
BODY
)"
```

Then link it as a sub-issue of the map via `gh api` on the sub-issues endpoint. Where sub-issues are not
enabled, add it to a task list in the map body — the `Part of #1` line at the top of the child is the
fallback that makes the relationship legible either way.

Titles use `CONTEXT.md`'s vocabulary. If the concept you need is not in the glossary, that is a signal
worth a sentence rather than a synonym.

## What this does not cover

- **PRs are not a request surface here.** `docs/agents/issue-tracker.md` carries that flag set to `no`,
  and `/triage` reads it. Every pull request so far is from the repository owner.
- **There are no milestones and no project board in use.** The map is the plan.
- **`gh project` commands need a `read:project` token scope** that the default login does not carry.
