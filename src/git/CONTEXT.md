# src/git/

ADO (Azure DevOps) content sync — manages syncing the `.vscode/code-explorer` cache folder with an ADO git repository by treating the cache directory as its own cloned git repo.

## Modules

| File | Role |
|------|------|
| `AdoSync.ts` | `pullAdoContent()` and `pushAdoContent()` functions for syncing cache content with ADO |

## How It Works

The `.vscode/code-explorer/` directory IS the ADO git repo — it's a full clone with `origin` pointing to the ADO URL. This means the user can also `cd` into it and run manual git commands.

### Configuration

| Constant | Value |
|----------|-------|
| Remote URL | `https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai` |
| Branch | `user/roraja/code-explorer/content` |

### `pullAdoContent(workspaceRoot)`

- **First time** (no `.vscode/code-explorer/.git`): Runs `git clone --branch <branch> --single-branch <url> <dir>`
- **Subsequent times**: Runs `git pull --ff-only` inside the existing repo

Returns `AdoSyncResult` with success/failure, message, and detailed git command output.

### `pushAdoContent(workspaceRoot)`

Requires the directory to already be a cloned git repo (run Pull first).

1. `git pull --ff-only` — sync with remote
2. `git add -A` — stage all changes (new, modified, deleted files)
3. `git commit -m "chore: sync ..."` — commit (no-op if nothing changed)
4. `git push` — push to origin

Returns `AdoSyncResult`.

### Git Command Execution

Uses `child_process.spawn()` with `shell: true` on Windows for `.cmd`/`.bat` compatibility.

## VS Code Integration

Registered as two commands in `extension.ts`:
- `codeExplorer.pullAdoContent` — "Code Explorer: Pull ADO Content"
- `codeExplorer.pushAdoContent` — "Code Explorer: Push ADO Content" (with confirmation dialog)

Both show progress notifications during execution.

## Exported Types

- `AdoSyncResult` — `{ success: boolean, message: string, details: string }`
