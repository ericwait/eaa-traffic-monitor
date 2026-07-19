> Status: adopted | Audience: anyone cloning this repo for the first time, assuming no prior knowledge of this stack | See also: [Testing.md](Testing.md), [TechStack.md](TechStack.md), [../README.md](../README.md)

# Getting started

This walkthrough assumes you know nothing about Electron, Node, or this repo.
Follow it top to bottom on a fresh macOS machine and you will end at a running app: ATC audio on the left, flight tracking top-right, live video bottom-right.
Windows and Linux get a short parity note below.

## Prerequisites (macOS via Homebrew)

You need four tools: git, Git LFS, Node.js, and the `just` task runner.
Install [Homebrew](https://brew.sh) first if you don't have it, then:

```bash
brew install git git-lfs node just
xcode-select --install   # skip if already installed; safe to re-run — electron-builder wants it for macOS packaging
```

Git LFS must be activated once per machine after install — this teaches git to fetch the large binary assets this repo tracks:

```bash
git lfs install
```

Check the versions you got:

```bash
node --version   # want v22 or newer
just --version
git lfs version
```

The repo's `package.json` only floors Node at 20.19, but a plain `brew install node` gives you the current major (22+ as of this writing), so you'll clear the floor with room to spare.
If `node --version` shows something surprisingly old, `brew upgrade node` or use a version manager.

**Windows:** `winget install Git.Git GitHub.GitLFS OpenJS.NodeJS Casey.Just`, then `git lfs install`.
`just dev` works the same afterward.

**Linux (Debian/Ubuntu):** `sudo apt install git git-lfs nodejs npm`, install `just` from its [releases](https://github.com/casey/just) or your distro, then `git lfs install`.
A headless machine needs `xvfb` to run `just e2e` (CI does this automatically).

## Clone and run

```bash
git clone https://github.com/ericwait/eaa-traffic-monitor.git
cd eaa-traffic-monitor
just dev
```

`just dev` is idempotent — safe to run any time.
On the first run it installs dependencies with `npm ci`, which also downloads the Electron binary (~100 MB — give it a couple of minutes), then starts the electron-vite dev server and opens the app window.
Every later run skips straight to the dev server, typically live in a few seconds.

`just up` is the production sibling: it builds all three processes and previews the packaged app, serving the renderer from a loopback HTTP server (`http://127.0.0.1:<port>`) instead of the dev server.
This is the build the YouTube grid needs to be judged fairly against — see § What you should see.

Quit the app the normal way (Cmd-Q, or close the window) — there is no background service left running.

### What you should see

A dark desktop window titled **EAA Traffic Monitor**, split into three resizable panels:

- **Left — ATC Audio.**
  Eight stream strips — Emergency/Guard, Tower, Fisk VFR Approach, Del/Gnd/Misc, Departure Monitor, South Tower, Air Show, and ATIS — each with an activity light, a status chip (`connecting` / `live` / `reconnecting·n` / `error`), a volume slider, a mute button, a pan control, a solo button, a priority-rank badge (P1 highest), and an output-device picker.
  ATIS ships **muted with its activity light still working** — that is the designed muted-with-light behavior, not a bug: you can watch it looping without it ever competing for your ears.
  A strip may show `reconnecting·n` for a while — LiveATC occasionally takes a mount down, and the designed behavior is to retry with backoff, unattended, until it returns — that is self-healing working as intended, not an error to chase.
- **Top-right — Flight Tracking (FlightRadar24).**
  A live embedded FR24 browser panel with back / forward / reload / home controls and a read-only URL field.
  Log in with your FlightRadar24 account once — the login and your last map view both persist across relaunches.
- **Bottom-right — Live Video.**
  A grid of the curated EAA cams (Warbirds, Ultralights, Seaplane Base, Green Dot, Vintage, Boeing Plaza, and a featured stream).
  Double-click a tile, or use its hover-revealed emphasize / fill-panel buttons, to promote it into the large slot or fill the whole panel; Escape returns to the grid.
  Hovering a tile also reveals its own volume slider and mute button.
  YouTube audio always plays on the system-default output — it cannot be routed to a specific device the way ATC streams can (see [../design/Audio.md](../design/Audio.md)).

## Install the commit hooks

One-time, per clone.
This wires up the secret scanner, linter, and formatter to run before each commit:

```bash
pre-commit install
```

`pre-commit` comes with the Homebrew Python toolchain; if the command is missing, `brew install pre-commit`.
Without the hooks, CI still catches everything they catch — you just find out at pull-request time instead of commit time.

## The commands you'll use

Every task is a `just` verb (run `just` with no arguments to list them all):

| Command | Does |
| --- | --- |
| `just dev` | Install if needed, then run the app with hot reload |
| `just up` | Build and preview the production app (loopback-served renderer, no dev server) |
| `just test` | Run the vitest unit suite |
| `just e2e` | Build, then run the Playwright-Electron launch smoke |
| `just lint` | ESLint, check-only |
| `just fmt` | Prettier, writes changes in place |
| `just typecheck` | TypeScript, all tsconfigs, check-only |
| `just version` | Print the git-computed SemVer (needs GitVersion; CI computes the authoritative one) |
| `just reset` | DESTRUCTIVE — wipes deps, build output, and dev app data (asks first) |

`down`, `migrate`, and `health` exist for muscle-memory parity with service projects but print "n/a for a desktop app" — this app has no server, datastore, or health endpoint.

## Changing what you monitor

The curated defaults get you listening and watching immediately, but everything here is meant to be edited.

**ATC streams, priorities, pan, volume, and voice-detection tuning** live in `config.json`, inside this app's userData directory:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/eaa-traffic-monitor/config.json` |
| Windows | `%APPDATA%\eaa-traffic-monitor\config.json` |
| Linux | `~/.config/eaa-traffic-monitor/config.json` |

The app writes this file with the compiled defaults the first time it runs, then leaves it alone.
Edit it in any text editor — add a stream, swap a `.pls` mount, change a priority rank, retune the `vad` block — then click **Refresh config from disk** in the ATC Audio panel header to apply the change without restarting the app.
An invalid edit (bad JSON, a value out of range) never crashes the app: it falls back to the compiled defaults and shows a dismissible banner naming the file and the exact validation error.

**Video feed IDs** are not in `config.json` yet.
EAA's YouTube lineup rotates — often daily during the show — so a configured feed can go stale mid-week.
For now, edit the list directly in [`src/renderer/src/youtube/defaultFeeds.ts`](../../src/renderer/src/youtube/defaultFeeds.ts) (swap the `videoId`, and the `label` if the cam itself changed), then run `just dev` again.
Folding this into `config.json` is planned, not built.

## Morning radio checklist

Run this when the tower comes alive, before you trust the app for a real monitoring session:

- [ ] Every activity light matches what you hear, including on muted channels.
- [ ] Keying up Tower (P2) audibly ducks Fisk (P3) to about −12 dB, with a fast duck and a slow release and no pumping — in `just dev`, the duck readout next to a strip's device picker shows `×0.25` while ducked and `×1.00` at rest.
- [ ] Two channels at the same priority rank never duck each other.
- [ ] Guard (P1) ducks every other active channel.
- [ ] Soloing a channel isolates it instantly and releases cleanly back to the prior mix.
- [ ] A muted channel's light keeps working, but it never ducks the channel(s) you're actually listening to.
- [ ] Route Tower to your headphones while everything else stays on the speakers, then pull the headphones — you get a visible fallback notice (remember Bluetooth outputs lag wired ones by 150–300 ms).
- [ ] Toggle Wi-Fi off and back on — every stream self-heals back to `live` on its own, with no action from you.

## Troubleshooting

**`just dev` fails with a Node version error** (something like `Unsupported engine` or a syntax error deep in a dependency).
Your Node is too old.
Run `node --version`; if it's below 20.19, `brew upgrade node` and try again.

**The app launches as a headless Node process, or `just e2e` fails with `bad option: --remote-debugging-port`.**
Your terminal exported `ELECTRON_RUN_AS_NODE=1` — the VS Code family of editors does this in their integrated terminal.
The justfile already strips it for you, so prefer running through `just` (`just dev`, `just e2e`).
If you must run a raw command, prefix it: `env -u ELECTRON_RUN_AS_NODE npm run dev`.

**Electron won't download** (install hangs or errors on `Downloading Electron`).
You're likely behind a proxy or offline.
The binary is fetched by Electron's postinstall from GitHub releases; set `HTTP_PROXY`/`HTTPS_PROXY` if you're behind a corporate proxy, or set `ELECTRON_MIRROR` to an internal mirror, then re-run `npm ci`.

**`just dev` or `just e2e` fails because `node_modules/electron/dist` is missing, even though `npm ci` reported success with no errors.**
Some npm setups run an "allow-scripts"-style wrapper (a corporate config, or a personal npm setting) that silently skips packages' postinstall scripts — Electron's binary download is one of those, so it never runs and `npm ci` still exits 0 with nothing downloaded.
Fix it once per install: run `node node_modules/electron/install.js` directly, or approve the `electron` package's scripts through whatever wrapper you're using (for example, an `npm approve-scripts electron`-style command).
Most machines are unaffected — this only bites setups with that wrapper in place.

**Dev server port already in use** (electron-vite reports the renderer port is taken).
Another dev server (or a stale one from a crash) holds it.
Quit the other process, or find and kill the stray one: `lsof -ti tcp:5173 | xargs kill` (electron-vite's default renderer port).

**A commit is blocked by gitleaks** (`gitleaks ...... Failed` in the pre-commit output, naming a file and a rule).
The scanner found something that looks like a secret in your staged changes — that's the hook doing its job.
Remove the secret (move it to `.env`, which is git-ignored) and re-stage.
If it is a genuine false positive, see the gitleaks docs on allow-listing; never commit a real secret with `--no-verify`.

**A stream strip is stuck on `reconnecting·n` for a long time** (the status chip, not the activity light).
LiveATC has likely taken that mount down or is having trouble; check [the Oshkosh search page](https://www.liveatc.net/search/?icao=osh) for the current mount.
If a different mount is now the live one for that frequency, update its `plsUrl` in `config.json` and click **Refresh config from disk**.
Either way the stream keeps retrying with backoff on its own — nothing in the app is broken.

**A video tile shows its offline placeholder** (or the grid worked yesterday and one tile is dark today).
EAA rotates which YouTube videoId is actually live, often daily during the show — the configured id has likely expired.
Find the feed's new id from EAA's live channel and update the matching entry's `videoId` (and `label`, if the cam changed) in [`src/renderer/src/youtube/defaultFeeds.ts`](../../src/renderer/src/youtube/defaultFeeds.ts), then run `just dev` again — see § Changing what you monitor.

**`just: command not found`.**
The task runner isn't installed or isn't on your `PATH`.
`brew install just` (or the winget/apt commands in Prerequisites), then open a new terminal.

**Images on the published docs site are broken.**
Expected until the Phase 5 site build — the legacy Pages build serves Git LFS pointer files, not the images.
GitHub's own rendering of the repo is unaffected.
See [TechStack.md](TechStack.md) § Known limitations.

## Where to go next

- Running and writing tests: [Testing.md](Testing.md).
- The stack and its tradeoffs: [TechStack.md](TechStack.md).
- Audio behavior in depth: [../design/Audio.md](../design/Audio.md).
- Video grid behavior in depth: [../design/Video.md](../design/Video.md).
- The full documentation map: [../README.md](../README.md).
- Agent-facing conventions and gotchas: [`../../CLAUDE.md`](../../CLAUDE.md) at the repository root.
