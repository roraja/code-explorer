# 14 - Fix ADO Pull Unrelated Histories Error

**Date**: 2026-03-29 08:35 UTC
**Prompt**: Why did pull-ado-content fail with "refusing to merge unrelated histories"? The .vscode/code-explorer folder didn't exist. It should have cloned, not merged.

## 1. Code Reading & Analysis
- Read `src/git/AdoSync.ts` (lines 1-234) — the full ADO sync module containing `pullAdoContent()` and `pushAdoContent()`
- Read `docs/copilot-executions/11-add-ado-pull-push-commands.md` — the original implementation log showing the design intent: "create .vscode/code-explorer folder by cloning origin and branch"
- Ran `git remote -v` — confirmed only `origin` (GitHub) exists; `ado` remote was not present (likely removed after the failed attempt)
- Ran `git log --oneline -5` — confirmed the local repo is on `master` with GitHub-only history
- Ran `git branch` — only `master` branch exists locally
- Checked `.vscode/code-explorer/` — only contains a `logs/` subdirectory, no content from ADO

## 2. Issues Identified

### Issue 1: `pullAdoContent()` uses `git merge` — fundamentally wrong (line 132-134)
- **File**: `src/git/AdoSync.ts`, lines 132-134
- **Problem**: `git merge ado/user/roraja/code-explorer/content --no-edit` tries to merge the ADO branch into the local `master` branch. These branches have **completely unrelated git histories** (different repos: GitHub vs ADO `edgeinternal.ai`), so git refuses with `fatal: refusing to merge unrelated histories`.
- **Root cause**: The original implementation treated the ADO branch as if it shared history with the local repo. But the ADO repo (`edgeinternal.ai`) and the local repo (`code-explorer` on GitHub) are entirely separate repos — no common ancestor exists.
- Even with `--allow-unrelated-histories`, a merge would dump the ADO files at the repo root, not into `.vscode/code-explorer/`.

### Issue 2: `pushAdoContent()` pushes `HEAD` — pushes wrong content (line 199)
- **File**: `src/git/AdoSync.ts`, line 199
- **Problem**: `git push ado HEAD:refs/heads/user/roraja/code-explorer/content` pushes the local `master` branch's HEAD to the ADO branch. This would overwrite the ADO branch with the entire local repo content, not just `.vscode/code-explorer/`.

## 3. Plan

### Pull strategy
Replace `git merge` with `git --work-tree=<targetDir> checkout <ref> -- .` which extracts files from the fetched remote branch directly into `.vscode/code-explorer/` without merging histories. Then `git reset HEAD -- .` to clean up the index so the checkout doesn't leave files staged at the repo root.

### Push strategy
Replace `git push HEAD` with git plumbing commands:
1. Use a temporary `GIT_INDEX_FILE` + `GIT_WORK_TREE` pointing at `.vscode/code-explorer/` to build a tree object from the content directory
2. Use `git write-tree` to create the tree
3. Use `git commit-tree` with the ADO branch tip as parent to create a commit
4. Push that commit hash (not HEAD) to the ADO branch

This keeps the ADO branch's history clean and independent from the local repo.

### Alternative considered
- `git subtree`: More complex, requires subtree tracking, and still has merge semantics. Rejected.
- `--allow-unrelated-histories`: Would merge ADO content into repo root, not the target subdirectory. Rejected.
- `git archive | tar -x`: Would work for pull but doesn't integrate with git tracking. Rejected.

## 4. Changes Made

### `src/git/AdoSync.ts`

#### Added `_runGitEnv()` helper (new, after line 62)
- New function that wraps `spawn('git', ...)` like `_runGit()` but accepts an `envOverrides` parameter merged into `process.env`
- Needed for `pushAdoContent()` to set `GIT_INDEX_FILE` and `GIT_WORK_TREE` for plumbing commands

#### Added `ADO_CONTENT_DIR` constant (new, after line 92)
- `const ADO_CONTENT_DIR = '.vscode/code-explorer'` — target directory for content

#### Rewrote `pullAdoContent()` (was lines 100-166, now lines 144-233)
- **Before**: Fetch + `git merge ado/user/roraja/code-explorer/content --no-edit`
- **After**:
  1. Ensure remote exists
  2. Fetch the ADO branch
  3. `mkdirSync(targetDir, { recursive: true })` — ensure `.vscode/code-explorer/` exists
  4. `git --work-tree=<targetDir> checkout <ref> -- .` — extract files into target dir
  5. `git reset HEAD -- .` — unstage the files from the repo-root index

#### Rewrote `pushAdoContent()` (was lines 174-233, now lines 249-410)
- **Before**: Call `pullAdoContent()` then `git push ado HEAD:refs/heads/...`
- **After**:
  1. Check content directory exists
  2. Ensure remote + fetch latest from ADO
  3. `git add -A` with `GIT_INDEX_FILE=.git/ado-push-index` + `GIT_WORK_TREE=<contentDir>`
  4. `git write-tree` with same env overrides → tree hash
  5. Clean up temp index file
  6. `git rev-parse ado/user/roraja/code-explorer/content` → parent commit
  7. `git commit-tree <tree> -p <parent> -m "chore: sync ..."` → commit hash
  8. `git push ado <commitHash>:refs/heads/user/roraja/code-explorer/content`

## 5. Commands Run
- `npm run build` — **PASS** (extension: 152.0kb/20ms, webview: 2.7mb/289ms)
- `npm run lint` — **PASS** (no errors)
- `npm run test:unit` — **PASS** (139 passing, 97ms)

## 6. Result
The `pullAdoContent()` function now correctly extracts ADO branch content into `.vscode/code-explorer/` using `git checkout` with `--work-tree` instead of merging. This eliminates the "refusing to merge unrelated histories" error entirely.

The `pushAdoContent()` function now correctly builds a standalone commit from `.vscode/code-explorer/` contents using git plumbing commands and pushes only that commit to the ADO branch, without affecting the local repo's HEAD.

Both functions are now completely decoupled from the local repo's branch history — they operate on the ADO branch as an independent content store.

**To test**: Run the "Pull ADO Content" command from the VS Code Command Palette. It should fetch the ADO branch and place files into `.vscode/code-explorer/` without any merge conflicts.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/git/AdoSync.ts` | Modified | Replaced merge-based pull with checkout-based extraction; replaced HEAD push with plumbing-based commit+push; added `_runGitEnv()` helper and `ADO_CONTENT_DIR` constant |
