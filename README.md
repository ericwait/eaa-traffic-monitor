# Airshow Traffic Monitor

![Wyvern Watch mark](design/wyvern-watch.svg)

[![CI](https://github.com/ericwait/airshow-traffic-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/ericwait/airshow-traffic-monitor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ericwait/airshow-traffic-monitor)](https://github.com/ericwait/airshow-traffic-monitor/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**[Project page](https://wyvernwatch.org/)** · **[Get started](docs/development/Getting-Started.md)** · **[Documentation](docs/README.md)**

Airshow Traffic Monitor is a cross-platform Electron desktop dashboard that unifies three ways of watching an airshow's air traffic into one window: simultaneous ATC audio streams, a live YouTube video grid, and an embedded FlightRadar24 map, plus a field-weather card.
It's built first for EAA AirVenture Oshkosh, the world's busiest air-traffic-control week.
The project name is deliberately airshow-generic — EAA AirVenture Oshkosh is the first target, not the boundary (decision 2026-07-19).

## Status

v0.1.0 is a personal-use alpha running live at AirVenture 2026, and a validation of the release pipeline — not a public launch.
Wider distribution waits on LiveATC.net granting stream-use clearance.
See [CHANGELOG.md](CHANGELOG.md) for what's shipped and [docs/Implementation-Plan.md](docs/Implementation-Plan.md) for the milestone gate and what's next.

## What it does

Built first for one operator running a full command center, but meant to work for anyone who just wants planes to appear with nothing to configure — see [docs/design/Personas.md](docs/design/Personas.md).

- **ATC audio** — Eight curated KOSH LiveATC feeds play at once, each with its own volume, mute, pan, and output-device routing.
  Priority auto-ducking drops a lower-priority channel under a higher one so overlapping radio calls stay legible, and voice-activity lights show who's talking, even on a muted channel.
  An in-panel channel manager adds, removes, and reorders feeds straight from LiveATC's own directory.
  Full behavior: [docs/design/Audio.md](docs/design/Audio.md).
- **Live video** — A grid of EAA's live YouTube cams, tiled uniformly or with one feed emphasized, each poppable into its own window for a second monitor.
  Full behavior: [docs/design/Video.md](docs/design/Video.md).
- **Flight tracking** — An embedded FlightRadar24 browser panel with back / forward / reload / home navigation; login and map position persist across relaunches.
  Full behavior: [docs/design/Tracking.md](docs/design/Tracking.md).
- **Field weather** — Current METAR conditions and a TAF forecast timeline for the tracked airfield, with a color-coded VFR / MVFR / IFR / LIFR flight-category badge.
  Full behavior: [docs/design/Weather.md](docs/design/Weather.md).

A full session — window placement, panel layout, per-stream settings, connected streams, pop-outs, and the FlightRadar24 map view — restores automatically on relaunch.

## Getting started

```bash
git clone https://github.com/ericwait/airshow-traffic-monitor.git
cd airshow-traffic-monitor
just dev
```

That's the short version.
[docs/development/Getting-Started.md](docs/development/Getting-Started.md) walks through prerequisites, what you should see, and how to change what you monitor.

## Documentation

[docs/README.md](docs/README.md) is the full map: design docs (what and why), development docs (how), and the decision log.

## Contributing

Contributions are welcome!
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started, and please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

This project is licensed under the [MIT License](LICENSE).
