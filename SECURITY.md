# Security Policy

## Scope

AgentDockyard runs entirely locally:

- It does not collect, transmit, or share any of your task data.
- It reads/writes only in `%APPDATA%\AgentDockyard\` (`tasks.db`, `config.json`, and exports you trigger manually).
- It contacts the network only to check for updates on GitHub Releases.

Because everything runs on your own machine, the realistic attack surface is limited to:

1. **Integrity of the installer / executables** distributed via GitHub Releases.
2. **Handling of untrusted input** passed to `agent.exe` / `agent.py` by AI agents you wire up.
3. **Electron renderer / preload boundary** (standard Electron security concerns).

## Supported versions

Only the latest release receives security fixes. Please update before reporting.

| Version | Supported |
|---|---|
| Latest on `main` | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security bugs.**

Email: [steeve.cordier@gmail.com](mailto:steeve.cordier@gmail.com) with:

- A clear description of the issue and its impact.
- Steps to reproduce (or a proof-of-concept).
- Your environment (OS, AgentDockyard version).

You can expect an initial reply within a few working days. Please allow a reasonable window for a fix to be developed and released before any public disclosure.

## Verifying a release

Every GitHub release lists its `sha512` in `latest.yml`. You can compare it against your downloaded installer:

```powershell
Get-FileHash -Algorithm SHA512 AgentDockyard-Setup-1.0.0.exe
```

If the hashes don't match, do not run the installer — open a private report via the email above.

## Out of scope

- Issues that require an attacker with pre-existing administrative access to your machine.
- Warnings from Windows SmartScreen on unsigned builds — signing is on the roadmap but not a vulnerability.

Thanks for helping keep AgentDockyard safe.
