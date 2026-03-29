# 11 - Add ADO Pull/Push Content Commands

**Date**: 2026-03-29 00:00 UTC
**Prompt**: Add a vscode extension command "Pull ADO content" which will create .vscode/code-explorer folder by cloning origin and branch as mentioned in /workspace/edge/src/.vscode/code-explorer/.vscode/commands/git/00-ado.sh. If already cloned, pull the latest changes from origin. Similarly add a "Push ADO content" command which first pulls and then pushes the changes to ado.

## 1. Code Reading & Analysis
- Read `/workspace/edge/src/.vscode/code-explorer/.vscode/commands/git/00-ado.sh` — the reference shell script containing the ADO remote URL (`https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai`), remote name (`ado`), branch (`user/roraja/code-explorer/content`), and the `Git.Ado.Pull()` / `Git.Ado.Push()` / `Git.Ado.EnsureRemote()` functions
- Read `src/extension.ts` (lines 1-309) — existing command registrations, DI wiring, import patterns
- Read `src/models/constants.ts` (lines 1-94) — existing `COMMANDS` object where new command IDs need to be added
- Read `package.json` (lines 1-257) — existing command contributions, activation events, keybindings
- Read `src/utils/cli.ts` (lines 1-161) — existing CLI runner pattern using `child_process.spawn` for reference
- Read `src/models/errors.ts` (lines 1-161) — error hierarchy for reference
- Read `.context/FLOORPLAN.md` — overall architecture routing table

## 2. Issues Identified
- No existing git/ADO sync module exists in the extension
- The shell script uses `git checkout dev` to switch branches before merge; for the extension command, we don't force a branch switch — the user's current branch is used (safer for a VS Code command that may be invoked from any branch)
- The shell script's `Git.Ado.Push()` does not pull first, but the user's request explicitly states "Push ADO Content" should pull first, then push

## 3. Plan
- **New file**: `src/git/AdoSync.ts` — contains `pullAdoContent()` and `pushAdoContent()` functions, plus helper `_runGit()` and `_ensureRemote()`
- **Modify** `src/models/constants.ts` — add `PULL_ADO_CONTENT` and `PUSH_ADO_CONTENT` to the `COMMANDS` object
- **Modify** `src/extension.ts` — import AdoSync functions, register two new commands with progress notifications
- **Modify** `package.json` — add command contributions, activation events, and icons for the two new commands
- Alternative considered: Reusing `runCLI()` from `src/utils/cli.ts` — rejected because `runCLI()` is designed for stdin piping + timeout patterns for LLM processes, not simple git commands. A lighter `_runGit()` helper is more appropriate.

## 4. Changes Made

### `src/models/constants.ts`
- Added `PULL_ADO_CONTENT: 'codeExplorer.pullAdoContent'` and `PUSH_ADO_CONTENT: 'codeExplorer.pushAdoContent'` to the `COMMANDS` object

### `src/git/AdoSync.ts` (NEW)
- Created new module with:
  - Constants: `ADO_REMOTE_URL`, `ADO_REMOTE_NAME`, `ADO_BRANCH` (matching the shell script)
  - `AdoSyncResult` interface with `success`, `message`, `details`
  - `_runGit(args, cwd)` — spawns `git` with given args, returns `{ code, stdout, stderr }`
  - `_ensureRemote(cwd)` — checks if `ado` remote exists, adds it if missing, configures credential.helper
  - `pullAdoContent(workspaceRoot)` — ensures remote, fetches ADO branch, merges into current branch
  - `pushAdoContent(workspaceRoot)` — calls `pullAdoContent` first, then pushes `HEAD:refs/heads/user/roraja/code-explorer/content`

### `src/extension.ts`
- Added import: `import { pullAdoContent, pushAdoContent } from './git/AdoSync';`
- Registered `COMMANDS.PULL_ADO_CONTENT` — shows progress notification, calls `pullAdoContent()`, shows success/error message
- Registered `COMMANDS.PUSH_ADO_CONTENT` — shows confirmation dialog first, then progress notification, calls `pushAdoContent()`, shows success/error message

### `package.json`
- Added activation events: `onCommand:codeExplorer.pullAdoContent`, `onCommand:codeExplorer.pushAdoContent`
- Added command contributions with titles "Pull ADO Content" and "Push ADO Content" (category: "Code Explorer"), with `$(cloud-download)` and `$(cloud-upload)` icons

## 5. Commands Run
- `npm run build:extension` — **PASS** (145.4kb, 19ms)
- `npm run lint` — **PASS** (no errors)
- `npm run test:unit` — **PASS** (127 passing, 74ms)

## 6. Result
Two new VS Code commands are available in the Command Palette:
- **Code Explorer: Pull ADO Content** — Ensures the `ado` remote exists, fetches `user/roraja/code-explorer/content` branch, and merges it into the current branch. Shows progress notification during operation.
- **Code Explorer: Push ADO Content** — Shows a confirmation dialog, pulls first (fetch + merge), then pushes `HEAD` to `ado:refs/heads/user/roraja/code-explorer/content`. Shows progress notification during operation.

Both commands follow the same git operations as the reference shell script (`00-ado.sh`) but run natively in Node.js via `child_process.spawn`.

No remaining issues. All existing tests pass. No follow-up needed.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/constants.ts` | Modified | Added `PULL_ADO_CONTENT` and `PUSH_ADO_CONTENT` command IDs |
| `src/git/AdoSync.ts` | Created | New module: ADO git sync with pull/push functions |
| `src/extension.ts` | Modified | Imported AdoSync, registered two new commands with progress UI |
| `package.json` | Modified | Added command contributions and activation events for ADO commands |
