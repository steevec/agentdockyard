# Code signing via SignPath Foundation

AgentDockyard releases are code-signed through the **SignPath Foundation** free
OSS signing program. This document explains how the signing step works in the
release workflow and how to configure it after the initial SignPath validation.

## Why signing

Without code signing:
- Windows SmartScreen warns on first launch ("Windows protected your PC").
- **Windows 11 Smart App Control** (enabled by default on 22H2+) silently
  blocks the installer with no override button — the user literally cannot
  install the app.

With an EV-class signature (what SignPath Foundation issues):
- Smart App Control allows the installer without user interaction.
- SmartScreen reputation accumulates faster.
- The "Unknown publisher" label is replaced by the verified publisher name.

## How it fits in the release workflow

The workflow [.github/workflows/release.yml](../.github/workflows/release.yml)
runs **conditionally**: if no SignPath secret/variable is configured, the
signing steps are skipped and the release is published unsigned (same as
before). Once the secrets are in place, every tag push produces a signed
release automatically.

Pipeline when signing is enabled:

1. Build `agent.exe` (PyInstaller) and Electron installers (`electron-builder`).
2. Upload the unsigned `.exe` files as a GitHub Actions artifact.
3. Call `signpath/github-action-submit-signing-request@v2` → the action
   uploads the artifact to SignPath, which fetches it back, signs it, and
   makes the signed artifact available for download.
4. Download the signed `.exe` files, replace the unsigned ones in `dist/`.
5. Regenerate `dist/latest.yml` with the post-signing `sha512` hashes (the
   Authenticode signature changes the file content, so `electron-updater`
   would otherwise reject the new installer at download time — see
   [scripts/regen-latest-yml.js](../scripts/regen-latest-yml.js)).
6. Publish the GitHub Release with the signed artifacts.

## Configuration (one-time, after SignPath validation)

SignPath Foundation will email you once the project is approved. In the
resulting SignPath.io dashboard you'll find:

- **Organization ID** (UUID)
- **Project slug** (should be `agentdockyard` based on the application)
- **Signing policy slug** (typically `release-signing`)
- A **CI User API token** with submitter role

In the GitHub repository, go to **Settings → Secrets and variables → Actions**
and add:

### Repository secrets

| Name | Value |
|---|---|
| `SIGNPATH_API_TOKEN` | The CI User API token from SignPath |

### Repository variables

| Name | Value |
|---|---|
| `SIGNPATH_ORGANIZATION_ID` | The Organization UUID |
| `SIGNPATH_PROJECT_SLUG` | `agentdockyard` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` (or whatever SignPath configured) |

Once these four values are set, the next `git tag vX.Y.Z && git push origin vX.Y.Z`
will produce a signed release.

## Setting up the SignPath project artifact configuration

In the SignPath.io web UI, the project's **artifact configuration** must
describe the content of the ZIP that GitHub Actions uploads. The workflow
uploads both installers (Setup + Portable) under `unsigned-installers/`, so
the minimal config is:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="AgentDockyard-Setup-*.exe" />
    <pe-file path="AgentDockyard-Portable-*.exe" />
  </zip-file>
</artifact-configuration>
```

Ask SignPath support if they prefer you tighten the glob (e.g. pin to
`AgentDockyard-Setup-1.4.1.exe` per release).

## Troubleshooting

- **`electron-updater` fails with "sha512 mismatch" after signing**: means
  `scripts/regen-latest-yml.js` didn't run or didn't find the signed file.
  Check the workflow logs for the `Regenerate latest.yml` step.
- **SignPath action times out**: increase the SignPath policy's max-wait-time,
  or temporarily set `wait-for-completion: false` and add a follow-up
  `signpath/github-action-get-signed-artifact` step.
- **Smart App Control still blocks even signed installer**: a brand-new
  certificate takes a few days to build cloud reputation. Microsoft's
  telemetry needs to see successful installs globally before lifting the
  block entirely. Certum/SignPath's EV certs are pre-vouched, so this is
  usually not an issue, but it can happen for a day or two after first use.

## References

- [SignPath GitHub Actions documentation](https://docs.signpath.io/trusted-build-systems/github)
- [SignPath Foundation OSS program](https://signpath.io/solutions/open-source-community)
- [electron-updater provider spec](https://www.electron.build/auto-update)
