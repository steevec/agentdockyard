# Changelog

All notable changes to AgentDockyard are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

_(nothing yet)_

## [1.5.0] - 2026-04-22

### Added
- **HTML mode for info widgets** — each widget has a new "HTML" checkbox in Settings. When enabled, the URL response (or text content) is rendered as raw HTML with full support for inline `<style>` and `<script>` blocks. jQuery 3.7.1 is bundled locally and always available as `$`/`jQuery` inside widgets, so you can turn a widget into a mini-dashboard with collapsible panels, clickable rows, or any custom interaction. Widget layout in HTML mode is unconstrained (no flex/nowrap wrapper), letting your HTML dictate its own shape.
- **Larger widget payloads** — the per-widget fetch limit goes from 8 KiB to 256 KiB, making room for HTML + CSS + JS responses.
- **Lighter listings for AI agents by default** — `lister`, `lister_par_agent` and `lister_par_repo` now exclude `fait` and `annule` tasks by default, drastically reducing payload size for AI agents that only need active work. Pass `"inclure_fait": true` / `"inclure_annule": true` to opt back in, or `"statut": "fait"` to retrieve only closed tasks (e.g. to re-read a past summary). The in-app guide and the generated AI prompt both document the new flags. The desktop UI is unaffected (it already asks for everything and filters locally).

### Fixed
- **HTML widget rendered blank** — a stray double `else` in `renderer.js` silently broke the widget refresh logic, so URL widgets with HTML mode showed only the beginning of the response (typically the inline `<style>` block) and never the actual content underneath. The whole payload is now rendered as expected.
- **Agent CLI crashed on non-ASCII output** — on Windows, `agent.exe` (built with PyInstaller) defaulted to `cp1252` for stdout and threw `UnicodeEncodeError` as soon as a task note contained any character outside that codepage (e.g. `→`, emoji). This silently prevented the desktop UI from loading tasks. stdout/stderr are now wrapped in UTF-8 at startup, matching what the Electron main process already expects when reading the child pipe.
- **DevTools no longer forced open** — the packaged build no longer calls `openDevTools()` at window ready. `F12` / `Ctrl+Shift+I` still toggle it manually.

## [1.4.0] - 2026-04-20

### Added
- **Info widgets above the task list** — a new "Info widgets" section in Settings lets you pin custom lines above your tasks. Each widget can be either a fixed text or a URL that returns a short value (e.g. an endpoint that outputs "64 online"). URL widgets refresh on their own interval (10–3600 s, configurable per widget) and fetch through the main process to bypass the renderer's CSP. Widgets scroll with the task list, stack in order, and disappear under the header when you scroll down — great for at-a-glance numbers like connected users, uptime, build status, etc.

### Fixed
- **Closed-task order reversed** — when expanding the "N done" section inside a repo group, tasks are now sorted with the most recently closed at the top (previously shown in reverse order).

## [1.3.0] - 2026-04-19

### Added
- **Hourly backup history with preview & restore** — a new clock icon in the header opens a side panel listing every hourly snapshot of your tasks database. Backups are stored locally (one per hour, rotated after 7 days) and only taken while the app is running. Click any entry to open a read-only full-screen preview clearly marked with a thick orange border and a pulsing banner ("Backup preview — read only"), so you always know whether you're looking at live data or an archive. A "Replace current state" button swaps in the selected backup and automatically saves a safety copy of your current state first, so a mistaken restore can be reverted from the same history list.

## [1.2.0] - 2026-04-19

### Added
- **In-app update banner** — instead of two blocking popups, a slim banner at the bottom shows download progress then a "Restart & Install" button. No more interruptions.

### Fixed
- **All Settings labels now translated** — every section title, checkbox, label, and button in the Settings panel is translated in all 9 languages (previously only the Language selector title was translated).
- **Window drag no longer stutters** — `callAgent()` is now fully async (`spawn` instead of `spawnSync`), so the Electron main process is never blocked during tasks refresh or actions. Window movement is now smooth.

### Changed
- **Menu bar removed** — "File / Edit / View / Window / Help" native menu bar is gone. The app is a pure custom-chrome dashboard.

## [1.1.0] - 2026-04-19

### Added
- **Internationalisation (i18n)** — 9 languages: English (default), Français, Deutsch, Español, Italiano, Português, 中文, 日本語, हिन्दी. Language selector with flag emojis in Settings.
- **Cancel button** in the task add form — closes the form and resets fields without adding a task.
- **Unified AI prompt** in the Guide panel — a single copy-paste block for all agents (Claude Code, Claude Cowork, Copilot, Codex, etc.) replacing the previous per-agent blocks.

### Fixed
- **Dropdown reset on auto-refresh** — open status dropdowns are now preserved across automatic refresh cycles.
- **Window drag jerkiness** — the header bar is now a proper Electron drag region; all interactive elements (buttons, selects) are correctly marked `no-drag`.

### Performance
- GPU compositing layer (`will-change`, `transform: translateZ(0)`) applied to the tasks panel for smoother scrolling.
- Chromium smooth scrolling, GPU rasterisation and zero-copy flags enabled at startup.

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

[Unreleased]: https://github.com/steevec/agentdockyard/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/steevec/agentdockyard/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/steevec/agentdockyard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/steevec/agentdockyard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/steevec/agentdockyard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/steevec/agentdockyard/releases/tag/v1.0.0
