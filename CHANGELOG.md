# Changelog

All notable changes to AgentDockyard are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **HTTP API section in Settings** — enable/disable the local HTTP API, change the listen host and port, and set an access token directly from the Settings panel, with a one-click **token generator** (24 random bytes, hex). Changes are applied immediately on save: the HTTP server is restarted on the fly with the new configuration, no app restart needed. Previously this required editing `config.json` by hand and relaunching. Translated into the 9 bundled languages.
- **Checklist progress bars on task cards** — when a task note contains a `- [ ]` / `- [x]` checklist (the recommended `ETAT D AVANCEMENT` format for AI agents), the card now shows a slim progress bar with a `done/total` counter, turning green when everything is checked. Progress is visible at a glance without opening the note.
- **Relative dates on task cards** — creation and closing dates now display as localized relative times ("il y a 2 heures", "hier", "2 時間前") via `Intl.RelativeTimeFormat`, with the exact absolute date in a tooltip. Events older than 7 days keep the absolute date. Labels age automatically with each refresh.
- **Stacked toasts** — each notification now gets its own toast; several rapid actions no longer overwrite each other's feedback (up to 4 visible at once).
- **Styled confirmation dialog** — all destructive actions (delete task, purge, delete prompt/folder, restore snapshot) now use an in-app themed modal instead of the native blocking `confirm()`. Escape or clicking the backdrop cancels; the confirm button has keyboard focus.
- **Search term highlighting** — while searching, matched terms are highlighted in card subjects, contexts and notes with a `<mark>` accent.
- **Widget URLs follow redirects** — URL widgets now follow up to 3 HTTP redirects (including relative `Location` headers) instead of failing with "Redirection (non suivie)".

### Changed
- **`agent.exe` is now built with PyInstaller `--onedir`** — in `--onefile` mode, every single invocation self-extracted the whole Python runtime into `%TEMP%` before running (~300-800 ms of CPU/disk/antivirus per call), and the agent is spawned on every UI refresh and every HTTP API call. The onedir layout (`resources/agent/agent.exe` + `_internal/`) starts almost instantly (~140 ms per call measured, actual work included).
- **Electron upgraded 29 → 43** (with electron-builder 26 and electron-updater 6.8) — Electron 29 had been end-of-life for a long time, meaning no more Chromium security fixes while the renderer can execute remote HTML/JS through `allow_html` widgets. Also fixes the moderate js-yaml advisory via `npm audit fix`.
- **Hourly snapshots now use SQLite `VACUUM INTO`** (through a new internal `sauvegarder` agent action) instead of a raw file copy — the backup is guaranteed consistent even if a write is in flight, and gets compacted for free. Raw copy remains as a fallback when the agent is unavailable.
- **Strict `.gitattributes`** (`* text=auto eol=lf`) added to enforce the repo-wide LF policy.

### Fixed
- **"Export JSON" button never worked** — the IPC handler called `callAgent()` without `await`, so it always saw a pending Promise instead of the agent response and systematically reported "Echec export". The handler is now async and awaits the agent; the export file is actually written to the data folder.
- **Purge and claim-expiry settings were ignored** — `agent.py` hardcoded the auto-purge to 90 days and the claim auto-release to 24 h, so the Settings fields "Purge done/cancelled tasks after (days)", the "Enable auto-purge" toggle and "Auto-release claims after (hours)" had no effect at all. The agent now reads `config.json` (written by the app next to `tasks.db`) and honours those settings, with separate delays for done and cancelled tasks, including when invoked directly by CLI agents. Missing or corrupt config falls back to the historical 90 d / 24 h defaults.
- **"Purge on startup too" deleted ALL closed tasks** — the startup purge reused the `purger_maintenant` action, which empties every done/cancelled task regardless of age (that behaviour belongs to the explicit "Purge now" button and its confirmation dialog). Startup now calls a new `purger_auto` action that only removes tasks whose configured retention delay has expired.
- **Repo names containing an apostrophe broke the UI** — `esc()` did not escape single quotes while collapse/expand handlers are generated inside single-quoted `onclick` attributes, so a repo like `L'appli` produced broken HTML (group impossible to fold, and an HTML-injection vector for task data coming from the network API). `esc()` now escapes `'` and the repo-based handlers are escaped accordingly.
- **Multi-byte UTF-8 characters could be corrupted in transit** — the agent stdout/stderr pipes (Electron UI and HTTP API) and the HTTP request body were accumulated string-by-chunk; a multi-byte character (accent, emoji, `→`) split across two chunks was turned into replacement characters. Streams now use `setEncoding('utf8')` and the HTTP body is accumulated as Buffers and decoded once.
- **DB watcher never started on a fresh install** — when `tasks.db` did not exist yet at launch (it is created by the first agent call), `fs.watch` was skipped forever, so external agent writes did not refresh the UI until the app was restarted. The watcher now retries every 5 s until the database file exists.

### Changed
- **SQLite journal mode switched from OFF to DELETE** — with `journal_mode=OFF` an interrupted write (crash, kill, power loss) could corrupt `tasks.db` beyond repair since there is no rollback journal. DELETE restores atomic transactions with no visible cost at this scale. WAL was deliberately not chosen: hourly snapshots copy the single `tasks.db` file, and a non-checkpointed `-wal` would silently lose the latest writes in snapshots.

