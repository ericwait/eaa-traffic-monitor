# Documentation index

> Status: living | Audience: everyone — start here | See also: [../README.md](../README.md) (product requirements), [Implementation-Plan.md](Implementation-Plan.md)

This tree is split by the question each half answers.
`design/` answers **what and why** in the vocabulary of the problem — it stays implementation-agnostic so the design survives any re-platform.
`development/` answers **how** and is free to name tools.
If a sentence in `design/` names a language, library, or tool beyond a brief parenthetical, it belongs in `development/` instead.

## What goes where

| Location | Holds | Authoritative for |
|---|---|---|
| [design/Personas.md](design/Personas.md) | Guiding principle, persona index + summary matrix | Who this is for |
| [design/Stakeholders/](design/Stakeholders/) | One contract file per persona | What each persona gives and gets |
| [design/Audio.md](design/Audio.md) | All sound sources: ATC streams, video audio, tracker audio | Audio behavior and its boundaries |
| [design/Video.md](design/Video.md) | Live webcam grid, layouts, pop-outs | Video behavior |
| [design/Tracking.md](design/Tracking.md) | Embedded flight-tracking panel | Tracking behavior |
| [design/assets/](design/assets/) | Prototype screenshots (the baseline this app replaces) | — |
| [development/TechStack.md](development/TechStack.md) | Stack, rationale, limitations, alternatives | Tool choices |
| [Implementation-Plan.md](Implementation-Plan.md) | Forward work only: phases, dependency graph, backlog, progress log | What happens next |
| [decisions/README.md](decisions/README.md) | Index of inline decision stamps | Where each decision is recorded |
| [archive/](archive/) | Completed one-time plans — **nothing here describes current state** | — |
| [index.html](index.html) | GitHub Pages project page (not part of this docs system) | — |

## Reading orders

**For product understanding:** [design/Personas.md](design/Personas.md) → the three [Stakeholders](design/Stakeholders/) files → [design/Audio.md](design/Audio.md), [design/Video.md](design/Video.md), [design/Tracking.md](design/Tracking.md) → [Implementation-Plan.md](Implementation-Plan.md)

**For engineering understanding:** [development/TechStack.md](development/TechStack.md) → [Implementation-Plan.md](Implementation-Plan.md) → root `CLAUDE.md` (agent context; rewritten in Phase 0)

Also under `development/`: [Getting-Started.md](development/Getting-Started.md) (zero-knowledge clone-and-run walkthrough) and [Testing.md](development/Testing.md) (test tiers and guardian rules), both landed with the Phase 0 scaffold.

## Conventions

- Every doc opens with a `> Status: … | Audience: … | See also: …` line and defers to its sources of truth rather than duplicating them.
- Decisions are recorded **inline where they're made**, stamped `(decision YYYY-MM-DD)`, with a one-line row added to [decisions/README.md](decisions/README.md) in the same commit.
- Aspirations are marked "planned, not built" at the point of relevance.
