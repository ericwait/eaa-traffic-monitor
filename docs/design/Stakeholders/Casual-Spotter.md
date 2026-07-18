> Status: draft | Audience: anyone designing a feature that touches this role | See also: [../Personas.md](../Personas.md)

# Casual Spotter

_Not intended to be ready for alpha launch, but to guide design decisions that affect this role in future phases._

Someone who wants to watch airplanes arrive at Oshkosh during AirVenture and has never heard of ATIS, Fisk approach, or that EAA runs its own webcams — a guest of the app's defaults, not an operator of its controls.

## Domain of awareness

- That the app exists and roughly what it can show — audio from the tower and approach frequencies, a video grid of EAA's live feeds, and a flight-tracking panel (FlightRadar24) showing the live airspace.
  This awareness is meant to arrive *from using the app*, not from reading about it beforehand.
- Whatever windows or panels are currently open on their own screen, if they've opened more than one.
- Nothing about ATC vocabulary, stream naming, priority ranking, or the existence of a config file is assumed going in.

## Data this role keeps current

Almost nothing, and that is intentional.
Any transient choice made in a sitting — a panel resized, a stream muted, a feed left full-screen — is remembered by the app's own session restore, not something this role maintains by hand.
This role is a net consumer of the contract: it asks for essentially no upkeep, which is the point, not a gap.

## Value this role receives

- A working, sensible setup the moment the app opens — curated audio and video defaults, already arranged, with nothing to configure first.
- The curated defaults double as the discovery mechanism: seeing streams labeled "Tower," "Fisk Approach," or "Seaplane Base" is how this role learns those things exist, rather than needing to know it beforehand.
- Activity lights and priority ducking mean this role never has to parse overlapping radio chatter unaided — the app already shows which channel matters right now.
- One application window in place of a pile of separate audio players and browser tabs.

**Alpha reality:** alpha only partly serves this role, and that should be said plainly rather than glossed over.
Two gaps are accepted for the AirVenture-week alpha (decision 2026-07-18): builds are unsigned, so first launch means clicking through an operating-system warning with no in-app help getting past it; and changing which streams or feeds show up means hand-editing a text config file, which this role has no reason to know exists, let alone how to edit.
This role is alpha's north star for what comes after — signed installers and a management UI, the two changes that would actually close the gap, are planned, not built.

## Not expected to

- Install or route audio devices per stream.
- Understand priority ranks, detection thresholds, or the config file's structure.
- Know ATC terminology, call signs, or airport geography before opening the app.
- Troubleshoot a dropped stream or a reconnect — the app retries on its own.
- Rearrange windows across monitors to get a usable layout.
  They may, but nothing about the design requires it.

## Open questions

- Is a warning in the project's documentation enough for launch week, or does an unsigned build's operating-system prompt stop this role from ever getting past first launch?
- During alpha, is this role expected to attempt config file edits at all, or is alpha explicitly look-but-don't-touch for them until a management UI exists?
- Is there room for even a minimal first-run explanation of what's on screen before post-alpha polish arrives, or does "good defaults, no explanation" carry the whole alpha?