## [1.8.1] - 2026-06-12

### Fixed
- **Two instances could both serve the local HTTP API on port 17891** — there was no single-instance lock, so launching a second instance (typically a dev build while the installed app is running) started a second HTTP server. On Windows, two processes owned by the same user can bind `127.0.0.1:17891` at the same time without `EADDRINUSE`, and Windows then spreads incoming agent calls between both servers non-deterministically — meaning an agent request could hit the wrong instance and read/write (or auto-purge) the wrong `tasks.db`. Two complementary guards now prevent this: (1) `app.requestSingleInstanceLock()` makes a second instance of the **same install** quit immediately and refocus the existing window; (2) since the Electron lock is keyed on the `userData` path and therefore doesn't cover the dev-build-vs-installed-app case, `startHttpApi()` now probes `/health` before binding and skips starting its own server if another AgentDockyard already answers on the port.

## [1.8.0] - 2026-06-12

### Added
- **Search bar in the header** — a new search field next to the task counter filters the task list live, by **task number** or by **text**. A numeric term matches the task id (exact or substring, e.g. `28` finds `2806` and `128`); any term also matches the subject, context, note, repo and agent (case-insensitive). Multiple words are combined with AND. While searching, **done and cancelled tasks are included automatically** (the whole point is to find a closed task again), collapsed repo groups and the "completed tasks" sections expand on their own so nothing stays hidden, and the per-group display cap is lifted. When nothing matches, a dedicated "No task matches this search" message is shown. **Ctrl+F** (and Cmd+F) focuses the field and selects its content; **Escape** clears the search. Fully client-side — `get-tasks` already returns every task, so the backend (`agent.py`) and the HTTP API are untouched. Translated into the 9 bundled languages.

### Changed
- **Database path removed from the header** — it was redundant with the **Settings → Database** section (which already shows the full path plus "Open folder" / "Export" buttons), and the freed space makes room for the new search bar. The now-dead `truncatePath` helper and the `#db-path-display` styling were removed as well.

## [1.7.1] - 2026-06-11

### Fixed
- **Console window flashing and stealing keyboard focus on every agent call** — `agent.exe` is a console binary, and both the Electron UI (`callAgent` in `main.js`) and the local HTTP API (`http-api.js`) spawned it without the `windowsHide` option, whose Node.js default is `false`. Windows therefore created a real, visible console window for each call: it popped up for a fraction of a second and stole the keyboard focus from whatever the user was typing — several times a day, every time an AI agent created, claimed, updated or closed a task through the HTTP API. All `spawn`/`spawnSync` call sites now pass `windowsHide: true` (`CREATE_NO_WINDOW`), so the agent process runs completely invisible.

## [1.7.0] - 2026-05-28

### Added
- **Prompts manager — folders and drag-and-drop reorganisation** — the prompts side panel now supports one level of folders to group your reusable prompts by topic. A new **+ Add a folder** button creates a named folder, and the existing prompt modal gains a **Folder** dropdown so you can file a prompt under the root or any existing folder, both at creation and when editing (move a prompt across folders without retyping it). Each folder header shows its prompt count and a ▶/▼ chevron to collapse or expand. Reorganise everything either with **native HTML5 drag-and-drop** (drop between two items, into a folder's child area, or back to the root for folders) or with new **⬆️ / ⬇️ arrow buttons** available on every prompt and folder, at every depth. Deleting a non-empty folder asks for confirmation and reparents its prompts to the root rather than losing them. Existing flat prompt lists keep working as-is thanks to a transparent in-memory migration that preserves every entry.

## [1.6.0] - 2026-05-10

### Added
- **Prompts manager** — a new clipboard icon in the header opens a side panel where you can keep a list of reusable prompts. Each prompt has a title and a free-form content, and the list is ordered manually. Per-prompt actions: **Copy** sends the content straight to the clipboard (Electron-side, with a `navigator.clipboard` fallback), **Edit** opens a dedicated modal with a large textarea, **Move down** swaps the prompt with the next one to reorder the list, and **Delete** removes the entry after confirmation. Useful for keeping handy the system prompts you keep pasting into AI tools, code review checklists, recurring instructions, etc. Stored in `config.json` under `prompts: []`, persisted via the existing settings pipeline.

## [1.5.1] - 2026-04-23

### Fixed
- **Main process crashed with `ReferenceError: Cannot access 'child' before initialization`** — in `callAgent`, `setTimeout` was scheduled *before* `const child = spawn(...)`. When `spawn()` threw synchronously (typically when Windows Defender or another antivirus blocked the unsigned `agent.exe`), the child variable was never initialized, but the already-scheduled timer fired 10 s later and hit it in the temporal dead zone, taking down the whole Electron main process with a fatal JavaScript error dialog. `spawn()` now runs first, inside a `try/catch` that resolves the promise cleanly with a `NOK` status, and the timer's `child.kill()` call is also guarded. The app stays usable and surfaces a normal error instead of crashing, even when the agent binary is unavailable.

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

[Unreleased]: https://github.com/steevec/agentdockyard/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/steevec/agentdockyard/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/steevec/agentdockyard/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/steevec/agentdockyard/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/steevec/agentdockyard/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/steevec/agentdockyard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/steevec/agentdockyard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/steevec/agentdockyard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/steevec/agentdockyard/releases/tag/v1.0.0
