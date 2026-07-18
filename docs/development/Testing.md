> Status: adopted | Audience: anyone writing or reviewing a change | See also: [Getting-Started.md](Getting-Started.md), [../Implementation-Plan.md](../Implementation-Plan.md)

# Testing

## The two tiers

This is a desktop app with no datastore, so there is no integration tier in the service sense.
The suite has two tiers:

```text
tests/unit/   Pure logic — no DOM, no Electron, no I/O. Fast and deterministic.
tests/e2e/    The built app, launched and driven like a user would (Playwright-for-Electron).
```

The weight sits on **unit**, because the app's hardest correctness lives in pure functions:
the VAD math that decides when an activity light turns on, the ducking matrix that decides which stream wins, the `.pls` parser that turns a LiveATC playlist into a stream URL.
Each of those is input-to-output with real edge cases and no I/O — exactly what unit tests are good at.
E2e earns its keep on one thing only: proving the whole app still launches and mounts.

## Acceptance-first workflow

Outside-in, in this order:

1. Write the acceptance check from the requirement itself — for this app that is usually the e2e launch smoke or a manual `just dev` observation.
   Watch it fail honestly; a green test at this step means it isn't testing anything.
2. Write unit tests for the pure logic underneath, edge cases first.
3. Write code until everything is green.
4. Run `just lint`, `just typecheck`, `just fmt` — all clean before you commit.

## Guardian suites

Logic whose silent failure would be expensive gets a **named guardian suite**: a dedicated, edge-case-heavy test module for that one computation.
A crash is cheap to notice; a wrong number — a light that lies about who's talking, a duck that fights itself — is not.

**Standing rule: change the computation, update its guardian in the same change.**

| Suite | What it protects | Status |
| --- | --- | --- |
| `tests/unit/format.test.ts` | `clamp` (audio-param range guards) and `formatCountdown` | Present |
| `vad.ts` guardian | Voice-activity math: noise-floor adaptation, hysteresis, attack/hang — the light must match the ear | Future (Phase 2a) |
| `ducking.ts` guardian | Priority-ducking matrix: strictly-higher-only, equal-rank never ducks, solo overrides | Future (Phase 2b) |
| `.pls` parser guardian | LiveATC playlist parsing: `File1` extraction, redirect handling | Future (Phase 2a) |
| bounds validator guardian | Saved window bounds vs current displays: recentre / reassign when a monitor is gone | Future (Phase 4) |

The future guardians land with the phase that introduces their code — never after.

## Determinism

Freeze time; seed randomness.
A test that passes sometimes tells you nothing.
The reconnect backoff and the VAD's time-based hysteresis are the obvious traps here — inject the clock, don't read the wall clock.

## No silent skips

No test is skipped without a reason string linking the issue that will unskip it.
A skip with no reason is a failure with a snooze button.

## Running the suite

```bash
just test   # unit tier (vitest)
just e2e    # build, then the Playwright-Electron launch smoke
```

`just e2e` builds the app first because the Playwright config never builds on its own — it launches whatever is in `out/`.
On a headless machine (CI) the e2e job runs under `xvfb-run`; locally on macOS it runs headed, which is fine.
If either command can't launch, see [Getting-Started.md](Getting-Started.md) § Troubleshooting.

## What CI runs

The FAST tier (every PR) runs eslint, tsc, and the vitest unit tier.
The FULL gate (a develop-to-main PR, or a manual dispatch) adds the Playwright-Electron e2e under xvfb and a non-blocking `npm audit`.
See [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
