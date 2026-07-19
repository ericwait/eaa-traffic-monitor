<!-- Keep this short enough to actually fill out. See CONTRIBUTING.md for the full Definition of Done this checklist mirrors. -->

## What & why

[FILL: one paragraph — what changed and why. Link the issue: Closes #NN]

## How verified

[FILL: what you ran and what you observed — `just test`, `just e2e`, a manual `just dev` check, a screenshot]

## Definition of Done

- [ ] `just lint`, `just fmt`, and `just typecheck` are clean
- [ ] `just test` passes; `just e2e` passes if the change touches app launch or the window
- [ ] Docs updated (if behavior or structure changed) — design vs development split respected
- [ ] Changelog `[Unreleased]` entry added (if user-facing)
- [ ] Decision stamp + `docs/decisions/README.md` row added in the same commit (if a decision was made)
- [ ] Targets `develop` (not `main`); merge-commit only — never squash (GitVersion dependency)
