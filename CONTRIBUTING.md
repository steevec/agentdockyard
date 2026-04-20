# Contributing to AgentDockyard

Thanks for considering a contribution! This document covers everything you need to hack on AgentDockyard locally.

## TL;DR

```bash
git clone https://github.com/steevec/agentdockyard.git
cd agentdockyard
npm install
npm start     # launches the Electron app in dev
```

For building the distributable installer, see the [Build](#build-the-installer) section below.

---

## Prerequisites

- **Node.js 20+** ([nodejs.org](https://nodejs.org))
- **Python 3.8+** with `pip install pyinstaller`
  *(only needed to build the standalone `agent.exe` — end users don't need Python)*
- **Windows 10/11 x64** — macOS/Linux builds are not wired up yet
- **Git**

---

## Project layout

```
agentdockyard/
├── main.js              # Electron main process: window, config, IPC, auto-updater
├── preload.js           # IPC bridge (contextBridge → window.taskAPI)
├── renderer.js          # UI logic: themes, panels, task cards, guide
├── index.html           # Layout
├── style.css            # Two themes via CSS variables
├── config.default.json  # Default config schema
├── agent.py             # SQLite CLI — compiled into agent.exe at build time
├── scripts/
│   ├── build-agent.js   # Compiles agent.py → agent.exe via PyInstaller
│   ├── dev-start.js     # Launches Electron in dev (see "Dev caveats")
│   └── seed-test-data.js# Injects sample tasks (useful for UI work)
├── assets/              # Icons
└── .github/             # Workflows, issue/PR templates
```

Data at runtime is kept in `%APPDATA%\AgentDockyard\`:
- `tasks.db` — SQLite
- `config.json` — user settings (overrides `config.default.json`)

---

## Common commands

| Command | What it does |
|---|---|
| `npm start` | Launch the Electron app in dev mode |
| `npm run build:agent` | Compile `agent.py` into `dist-agent/agent.exe` (requires Python + PyInstaller) |
| `npm run build` | Full build: `agent.exe` + NSIS installer + portable |
| `npm run build:nsis` | Just the NSIS installer |
| `npm run build:portable` | Just the portable build |
| `node scripts/seed-test-data.js` | Fill the installed app's DB with sample tasks |

---

## Dev caveats

A couple of things bit us during development. If you run into them, here's the fix.

### 1. `ELECTRON_RUN_AS_NODE` environment variable

Some environments (notably **Claude Code**) set `ELECTRON_RUN_AS_NODE=1`, which makes `electron.exe` behave as plain Node.js. In that mode, `require('electron')` returns a string path instead of the `{ app, BrowserWindow, ... }` API, and the app crashes immediately on `app.isPackaged`.

**Fix** — `npm start` uses [`scripts/dev-start.js`](scripts/dev-start.js), which unsets the variable before spawning Electron. Just use `npm start` and you're fine.

End users of the installed `.exe` are **not** affected — the variable is Claude-Code-specific.

### 2. `winCodeSign` extraction fails on `npm run build`

`electron-builder` downloads a 7z containing macOS `.dylib` symlinks, and `7za.exe` fails to create symlinks on Windows without Developer Mode. Two options:

**Option A — activate Windows Developer Mode** (cleanest, one-time):
*Settings → System → For developers → Developer Mode → On.*
No further workaround needed after that.

**Option B — use the wrapped `7za.exe`** (included in the repo's first build only):
If Developer Mode isn't an option, manually wrap `node_modules/7zip-bin/win/x64/7za.exe` to exclude `darwin/*` from extraction. A wrapper based on a small PyInstaller shim works — see `scripts/build-agent.js` for inspiration, or open an issue and we'll automate it.

---

## Build the installer

```bash
# prerequisites (one-time)
npm install
pip install pyinstaller

# build everything
npm run build
```

Artefacts:

| File | Purpose |
|---|---|
| `dist/AgentDockyard-Setup-x.y.z.exe` | NSIS installer |
| `dist/AgentDockyard-Portable-x.y.z.exe` | Portable, no install |
| `dist/AgentDockyard-Setup-x.y.z.exe.blockmap` | For delta updates |
| `dist/latest.yml` | Consumed by `electron-updater` on the end user's machine |

Publishing a release:

1. Bump `version` in [`package.json`](package.json), update [`CHANGELOG.md`](CHANGELOG.md).
2. `git commit -am "Feat(Release)/ v1.1.0"` then tag: `git tag v1.1.0 && git push --tags`.
3. The [`release.yml`](.github/workflows/release.yml) workflow picks up the tag, runs the full build on a Windows runner, and publishes the assets to a GitHub release.
4. When the SignPath secrets are configured (see [docs/signing.md](docs/signing.md)), the installers are code-signed automatically as part of the same workflow — no extra manual step.

---

## Code style

- **JavaScript** — match the existing style: 2-space indent, single quotes, no trailing semicolons inside object literals, short top-level comments when the *why* is non-obvious.
- **Python** — PEP 8, 4-space indent.
- **CSS** — use the CSS variables already defined in `style.css`. Do not hard-code colors; both themes depend on them.
- **Comments** — explain *why*, never *what*. Reserved for hidden constraints, workarounds tied to an external bug, or subtle invariants.
- **Commit messages** — short, imperative, scoped. Examples:
  - `Feat(Settings)/ Add max-tasks-per-group option`
  - `Fix(DevMode)/ Unset ELECTRON_RUN_AS_NODE before launching Electron`
  - `Docs(README)/ Clarify auto-update behaviour`

---

## Reporting bugs and proposing features

Please use the **Issues** tab and pick the right template:
- 🐛 **Bug report** — include your OS, AgentDockyard version, steps to reproduce
- ✨ **Feature request** — describe the problem first, then your proposed fix

For anything security-sensitive, see [SECURITY.md](SECURITY.md) — don't open a public issue.

---

## Pull requests

1. Fork → feature branch → commits → PR against `main`.
2. Small PRs are reviewed and merged faster than big ones. If you're tackling something large, open a draft PR early so we can steer it together.
3. Make sure `npm start` and `npm run build:agent` both work locally before submitting.
4. Update `CHANGELOG.md` under `## [Unreleased]`.

Thanks for contributing 🎉
