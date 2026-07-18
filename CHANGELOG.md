<!--
Policy: every release updates this file, under the section for that version,
with whichever of the six subsections apply. This is not a request — the release
flow gates on it mechanically: a release whose diff doesn't touch this file
fails the preflight. Keep entries terse and user-facing; implementation detail
belongs in commit messages, not here.

Format: Keep a Changelog (https://keepachangelog.com/en/1.1.0/).
Versioning: SemVer, computed from git history — never hand-edited here.
-->

# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Project scaffold: electron-vite + TypeScript + React substrate (main / preload
  / renderer, strict TypeScript, three tsconfigs).
- Privileged `app://` custom scheme serving the packaged renderer from a secure,
  non-`file://` origin.
- Seed-kit toolchain adoption: justfile task verbs, pre-commit hooks
  (gitleaks / eslint / prettier), tiered GitHub Actions CI, GitVersion, and the
  developer docs home (`Getting-Started.md`, `Testing.md`).
- Test substrate: vitest unit tier and a Playwright-for-Electron launch smoke.

### Changed

### Fixed

### Deprecated

### Removed

### Known Issues

- Alpha artifacts are unsigned — macOS Gatekeeper and Windows SmartScreen show
  first-launch warnings (documented in `docs/development/TechStack.md`).
