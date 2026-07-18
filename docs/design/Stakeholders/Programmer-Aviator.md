> Status: draft | Audience: anyone designing a feature that touches this role | See also: [../Personas.md](../Personas.md)

# Programmer-Aviator

Someone drawn in by the aviation problem rather than a job requirement — extends the app for their own AirVenture use and contributes changes back.
Their relationship to the system is contributor, not just operator.

## Domain of awareness

- The contribution workflow: how a change gets checked, merged, released, and recorded — required checks on every change, changelog discipline, and version numbers that are computed rather than hand-picked.
- The seams the codebase is built around: which logic is pure and safely extensible (activity detection, priority ducking, stream-address parsing, config validation) versus which parts are wiring around it.
- The config file's structure as a shared contract — most extensions add to it rather than replace it.
- The project's recorded decisions and their reasoning, so settled tradeoffs — why the flight-tracking panel needs an embedded browser rather than a simple embed, why muting a stream never stops its activity light — are not relitigated by accident.
- What is explicitly out of scope for now: recording, transcription, and alerting are named non-goals for alpha, not silent gaps, so this role knows what is genuinely open to build without duplicating a planned feature.

## Data this role keeps current

- The documentation trail for their own change: a decision stamp if they made a design tradeoff, a changelog entry, updated tests around any pure logic they touched.
- Nothing about the product's curated defaults or persona-facing content — that upkeep belongs to editorial judgment, not the contribution workflow.

## Value this role receives

- A real, live aviation problem to build against, with the hardest part — many simultaneous audio streams with reliable activity detection and priority handling — already solved behind clean seams, so extending it (for example, adding transcription or recording) does not mean re-solving concurrency and audio routing first.
- A typed, readable codebase and a stable config contract instead of ad hoc wiring to reverse-engineer.
- Enforced gates that make a contribution trustworthy without manual policing: checks on every change, a changelog gate before release, computed version numbers.
- Decision records that carry the why, not just the what, so past tradeoffs are legible instead of archaeology.
- A public project with public releases (decision 2026-07-18) — a real shipped artifact carrying their contribution, not a private exercise.

## Not expected to

- Operate the app live during AirVenture week as their reason for being here.
  They may well do so anyway, but the contract asked of them is building and contributing, not monitoring traffic.
- Decide what belongs in the curated defaults a first-time user sees — that judgment call sits with the maintainer, not the contribution workflow.
- Handle installer signing or notarization — planned, not built, and not asked of contributors during alpha.
- Clear a required-review gate to land a change during the AirVenture-week sprint — governance is deliberately solo-tuned for the sprint (decision 2026-07-18), tightening after the show.

## Open questions

- The pure, safely-extensible seams (detection, ducking, address parsing, bounds validation) are the intended extension points — is that boundary written down anywhere a new contributor finds it without reading the whole source tree first?
- The config file's structure is validated but not yet frozen or versioned — if a contribution adds a field, does an existing saved config file keep working, or is breaking it acceptable during alpha?
- Governance tightens "after the show," per the project plan — is there a concrete trigger for that (a date, the first outside contributor, a specific release), or is it an open judgment call?
