# src/git/

ADO (Azure DevOps) content sync — manages syncing the `.vscode/code-explorer` cache folder with an ADO git repository. Two branches share the same cloned directory.

## Modules

| File | Role |
|------|------|
| `AdoSync.ts` | `pullAdoContent()`, `pushAdoContent()`, `pullAdoUpstream()`, `pushAdoUpstream()` functions for syncing cache content with ADO on two branches |

## How It Works

The `.vscode/code-explorer/` directory IS the ADO git repo — it's a full clone with `origin` pointing to the ADO URL. This means the user can also `cd` into it and run manual git commands.

### Configuration

| Constant | Value |
|----------|-------|
| Remote URL | `https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai` |
| Content Branch | `user/roraja/code-explorer/content` |
| Upstream Branch | `user/roraja/code-explorer/upstream` |

Both branches share the same `.vscode/code-explorer/` directory. Pull/push commands switch to the correct branch automatically.

### Sync Targets

| Target | Branch | Label | Directory |
|--------|--------|-------|-----------|
| `CONTENT_TARGET` | `user/roraja/code-explorer/content` | `ADO Content` | `.vscode/code-explorer` |
| `UPSTREAM_TARGET` | `user/roraja/code-explorer/upstream` | `ADO Upstream` | `.vscode/code-explorer` |

### `_pull(target, workspaceRoot)` — Generic Pull

Handles three scenarios:
1. **No `.git`**: `git clone --branch <branch> <url> <dir>`
2. **Exists, correct branch**: `git pull --ff-only`
3. **Exists, different branch**: `git fetch origin` → `git checkout <target>` (or create from remote) → `git pull --ff-only`

### `_push(target, workspaceRoot)` — Generic Push

Requires the directory to already be a cloned git repo (run Pull first).

1. Ensure correct branch (switch if needed)
2. `git pull --ff-only` — sync with remote
3. `git add -A` — stage all changes
4. `git commit -m "chore: sync ..."` — commit (no-op if nothing changed)
5. `git push` — push to origin

### Git Command Execution

Uses `child_process.spawn()` with `shell: true` on Windows for `.cmd`/`.bat` compatibility.

## Public API

| Function | Description |
|----------|-------------|
| `pullAdoContent(workspaceRoot)` | Pull content branch |
| `pushAdoContent(workspaceRoot)` | Push content branch |
| `pullAdoUpstream(workspaceRoot)` | Pull upstream branch |
| `pushAdoUpstream(workspaceRoot)` | Push upstream branch |

## VS Code Integration

Registered as four commands in `extension.ts`:
- `codeExplorer.pullAdoContent` — "Code Explorer: Pull ADO Content"
- `codeExplorer.pushAdoContent` — "Code Explorer: Push ADO Content" (with confirmation dialog)
- `codeExplorer.pullAdoUpstream` — "Code Explorer: Pull ADO Upstream"
- `codeExplorer.pushAdoUpstream` — "Code Explorer: Push ADO Upstream" (with confirmation dialog)

All show progress notifications during execution.

## Exported Types

- `AdoSyncResult` — `{ success: boolean, message: string, details: string }`
