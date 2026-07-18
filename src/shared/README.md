# `shared/` — the cross-process contract

Code compiled by **all three** processes (main, preload, renderer). Because
TypeScript spans the whole app, a shape change here is a compile-time error
everywhere it is used rather than a runtime surprise in one process. Import it
via the `@shared/*` alias (configured in `electron.vite.config.ts` and both
tsconfigs).

Present now:

- `format.ts` — pure UI helpers (`clamp`, `formatCountdown`); first vitest target.

Planned (see the architecture plan):

- `types.ts` (+ zod schemas) — feed defs, VAD/duck params, session shape.
- `ipc.ts` — the single typed IPC contract every process compiles against.
- `defaultConfig.ts` — curated KOSH streams, EAA feeds, priorities, VAD params.
- `plsParser.ts` — **pure** `.pls` parsing; a vitest guardian target.

Keep this folder free of Electron and DOM APIs so it stays importable from the
main process, the renderer, and vitest alike.
