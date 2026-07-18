> Status: adopted | Audience: anyone cloning this repo for the first time, assuming no prior knowledge of this stack | See also: [Testing.md](Testing.md), [TechStack.md](TechStack.md), [../README.md](../README.md)

# Getting started

This walkthrough assumes you know nothing about Electron, Node, or this repo.
Follow it top to bottom on a fresh macOS machine and you will end at a running app window.
Windows and Linux get a short note at the end.

## Prerequisites (macOS via Homebrew)

You need five tools: git, Git LFS, Node.js, the `just` task runner, and Xcode's command-line tools (for native module builds).
Install [Homebrew](https://brew.sh) first if you don't have it, then:

```bash
brew install git git-lfs node just
xcode-select --install   # skip if already installed; safe to re-run
```

Git LFS must be activated once per machine after install — this teaches git to fetch the large binary assets this repo tracks:

```bash
git lfs install
```

Check the versions you got:

```bash
node --version   # want v20.19+ or v22+ — Electron 43 bundles Node 22
just --version
git lfs version
```

Node **20.19 or newer** (or any 22.x) is required; older Node cannot run the toolchain.
If `node --version` shows something older, upgrade with `brew upgrade node` or use a version manager.

## Clone and run

```bash
git clone https://github.com/ericwait/eaa-traffic-monitor.git
cd eaa-traffic-monitor
just dev
```

`just dev` is idempotent — safe to run any time.
On the first run it installs dependencies (this also downloads the Electron binary, ~100 MB, so give it a minute), then starts the electron-vite dev server and launches the app.

### What you should see

A dark desktop window titled **EAA Traffic Monitor**, showing a "Phase 0 · scaffold" badge, the app name, a one-line tagline, and a ticking "window up" timer.
That is the whole Phase 0 app — the real three-panel layout (audio, tracking, video) arrives in later phases.
Edits to renderer source hot-reload automatically; edits to the main process restart the app.

Quit the app the normal way (Cmd-Q, or close the window) — there is no background service left running.

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
| `just up` | Build and preview the production app (loads over `app://`, no dev server) |
| `just test` | Run the vitest unit suite |
| `just e2e` | Build, then run the Playwright-Electron launch smoke |
| `just lint` | ESLint, check-only |
| `just fmt` | Prettier, writes changes in place |
| `just typecheck` | TypeScript, all tsconfigs, check-only |
| `just version` | Print the git-computed SemVer (needs GitVersion; CI computes the authoritative one) |
| `just reset` | DESTRUCTIVE — wipes deps, build output, and dev app data (asks first) |

`down`, `migrate`, and `health` exist for muscle-memory parity with service projects but print "n/a for a desktop app" — this app has no server, datastore, or health endpoint.

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

**Dev server port already in use** (electron-vite reports the renderer port is taken).
Another dev server (or a stale one from a crash) holds it.
Quit the other process, or find and kill the stray one: `lsof -ti tcp:5173 | xargs kill` (electron-vite's default renderer port).

**A commit is blocked by gitleaks** (`gitleaks ...... Failed` in the pre-commit output, naming a file and a rule).
The scanner found something that looks like a secret in your staged changes — that's the hook doing its job.
Remove the secret (move it to `.env`, which is git-ignored) and re-stage.
If it is a genuine false positive, see the gitleaks docs on allow-listing; never commit a real secret with `--no-verify`.

**Images on the published docs site are broken.**
Expected until the Phase 5 site build — the legacy Pages build serves Git LFS pointer files, not the images.
GitHub's own rendering of the repo is unaffected.
See [TechStack.md](TechStack.md) § Known limitations.

## Same tools on Windows / Linux

Full parity is macOS-first for the sprint, but the stack is cross-platform.

- **Windows:** install the same tools with winget — `winget install Git.Git GitHub.GitLFS OpenJS.NodeJS Casey.Just`, then `git lfs install`.
  `just dev` works the same.
- **Linux (Debian/Ubuntu):** `sudo apt install git git-lfs nodejs npm`, install `just` from its [releases](https://github.com/casey/just) or your distro, then `git lfs install`.
  A headless machine needs `xvfb` to run `just e2e` (CI does this automatically).

## Where to go next

- Running and writing tests: [Testing.md](Testing.md).
- The stack and its tradeoffs: [TechStack.md](TechStack.md).
- The full documentation map: [../README.md](../README.md).
- Agent-facing conventions and gotchas: [`../../CLAUDE.md`](../../CLAUDE.md) at the repository root.
