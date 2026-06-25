---
name: session-planner
description: Manage planned development sessions for this project. Use when the user wants to add, list, pick up, or close a planned session. Triggers on "nieuwe sessie plannen", "voeg sessie toe", "welke sessies", "pak sessie op", "sluit sessie", "session planner", or any reference to the sessions planning docs.
---

# Session Planner

Manages `docs/sessions/` — the planning of upcoming development sessions for this project.

## File structure

| File | Purpose |
|---|---|
| `docs/sessions/sessions-planned-index.md` | Index of open and completed sessions |
| `docs/sessions/sessions-finished-index.md` | Archive index of finished sessions |
| `docs/sessions/session-<feature>-<YYYYMMDDNN>.md` | Individual session plan |

Date suffix: `YYYYMMDD` + 2-digit sequence number (`01`, `02`, …) for that day.

---

## Commands

### List — show overview

Read `docs/sessions/sessions-planned-index.md` and display the table to the user. Include the file path of each session so the user can open it directly.

---

### Add — plan a new session

Ask the user (if not already provided):
- Feature name (short, kebab-case suitable)
- Goal in 1–2 sentences
- Known decisions or constraints

Then create:

1. **Session file** `docs/sessions/session-<feature>-<YYYYMMDDNN>.md` using this template:

```markdown
# <Feature title>

**Status:** Open  
**Created:** <YYYY-MM-DD>

## Goal

<1–2 sentences describing what the session delivers>

## Decisions

- <Architectural choices, constraints>

## Implementation approach

<Approach, steps, relevant patterns>

## Related files

- <path/to/file.tsx> — <role>
```

2. **Index row** in `docs/sessions/sessions-planned-index.md`:
```
| [session-<feature>-<YYYYMMDDNN>.md](session-<feature>-<YYYYMMDDNN>.md) | <Feature title> | <YYYY-MM-DD> | Open |
```

Report the path of the new file.

---

### Pick up — start working on a session

When the user wants to pick up a session:

1. Read `docs/sessions/sessions-planned-index.md`
2. If multiple open sessions exist: ask which one
3. Read the session file in full
4. Present a brief plan of action (what to do, related files)
5. Ask for confirmation, then begin implementing

---

### Done — close a session

When implementation is complete:

1. Update the status cell in `docs/sessions/sessions-planned-index.md`: `Open` → `Done`
2. Add a row to `docs/sessions/sessions-finished-index.md`:
```
| [session-<feature>-<YYYYMMDDNN>.md](session-<feature>-<YYYYMMDDNN>.md) | <Feature title> | <YYYY-MM-DD> |
```
   (date = today, the completion date)

---

## Rules

- File names are always lowercase kebab-case: `session-foo-bar-2026062501.md`
- Session files are **never deleted** — they remain as a historical record
- Keep session files concise: decisions and approach, no prose narratives
- `sessions-planned-index.md` holds both open and done sessions; `sessions-finished-index.md` is the separate archive
