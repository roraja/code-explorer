# 35 - Rewrite ADO Sync to Clone-Based Model

**Date**: 2026-03-30 UTC
**Prompt**: "The ado pull command should clone the repo of code-explorer cache and have ado set up as the origin and it should be a git repo so I can push changes. The push command should first pull, commit changes and push to remote. Trigger release once done."

## 1. Code Reading & Analysis

- **`src/git/AdoSync.ts`** — Read full file (398 lines). Found the existing implementation uses complex git plumbing:
  - Pull: adds `ado` remote to workspace repo, fetches, uses `--work-tree` checkout to overlay files, resets index
  - Push: uses temp GIT_INDEX_FILE, `write-tree`, `commit-tree`, manual ref push
  - This creates commits in the workspace repo's object store but on a disconnected branch — not a proper git repo in `.vscode/code-explorer/`
- **`src/git/CONTEXT.md`** — Read for documentation context
- **`src/extension.ts` lines 390-457** — Read to understand how pullAdoContent/pushAdoContent are called (no changes needed — same function signatures)
- **`.gitignore`** — Verified `.vscode/code-explorer/` is gitignored (important — the cloned ADO repo inside it won't conflict with the workspace repo)

## 2. Issues Identified

### Issue 1: Not a standalone git repo
- **Problem**: The old implementation treated `.vscode/code-explorer/` as just a directory of files, using git plumbing to fabricate commits in the workspace repo. Users couldn't `cd .vscode/code-explorer && git log` or manually manage the repo.
- **Impact**: No git history browsable in the cache dir, can't manually push/pull, complex error-prone plumbing code.

### Issue 2: Push used git plumbing instead of standard workflow
- **Problem**: Push used `write-tree` + `commit-tree` + manual ref push instead of simple `git add -A && git commit && git push`.
- **Impact**: ~100 lines of complex, fragile code.

### Issue 3: Remote named "ado" instead of "origin"
- **Problem**: The old code added an `ado` remote to the workspace repo. User expected `origin` to point to ADO.
- **Impact**: Couldn't use standard `git push` / `git pull` without specifying the remote name.

## 3. Plan

Complete rewrite of `AdoSync.ts`:
1. **Pull**: `git clone` on first run (creates `.vscode/code-explorer/` as a proper repo with `origin` = ADO). On subsequent runs, `git pull --ff-only`.
2. **Push**: `git pull --ff-only` → `git add -A` → `git commit -m "..."` → `git push`. Handle "nothing to commit" gracefully.
3. Remove all plumbing code (`_runGitEnv`, `_ensureRemote`, temp index, `write-tree`, `commit-tree`).
4. Update CONTEXT.md.

## 4. Changes Made

### `src/git/AdoSync.ts` — Complete rewrite (72% changed)

**Before** (398 lines):
- `_runGit()` — spawn helper ✅ (kept)
- `_runGitEnv()` — spawn with env overrides ❌ (removed)
- `_ensureRemote()` — adds `ado` remote to workspace repo ❌ (removed)
- `pullAdoContent()` — fetch + `--work-tree` checkout + index reset ❌ (rewritten)
- `pushAdoContent()` — temp index + `write-tree` + `commit-tree` + manual push ❌ (rewritten)

**After** (260 lines):
- `_runGit()` — spawn helper (kept, unchanged)
- `_isGitRepo()` — checks for `.git` dir (new)
- `pullAdoContent()`:
  - Not a repo → `git clone --branch <branch> --single-branch <url> <dir>`
  - Already a repo → `git pull --ff-only`
- `pushAdoContent()`:
  1. Checks `.git` exists (error if not — "Run Pull first")
  2. `git pull --ff-only` (warning on failure, not fatal)
  3. `git add -A`
  4. `git commit -m "chore: sync ..."` (handles "nothing to commit" as success)
  5. `git push`

### `src/git/CONTEXT.md` — Updated documentation

Rewrote to describe the new clone-based model, removed references to `ado` remote name, temp indexes, and plumbing commands.

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ extension.js 226.2kb |
| `npm run lint` | ✅ clean |
| `npm run test:unit` | ✅ 248 passing (402ms) |
| `git push origin master` | ✅ pushed to trigger release |

## 6. Result

- ADO pull now clones the repo with `origin` = ADO URL — standard git repo
- ADO push now uses standard `pull → add → commit → push` workflow
- ~100 lines of git plumbing code removed
- Code reduced from 398 to ~260 lines
- Users can `cd .vscode/code-explorer && git log` to see history
- All 248 tests pass, lint clean

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/git/AdoSync.ts` | Rewritten | Clone-based pull, standard git push workflow, removed plumbing |
| `src/git/CONTEXT.md` | Modified | Updated docs for new clone-based model |
| `docs/copilot-executions/34-*.md` | Created | Execution log for Windows compatibility fixes |
