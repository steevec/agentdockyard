# Changelog

All notable changes to AgentDockyard are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

_(nothing yet)_

## [1.0.0] - 2026-04-18

First public release.

### Added
- Electron-based desktop dashboard (Windows x64).
- Bundled standalone `agent.exe` (PyInstaller) — no Python required on the target machine.
- Dark and Light themes, switchable from the header.
- Full **Settings** panel:
  - Theme, auto-purge (`fait`/`annule` older than N days), claim-expiry, refresh interval.
  - Show/hide `fait` and `annule` tasks; cap tasks per group.
  - Multi-screen window placement: remember last position automatically, or pin to a specific screen with manual X/Y/W/H or full-width/full-height.
  - Editable list of known agents (emoji + id + label).
  - Database folder + JSON export.
  - In-app check for updates.
- Built-in **Guide** panel:
  - "Utilisation" tab: status legend, claim system, keyboard shortcuts.
  - "Prompt IA" tab: copy-paste blocks for Claude Code, Claude Cowork, Copilot/Codex/others, with the local `agent.exe` path injected automatically.
  - Reference table of every CLI action.
- Real-time refresh on external DB writes via `fs.watch`.
- Claim system with auto-expiry.
- `purger_maintenant` and `exporter_json` CLI actions.
- Auto-update via GitHub Releases (NSIS target, `electron-updater`).
- NSIS installer with desktop + start-menu shortcuts.
- Portable build.
- MIT license, public repository.

### Known limitations
- Windows only (macOS + Linux build scripts planned).
- Installer is unsigned — Windows SmartScreen warns on first launch.
- No telemetry, no crash reporting — issues are to be reported manually on GitHub.

[Unreleased]: https://github.com/steevec/agentdockyard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/steevec/agentdockyard/releases/tag/v1.0.0
