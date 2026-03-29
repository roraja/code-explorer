# src/git/

ADO (Azure DevOps) content sync — manages syncing the `.vscode/code-explorer` content folder with an ADO git repository.

## Modules

| File | Role |
|------|------|
| `AdoSync.ts` | `pullAdoContent()` and `pushAdoContent()` functions for syncing cache content with ADO |

## How It Works

The module syncs the `.vscode/code-explorer/` directory (analysis cache) to/from an Azure DevOps git repository, enabling shared analysis results across machines or team members.

### Configuration

| Constant | Value |
|----------|-------|
| Remote URL | `https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai` |
| Remote name | `ado` |
| Branch | `user/roraja/code-explorer/content` |

### `pullAdoContent(workspaceRoot)`

1. Ensures the `ado` remote exists (adds it if missing)
2. Fetches the latest from the ADO remote
3. Checks out the content branch
4. Copies content into `.vscode/code-explorer/`

Returns `AdoSyncResult` with success/failure, message, and detailed git command output.

### `pushAdoContent(workspaceRoot)`

1. Pulls latest changes first (to avoid conflicts)
2. Stages all changes in `.vscode/code-explorer/`
3. Commits with a descriptive message
4. Pushes to the ADO remote branch

Returns `AdoSyncResult`.

### Git Command Execution

Uses `child_process.spawn()` directly (not `runCLI()`) since git commands are simple and don't need stdin piping.

## VS Code Integration

Registered as two commands in `extension.ts`:
- `codeExplorer.pullAdoContent` — "Code Explorer: Pull ADO Content"
- `codeExplorer.pushAdoContent` — "Code Explorer: Push ADO Content" (with confirmation dialog)

Both show progress notifications during execution.

## Exported Types

- `AdoSyncResult` — `{ success: boolean, message: string, details: string }`
