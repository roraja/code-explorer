# 12 - Move Logs to code-explorer-logs Folder + Per-Command Log Files

**Date**: 2026-03-29 00:00 UTC
**Prompt**: "Ensure logs are not written to .vscode/code-explorer/logs but to .vscode/code-explorer-logs folder. Also, create a separate .log file for each command execution which is sequentially prefixed like 01-symbol-search-readText.log, 02-git-ado-pull.log"

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — identified logger module routing to `src/utils/logger.ts`
- Grepped for `code-explorer/logs` and `code-explorer.*logs` across the entire repo — found references in 6 files
- Read `src/utils/logger.ts` — the actual logging implementation (line 147: path construction using `CACHE.DIR_NAME`)
- Read `src/models/constants.ts` — confirmed `CACHE.DIR_NAME = 'code-explorer'` (cache path, must not change)
- Read `src/extension.ts` — all 8 command handlers that need per-command logging
- Read `.gitignore` — existing `.vscode/code-explorer/` entry (line 22)
- Read `src/utils/CONTEXT.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.context/FLOORPLAN.md` — documentation references
- Checked `test/` for logger-related tests — none found

## 2. Issues Identified
- **`src/utils/logger.ts` line 147**: Log directory constructed as `.vscode/code-explorer/logs/` — should be `.vscode/code-explorer-logs/`
- **No per-command log files**: All command output went to a single daily log, making it hard to trace individual command executions
- **`.gitignore`**: Missing entry for new `.vscode/code-explorer-logs/` directory
- **5 documentation files**: All referenced old `.vscode/code-explorer/logs/` path

## 3. Plan
1. Change log path from `.vscode/code-explorer/logs` to `.vscode/code-explorer-logs`
2. Remove unused `CACHE` import from `logger.ts`
3. Add per-command log file support: `startCommandLog(label)` / `endCommandLog()` API
4. Wire all 8 commands in `extension.ts` with try/finally to ensure logs are closed
5. Update `.gitignore` and all documentation

## 4. Changes Made

### `src/utils/logger.ts`
- **Line 6**: Comment updated `.vscode/code-explorer/logs/<date>.log` → `.vscode/code-explorer-logs/<date>.log`
- **Line 14**: Import changed `{ EXTENSION_DISPLAY_NAME, CACHE }` → `{ EXTENSION_DISPLAY_NAME }`
- **Lines 37-42**: Added new state variables: `_commandCallCounter`, `_commandLogDir`, `_activeCommandLogStream`, `_activeCommandLogFile`
- **Line 121-139 (`emit`)**: Added third output destination — writes to active command log stream if one is open
- **Line 147**: Path changed to `path.join(workspaceRoot, '.vscode', 'code-explorer-logs')`
- **Line 148**: Added `_commandLogDir` initialization
- **Line 149**: Added `_commandCallCounter` reset
- **Lines 173-178 (`dispose`)**: Added cleanup for command log stream
- **New `startCommandLog(label)` method**: Creates sequentially-numbered `.log` file in `commands/` subdir with a header
- **New `endCommandLog()` method**: Writes footer and closes the command log stream

### `src/extension.ts`
- All 8 command handlers wrapped with `logger.startCommandLog('label')` + try/finally `logger.endCommandLog()`:
  - `explore-symbol`, `refresh-analysis`, `clear-cache`, `analyze-workspace`
  - `install-global-skills`, `explore-file-symbols`, `pull-ado-content`, `push-ado-content`

### `.gitignore`
- Added `.vscode/code-explorer-logs/` entry

### Documentation
- `CLAUDE.md`: Updated logger description path
- `src/utils/CONTEXT.md`: Updated output destinations (added 4th: per-command logs), added "Per-Command Logging" section
- `.context/FLOORPLAN.md`: Updated troubleshooting table path
- `.github/copilot-instructions.md`: Updated gotchas section paths

## 5. Commands Run
- `npm run build` — ✅ Passed (extension 146.7kb, webview 2.7mb)
- `npm run lint` — ✅ Passed (no issues)
- `npm run test:unit` — ✅ Passed (127 passing)

## 6. Result
1. All logs now written to `.vscode/code-explorer-logs/` (daily logs, LLM call logs, command logs)
2. Cache files remain unchanged at `.vscode/code-explorer/`
3. Each command execution creates a separate sequential `.log` file in `.vscode/code-explorer-logs/commands/`
   - e.g., `01-explore-symbol.log`, `02-clear-cache.log`, `03-pull-ado-content.log`
4. All logger output during a command (debug/info/warn/error) is captured in the per-command log file in addition to the daily log
5. Build, lint, and all 127 tests pass

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/utils/logger.ts` | Modified | Changed log dir to `.vscode/code-explorer-logs`, added `startCommandLog`/`endCommandLog` API |
| `src/extension.ts` | Modified | Wrapped all 8 commands with per-command logging (try/finally) |
| `.gitignore` | Modified | Added `.vscode/code-explorer-logs/` entry |
| `CLAUDE.md` | Modified | Updated log path reference |
| `src/utils/CONTEXT.md` | Modified | Updated log paths, added per-command logging docs |
| `.context/FLOORPLAN.md` | Modified | Updated log path in troubleshooting table |
| `.github/copilot-instructions.md` | Modified | Updated log path references |
| `docs/copilot-executions/12-move-logs-to-code-explorer-logs-folder.md` | Created | This execution log |
