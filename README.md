# AgentDockyard

<p align="left">
  <a href="https://github.com/steevec/agentdockyard/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/steevec/agentdockyard?display_name=tag&sort=semver&color=6366f1"></a>
  <a href="https://github.com/steevec/agentdockyard/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/steevec/agentdockyard/total?color=4ade80"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/steevec/agentdockyard?color=818cf8"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-blue">
  <a href="https://github.com/steevec/agentdockyard/issues"><img alt="Issues" src="https://img.shields.io/github/issues/steevec/agentdockyard?color=f87171"></a>
</p>

**Supervise your AI agents' tasks from a local desktop dashboard.**

Track in real time what Claude Code, Claude Cowork, Copilot, Codex (or any other AI agent) are doing across your projects — all stored 100% locally.

> By [Steeve Cordier](https://sitecrea.fr/) — MIT License

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [Screenshots](#screenshots)
- [Install](#install)
- [Wire up your AI agents](#wire-up-your-ai-agents)
- [Settings](#settings)
- [Architecture](#architecture)
- [Build from source](#build-from-source)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Why

If you run several AI agents in parallel — one editing code, another closing Linear tickets, another updating a doc — it quickly becomes impossible to answer:

- *What is each agent doing right now?*
- *Which tasks did they finish? Which ones are blocked?*
- *Who's already claimed this task, so I don't spin up a second agent on it?*

AgentDockyard solves this with a shared local SQLite database and a tiny desktop dashboard. Each agent declares its tasks via a one-liner CLI; you see everything update in real time.

Built for a single developer's workflow, not a team/cloud product. If that matches how you work, it might fit you.

---

## Features

- **Real-time dashboard** — refreshes instantly whenever any agent writes to the shared database
- **Dark & Light themes** — neutral dark / warm beige, switchable from the header
- **Claim system** — know which agent is currently working on a task, with auto-expiry
- **Built-in prompt guide** — copy-paste ready CLI instructions for Claude Code, Cowork, Copilot, Codex…
- **Full settings panel** — purge rules, refresh rate, multi-screen window placement, custom agents list
- **100% local SQLite** — no cloud, no telemetry, no account
- **Auto-update** via GitHub Releases (can be disabled)
- **Zero runtime dependencies** — the installer bundles everything; no Python or extra tools to install

---

## Screenshots

> Placeholder — actual screenshots will be added once the UI is frozen.

| Dark mode | Light mode | Guide panel (copy-ready prompts) |
|---|---|---|
| *coming soon* | *coming soon* | *coming soon* |

---

## Install

### Windows (recommended)

1. Grab **`AgentDockyard-Setup-x.y.z.exe`** from the [latest release](https://github.com/steevec/agentdockyard/releases/latest).
2. Double-click — installation creates desktop + start-menu shortcuts automatically.
3. Launch AgentDockyard from the start menu.

A **portable** build (`AgentDockyard-Portable-x.y.z.exe`) is also published — no install, just run.

The installer is currently **unsigned**, so Windows SmartScreen will ask you to confirm on the first launch. Code signing is on the [roadmap](https://github.com/steevec/agentdockyard/issues).

### macOS / Linux

Not packaged yet — tracked in [issue #TBD](https://github.com/steevec/agentdockyard/issues). PRs welcome.

---

## Wire up your AI agents

Launch AgentDockyard → click **📖 Guide** in the header → **Prompt IA** tab.
Copy the block matching your agent (Claude Code, Cowork, Copilot…) and paste it into the agent's `CLAUDE.md` / system prompt. The path to the bundled `agent.exe` is injected automatically.

Then, from the agent's shell:

```bash
# Agent announces a new task
"C:\Program Files\AgentDockyard\resources\agent.exe" '{"action":"ajouter","agent":"claude-code","repo":"my-project","sujet":"Fix bug X","statut":"en_cours"}'

# Agent updates progress
"C:\Program Files\AgentDockyard\resources\agent.exe" '{"action":"modifier","id":42,"note":"Step 1 done, running tests"}'

# Agent closes the task with a summary
"C:\Program Files\AgentDockyard\resources\agent.exe" '{"action":"cloturer","id":42,"note":"Shipped in PR #123"}'
```

The full command reference lives in the in-app guide and in [`agent.py`](agent.py).

### Statuses

| Value | Meaning |
|---|---|
| `en_cours` | Currently being worked on |
| `a_faire_rapidement` | Urgent, pick up next |
| `bloque` | Stuck — needs input or decision |
| `en_attente` | Paused, will resume later |
| `fait` | Done, with a summary note |
| `annule` | Cancelled, no summary needed |

---

## Settings

Everything is editable in the **⚙️ Settings** panel:

- **Appearance** — dark/light theme
- **Auto-purge** — remove `fait`/`annule` tasks older than N days (default 90)
- **Claim expiry** — auto-release claims after N hours (default 24)
- **Refresh** — interval, whether to show `fait`/`annule`, cap per group
- **Window** — remember position across restarts, or target a specific screen on multi-monitor setups
- **Agents** — edit the list of known agents (emoji + id + label) shown in dropdowns
- **Database** — open the data folder, export all tasks as JSON
- **About** — check for updates, open the GitHub repo

Settings are stored in `%APPDATA%\AgentDockyard\config.json`. The SQLite database lives next to it as `tasks.db`.

---

## Architecture

```
 ┌────────────────────────────────┐
 │  Renderer (HTML/CSS/JS)        │
 │  theme, panels, task cards     │
 └──────────┬─────────────────────┘
            │ IPC (preload bridge)
 ┌──────────▼─────────────────────┐                        ┌──────────────────────┐
 │  Electron main (main.js)       │ ─── spawnSync ───────► │  agent.exe (bundled) │
 │  window, config, updater       │                        │  PyInstaller bundle  │
 └──────────┬─────────────────────┘                        └──────────┬───────────┘
            │ fs.watch(tasks.db)                                       │
            │                                                          ▼
            └── notifies renderer on external write ───────────── tasks.db (SQLite)
                                                                       ▲
                                external AI agents call agent.exe  ────┘
                                (Claude Code, Cowork, Copilot, ...)
```

- **Electron renderer** — dashboard UI, zero business logic
- **Electron main** — window lifecycle, config JSON, multi-screen placement, auto-updater, watches `tasks.db` for external writes
- **`agent.exe`** — a PyInstaller-compiled standalone binary (no Python required on the target machine). Reads/writes `tasks.db` on behalf of AI agents via CLI
- **`tasks.db`** — SQLite, with a VirtioFS fallback for Linux-side agents (Claude Cowork) when the same DB is shared with a Windows host

Data locations:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\AgentDockyard\` |
| macOS *(planned)* | `~/Library/Application Support/AgentDockyard/` |
| Linux *(planned)* | `~/.config/AgentDockyard/` |

---

## Build from source

### Prerequisites

- **Node.js 20+**
- **Python 3.8+** with `pip install pyinstaller` (only needed to build the `.exe`; end users don't need Python)
- **Windows** (macOS/Linux build is not yet wired up)

### Commands

```bash
git clone https://github.com/steevec/agentdockyard.git
cd agentdockyard
npm install
npm start                 # run in dev
npm run build:agent       # compile agent.py -> dist-agent/agent.exe
npm run build             # everything: agent.exe + NSIS installer + portable
```

Artefacts land in `dist/`:
- `AgentDockyard-Setup-x.y.z.exe` — NSIS installer
- `AgentDockyard-Portable-x.y.z.exe` — portable
- `latest.yml` — consumed by `electron-updater` for auto-updates

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev environment caveats (including a known workaround when running under Claude Code).

---

## FAQ

**Do I need Python installed to use the app?**
No. `agent.exe` is bundled with the installer and runs standalone. Python is only needed if you rebuild from source.

**Does it phone home?**
Only for checking GitHub for updates (off if `autoUpdater` is disabled in the code or you block network). No analytics, no telemetry, no cloud sync.

**Can multiple users share the same `tasks.db`?**
Yes, e.g. via a shared network drive — with the caveat that SQLite's concurrency model allows only one writer at a time. For heavy concurrent use, a proper DB would be better.

**Windows Defender flags the installer — is that a problem?**
The installer is unsigned (signing costs ~€300/year for an EV cert). Defender SmartScreen will warn on first run; clicking "Run anyway" is safe. Signed releases are [on the roadmap](https://github.com/steevec/agentdockyard/issues).

**Why PyInstaller and not rewriting `agent.py` in Node?**
`agent.py` is the source of truth used by all the agent integrations in the author's workflow. Having a single Python implementation keeps both the bundled `agent.exe` and the raw `agent.py` (for environments without the installer, e.g. Linux Cowork) in perfect sync.

---

## Contributing

Bug reports, feature ideas, and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build locally and the coding conventions.

For anything security-sensitive, see [SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE) © [Steeve Cordier](https://sitecrea.fr/)
