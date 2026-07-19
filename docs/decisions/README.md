# Decisions index

> Status: living | Audience: anyone looking for where a decision is recorded | See also: [../README.md](../README.md)

Decisions are recorded **inline, where they're made** — in the design or development doc discussing the tradeoff, stamped `(decision YYYY-MM-DD)`.
This index exists only for discoverability: one row per decision, pointing at the doc that records it.
Adding an inline stamp means adding a row here **in the same commit**; a row with no matching stamp, or a stamp with no row, means someone skipped half the rule.

The 2026-07-18 rows below were decided in the pre-code planning session, so they carry no issue references.
Once work runs through issues, stamps take the form `(decision YYYY-MM-DD, #NN)`.

| Date | Decision (one line) | Recorded in | Status |
| --- | --- | --- | --- |
| 2026-07-18 | Stack locked in one pass: Electron + TypeScript + React with electron-vite / electron-builder and the seed kit's governance toolchain | [development/TechStack.md](../development/TechStack.md) § The stack | Adopted |
| 2026-07-18 | ATC audio commits to all four behaviors: activity lights, one-click solo, stereo pan, priority auto-duck | [design/Audio.md](../design/Audio.md) § The unifying principle | Adopted |
| 2026-07-18 | Ducking rule: duck only under a strictly-higher-priority active stream, to −12 dB, fast duck / slow release | [design/Audio.md](../design/Audio.md) § ATC streams | Adopted |
| 2026-07-18 | Per-stream output-device routing for ATC streams | [design/Audio.md](../design/Audio.md) § ATC streams; [development/TechStack.md](../development/TechStack.md) § Why this stack | Adopted |
| 2026-07-18 | Build sequencing within audio: lights → solo → pan → duck | [Implementation-Plan.md](../Implementation-Plan.md) § Phase 2b | Adopted |
| 2026-07-18 | Curated defaults + human-editable config file; no in-app management UI in alpha | [design/Video.md](../design/Video.md) § Feed sourcing; [design/Stakeholders/Command-Center-Enthusiast.md](../design/Stakeholders/Command-Center-Enthusiast.md) § Domain of awareness | Adopted |
| 2026-07-18 | Live-stream discovery is on-demand only — no background polling | [design/Video.md](../design/Video.md) § Feed sourcing | Adopted |
| 2026-07-18 | Restore last session on relaunch: layouts, feed assignments, pop-outs, per-stream settings | [design/Video.md](../design/Video.md) § Pop-outs and restore | Adopted |
| 2026-07-18 | Tracking panel is a genuine embedded browser (the site refuses lightweight embedding — verified) | [design/Tracking.md](../design/Tracking.md) § Features | Adopted |
| 2026-07-18 | Tracking navigation stays minimal: back / forward / reload / home preset on Oshkosh | [design/Tracking.md](../design/Tracking.md) § Features | Adopted |
| 2026-07-18 | Tracking session and login persist across relaunches | [design/Tracking.md](../design/Tracking.md) § Features | Adopted |
| 2026-07-18 | Tracking panel lands in the walking skeleton — bounds-sync is the foundational layout risk | [Implementation-Plan.md](../Implementation-Plan.md) § Phase 1 | Adopted |
| 2026-07-18 | Kit's one-phase-in-progress rule adapted to one phase per track for the agent-assisted sprint | [Implementation-Plan.md](../Implementation-Plan.md) § header + intro | Adopted |
| 2026-07-18 | Alpha ships config-file-driven with unsigned builds; Casual Spotter gaps accepted and named | [design/Personas.md](../design/Personas.md) § Alpha priority; [design/Stakeholders/Casual-Spotter.md](../design/Stakeholders/Casual-Spotter.md) § Value | Adopted |
| 2026-07-18 | Public GitHub releases from a public repository | [design/Stakeholders/Programmer-Aviator.md](../design/Stakeholders/Programmer-Aviator.md) § Value | Adopted |
| 2026-07-18 | Governance solo-tuned for the sprint (no required reviews; protection on main only); tightens post-show | [design/Stakeholders/Programmer-Aviator.md](../design/Stakeholders/Programmer-Aviator.md) § Not expected to | Adopted |
| 2026-07-18 | Docs website is generated from `docs/` by MkDocs Material — machinery in `website/`, Pages source moves to Actions, landing page becomes `docs/index.md`; ships with Phase 5 | [Implementation-Plan.md](../Implementation-Plan.md) § Phase 5; [development/TechStack.md](../development/TechStack.md) § The stack | Adopted |
| 2026-07-18 | Binary assets tracked with Git LFS from first commit; legacy-Pages pointer caveat accepted until the Phase 5 site build | [development/TechStack.md](../development/TechStack.md) § The stack + Known limitations | Adopted |
| 2026-07-19 | Packaged renderer served from a loopback HTTP server (`127.0.0.1`); `app://` demoted to a logged fallback, because YouTube's IFrame API rejects the `app://` origin (error 153) | [development/TechStack.md](../development/TechStack.md) § Known limitations | Adopted |
| 2026-07-19 | A muted higher-priority channel does not duck lower channels — its light still shows activity, but it never ducks audio the operator is actually listening to | [design/Audio.md](../design/Audio.md) § ATC streams | Adopted |
| 2026-07-19 | Project renamed `airshow-traffic-monitor` / "Airshow Traffic Monitor" — airshow-generic identity; EAA AirVenture stays the first target, not the boundary | [README.md](../../README.md) § intro | Adopted |
| 2026-07-19 | Field weather sourced from the free, keyless aviationweather.gov Data API (METAR+TAF JSON); fetched main-process-only with a descriptive User-Agent, polled no more than every 5 minutes | [development/TechStack.md](../development/TechStack.md) § Known limitations | Adopted |
