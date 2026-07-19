# ==============================================================================
# justfile — the project's operational vocabulary.
#
# Single source of truth for how anyone — human or agent — runs this project.
# Every runbook, every CI job, and every skill under .claude/commands/ delegates
# to these verbs instead of reimplementing the steps behind them. "How do we do
# X?" is answered with a verb name, not a paragraph. Keep the verb NAMES stable;
# anything that calls `just <verb>` breaks the moment a name changes.
#
# `just --list` shows the LAST comment line above each recipe as its doc string —
# keep that line a one-line summary; contract details go above it.
#
# This is a DESKTOP Electron app, not a service: down / migrate / health have no
# meaning here and say so explicitly rather than pretending.
# ==============================================================================

set shell := ["bash", "-euo", "pipefail", "-c"]

# ELECTRON_RUN_AS_NODE, if inherited from an IDE-integrated terminal (the VS
# Code family exports it), forces Electron to launch as a plain Node process —
# no app, no window, and Playwright fails with "bad option:
# --remote-debugging-port". Strip it from every recipe that launches Electron.
export ELECTRON_RUN_AS_NODE := ""

# List every recipe with its doc comment (run with no args).
default:
    @just --list

# CONTRACT: idempotent bootstrap. Safe to re-run on a machine that already has a
# working environment. Installs node_modules only when missing, then starts the
# electron-vite dev server with HMR and launches the app against it.
#
# Bootstrap and run the dev app (idempotent): install if needed, then electron-vite dev.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d node_modules ]; then
        echo "node_modules missing — running npm ci (this also downloads Electron)…" >&2
        npm ci
    fi
    exec npm run dev

# CONTRACT: preview the PRODUCTION build — build all three processes, then run
# the packaged renderer over the app:// scheme (not the dev server). The
# lighter, prod-fidelity sibling of `dev`.
#
# Build and preview the production app (electron-vite preview).
up:
    npm run build
    npm run preview

# CONTRACT: n/a for a desktop app. There is no long-running service to stop;
# quitting the app window is the whole story. Exits 0 so scripted callers don't
# treat "nothing to do" as a failure.
#
# n/a for a desktop app (no service to stop).
down:
    @echo "n/a for a desktop app — quit the app window to stop it." ; exit 0

# CONTRACT: DESTRUCTIVE. Removes build output, installed dependencies, and this
# app's dev userData directory (persisted config/session/FR24 login). Asks for a
# typed confirmation before touching anything — the friction is deliberate.
#
# DESTRUCTIVE: remove node_modules/out/dist + dev userData (asks for typed confirmation).
reset:
    #!/usr/bin/env bash
    set -euo pipefail
    userdata="$HOME/Library/Application Support/airshow-traffic-monitor"
    echo "This will permanently delete:" >&2
    echo "  - node_modules/ out/ dist/ (rebuilt by 'just dev')" >&2
    echo "  - $userdata (dev config, session, FR24 login)" >&2
    read -p "Type 'yes' to continue: " confirmation
    if [ "$confirmation" != "yes" ]; then
        echo "Aborted — no changes made." >&2
        exit 1
    fi
    rm -rf node_modules out dist
    rm -rf "$userdata"
    echo "Reset complete. Run 'just dev' to rebuild." >&2

# CONTRACT: run the full automated unit suite (vitest). Deterministic — no flaky
# retries, no skip without a reason string. The e2e tier is a separate verb
# because it needs a built app to launch.
#
# Run the unit test suite (vitest run).
test:
    npm test

# CONTRACT: run the end-to-end tier — build the app, then drive the real
# packaged window with Playwright-for-Electron. Builds first so out/ exists;
# the Playwright config never builds on its own.
#
# Build the app, then run the Playwright-Electron e2e smoke.
e2e:
    npm run build
    npm run e2e

# CONTRACT: static analysis only (eslint). Reports problems; never mutates
# files. A non-zero exit means real findings, not a formatting nit `fmt` fixes.
#
# Static analysis, check-only — never mutates files.
lint:
    npm run lint

# CONTRACT: auto-format the codebase in place (prettier). Idempotent — running
# it twice produces no further diff. Pairs with the pre-commit hook so local and
# CI never disagree about what "formatted" means. Markdown is excluded (semantic
# line breaks are human-owned — see .prettierignore).
#
# Auto-format the codebase in place (idempotent).
fmt:
    npm run format

# CONTRACT: static type checking only, across all three tsconfigs (node + web).
# Read-only, like `lint`.
#
# Static type checking across all tsconfigs, check-only.
typecheck:
    npm run typecheck

# CONTRACT: n/a for a desktop app. No datastore, no migrations. Exits 0.
#
# n/a for a desktop app (no datastore/migrations).
migrate:
    @echo "n/a for a desktop app — no datastore or schema migrations." ; exit 0

# CONTRACT: n/a for a desktop app. No health endpoint to hit. Exits 0.
#
# n/a for a desktop app (no health endpoint).
health:
    @echo "n/a for a desktop app — no health endpoint." ; exit 0

# CONTRACT: print the SemVer computed from git history — never hand-edited. CI
# computes the authoritative version (see .github/workflows/ci.yml); this local
# recipe is a convenience that degrades to a clear, actionable message when the
# tool is not installed rather than failing cryptically.
#
# Print the SemVer computed from git history (GitVersion).
version:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v dotnet-gitversion >/dev/null 2>&1; then
        dotnet-gitversion /showvariable SemVer
    elif command -v gitversion >/dev/null 2>&1; then
        gitversion /showvariable SemVer
    else
        echo "GitVersion is not installed locally." >&2
        echo "Install it with:  brew install gitversion" >&2
        echo "CI computes the authoritative version regardless (see .github/workflows/ci.yml)." >&2
        exit 1
    fi
