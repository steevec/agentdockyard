# Release review task

You are reviewing a published release of AgentDockyard from the repository state checked out at the release tag.

Read at least these files when they exist:
- `.github/codex/context/release-context.md`
- `README.md`
- `CHANGELOG.md`
- `package.json`
- `.github/workflows/release.yml`
- Any packaging/build config that is clearly used for the desktop app or installer

Your goal is to catch release-quality problems that matter for a shipped Windows build.

Focus on:
1. Version consistency between the Git tag, `package.json`, changelog, and docs.
2. Windows distribution expectations versus the actual release workflow.
3. Installer / portable / auto-update coherence.
4. Broken references, missing release notes links, or packaging pitfalls visible from repository files.
5. Obvious security, reliability, or end-user-impacting issues that are relevant to a shipped release.

Rules:
- Stay grounded in repository files only.
- Do not claim that you ran tests unless you can verify that from files or workflow definitions.
- Do not invent missing context.
- Prefer concrete file paths and precise wording.
- Do not modify files.

Return markdown with exactly these sections:

## Verdict
Start the first sentence with exactly one of these labels: `PASS`, `PASS WITH WARNINGS`, or `BLOCKED`.

## Problems to fix before next release
Use bullets. Write `- None.` if nothing serious is found.

## Warnings / follow-up
Use bullets. Write `- None.` if there is nothing notable.

## Checks performed
List the concrete checks you performed.
