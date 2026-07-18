> Status: draft | Audience: anyone designing a feature that touches a persona | See also: [../README.md](../README.md), [../Implementation-Plan.md](../Implementation-Plan.md)

# Personas

This app is used differently by different people across an AirVenture week, and a feature that serves one persona well can be irrelevant — or actively wrong — for another.
The three personas below are not organizational roles; they are the three relationships someone can have with this app: a guest who wants planes to appear with nothing to configure, an operator running the whole command center, and a contributor extending the code underneath it.
Each has its own doc built on the same three-part contract: what it must stay aware of, what it keeps current, and what it receives in return.

Every persona's contract is measured against one sentence:

> Arrange once, then just watch and listen — when radios overlap, the app
> shows who's talking and lets the channel that matters win.

## Summary matrix

| Role | Expected awareness | Expected action | Not expected to |
| --- | --- | --- | --- |
| [Casual Spotter](Stakeholders/Casual-Spotter.md) | What's on screen right now; nothing about ATC vocabulary, stream names, or the config file beforehand | Install, open, watch and listen to the curated defaults | Edit the config file, choose streams, or make sense of raw overlapping radio traffic unaided |
| [Command-Center Enthusiast](Stakeholders/Command-Center-Enthusiast.md) | Every stream's live state, current ducking/priority behavior, device routing, the full multi-monitor layout, the config file's contents | Curate the config file, tune priorities and detection thresholds, arrange windows and pop-outs, drive the flight-tracking panel | Write code, sign or build installers, keep the video feed list current by hand |
| [Programmer-Aviator](Stakeholders/Programmer-Aviator.md) | The contribution workflow, the codebase's safely-extensible seams, recorded decisions, the config file's structure | Extend the codebase, keep docs/changelog/tests current, clear the checks gating a change | Curate the defaults a first-time user sees, operate the app live during the show, handle installer signing |

## Related design docs

Persona docs describe *who*; each pillar named in the project's requirements has its own doc describing *what* it does: [Audio.md](Audio.md) (ATC audio streams), [Video.md](Video.md) (the video grid of EAA's live feeds), [Tracking.md](Tracking.md) (the flight-tracking panel).

## Alpha priority

The alpha is built for the **Command-Center Enthusiast** first: the audio engine — this persona's core need — is the first pillar built, and replacing their hand-arranged, two-monitor prototype (below) with something that survives a real AirVenture week is the alpha's real test.
The **Casual Spotter** is the post-alpha north star: alpha ships config-file driven, with unsigned builds (decision 2026-07-18), both real barriers for a guest who has no reason to know the config file exists — signed installers and a management UI, the two changes that would close that gap, are planned, not built.
The **Programmer-Aviator** is served from day one regardless of feature phase: their contract runs through the repository's governance — checks, changelog discipline, computed versions — not through any single pillar shipping first; see [../Implementation-Plan.md](../Implementation-Plan.md).

The prototype this app replaces: [landscape monitor](assets/prototype-2026-07-18-landscape.jpg) (audio players, flight-tracking view, and webcams) and [portrait monitor](assets/prototype-2026-07-18-portrait.jpg) (stacked EAA webcams).
