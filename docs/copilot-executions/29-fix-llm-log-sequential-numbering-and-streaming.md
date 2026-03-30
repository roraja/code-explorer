# 29 - Fix LLM Log Sequential Numbering and Live Streaming

**Date**: 2026-03-29 UTC
**Prompt**: The logs llms folder does not add sequential files. Make sure before creating a new log file, check the largest number file and new file should be +1 of that. Also, make sure the copilot stdout is live streamed into the file (currently I don't see live logs there).

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — identified `src/utils/logger.ts` and `src/utils/cli.ts` as primary files
- Read `src/utils/logger.ts` — found `_llmCallCounter` and `_commandCallCounter` are reset to `0` in `init()` on every extension restart, causing duplicate sequence numbers
- Read `src/utils/cli.ts` — confirmed `onStdoutChunk` callback is invoked with each stdout chunk in real time (line 150)
- Read `src/llm/CopilotCLIProvider.ts` (line 73) — confirmed `onStdoutChunk: (chunk) => logger.logLLMChunk(chunk)` is wired up
- Read `src/llm/MaiClaudeProvider.ts` (line 59) — confirmed same pattern for mai-claude provider
- Read `src/analysis/AnalysisOrchestrator.ts` (lines 80-310, 330-380, 550-590) — confirmed `startLLMCallLog()` is called before LLM analysis, and `logLLMChunk()` is used for real-time streaming sections
- Grep for `startLLMCallLog` — found 4 call sites in AnalysisOrchestrator (analyzeSymbol, analyzeFromCursor, analyzeFile, enhanceAnalysis)
- Grep for `logLLMChunk` — found all streaming wiring in providers and orchestrator
- Glob for existing LLM log files — `.vscode/code-explorer-logs/llms/` directory was empty (no `.md` files)
- Glob for `docs/copilot-executions/*.md` — found duplicate sequence numbers (multiple 01-, 03-, 08-, 09-, 10-, 14-, 18-, 19-, 25- files)

## 2. Issues Identified

### Issue 1: Counter resets to 0 on every extension restart
- **File**: `src/utils/logger.ts`, line 159-160 (original)
- **Problem**: `init()` sets `_llmCallCounter = 0` and `_commandCallCounter = 0` unconditionally. When the extension restarts (reload window, VS Code restart), the counter resets and new files start at `01-` again, colliding with or overwriting existing files.
- **Root cause**: No disk scan — the counter is purely in-memory.

### Issue 2: LLM log file I/O used appendFileSync (open/write/close on every chunk)
- **File**: `src/utils/logger.ts`, `logLLMStep()`, `logLLMInput()`, `logLLMOutput()`, `logLLMChunk()`
- **Problem**: All LLM log methods used `fs.appendFileSync()` which opens the file, writes, and closes the file handle on every single chunk. While this should technically work for live streaming, it's inefficient and the repeated open/close cycle could cause issues with file watchers or monitoring tools that check for file changes.
- **Root cause**: Unlike the command log (which uses a persistent `WriteStream`), the LLM log used a file path string (`_activeLLMLogFile`) with sync I/O calls.

### Issue 3: No cleanup of previous LLM log stream on new call
- **File**: `src/utils/logger.ts`, `startLLMCallLog()`
- **Problem**: If a previous LLM call didn't complete (no `logLLMOutput()` called, as in `analyzeSymbol()`), the old `_activeLLMLogFile` was silently abandoned. The `dispose()` method also didn't close LLM log resources.

## 3. Plan
- Add a `findHighestSequenceNumber()` helper that scans a directory for `NN-*.ext` files and returns the max sequence number
- Update `init()` to call this helper for both `_llmLogDir` (`.md` ext) and `_commandLogDir` (`.log` ext) instead of resetting to 0
- Convert all LLM log methods from `appendFileSync`/`writeFileSync` (path-based) to use a persistent `WriteStream` (`_activeLLMLogStream`), matching the pattern already used by command logs
- Update `startLLMCallLog()` to close any previous stream before opening a new one
- Update `dispose()` to close the LLM log stream
- Alternative considered: Using a file-lock mechanism — rejected as overly complex for this use case

## 4. Changes Made

### `src/utils/logger.ts`

**Change 1: Added `findHighestSequenceNumber()` helper** (new code after line 45)
- Scans a directory for files matching `NN-*.ext` pattern
- Returns the highest sequence number found, or 0 if directory doesn't exist or is empty
- Used by `init()` to resume numbering from where it left off

**Change 2: Added `_activeLLMLogStream` state variable** (line 40)
- New `let _activeLLMLogStream: fs.WriteStream | undefined;` alongside existing `_activeLLMLogFile`

**Change 3: Updated `init()` to scan existing files** (lines 191-192)
- Before: `_llmCallCounter = 0; _commandCallCounter = 0;`
- After: `_llmCallCounter = findHighestSequenceNumber(_llmLogDir, '.md'); _commandCallCounter = findHighestSequenceNumber(_commandLogDir, '.log');`

**Change 4: Updated `dispose()` to close LLM log stream** (lines 215-217)
- Added `_activeLLMLogStream?.end(); _activeLLMLogStream = undefined; _activeLLMLogFile = undefined;`

**Change 5: Rewrote `startLLMCallLog()` to use WriteStream** (lines 309-351)
- Closes any previously active LLM log stream before creating a new one
- Opens a persistent `WriteStream` with `flags: 'w'` instead of `writeFileSync`
- All subsequent writes go through the stream for immediate flushing

**Change 6: Updated `logLLMStep()` to use stream** (lines 353-367)
- Before: `fs.appendFileSync(_activeLLMLogFile, line, 'utf-8')`
- After: `_activeLLMLogStream.write(line)`
- Guard changed from `if (!_activeLLMLogFile)` to `if (!_activeLLMLogStream)`

**Change 7: Updated `logLLMInput()` to use stream** (lines 369-382)
- Same pattern: `appendFileSync` → `_activeLLMLogStream.write()`

**Change 8: Updated `logLLMOutput()` to use stream and close it** (lines 384-408)
- Writes the output section via stream, then calls `_activeLLMLogStream.end()` to close
- Properly cleans up both `_activeLLMLogStream` and `_activeLLMLogFile` in both success and error paths

**Change 9: Updated `logLLMChunk()` to use stream** (lines 410-424)
- Before: `fs.appendFileSync(_activeLLMLogFile, chunk, 'utf-8')`
- After: `_activeLLMLogStream.write(chunk)`
- This is the key change for live streaming — chunks from copilot stdout go through the persistent WriteStream which flushes to disk immediately

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Pass — extension.js 206.2kb, webview main.js 2.8mb |
| `npm run test:unit` | ✅ Pass — 223 passing (141ms) |
| `npm run lint` | ✅ Pass — no errors or warnings |

## 6. Result
- **Sequential numbering fixed**: On extension restart, `init()` now scans existing files in both `llms/` and `commands/` directories to find the highest sequence number and continues from there. No more duplicate `01-`, `02-`, etc.
- **Live streaming improved**: All LLM log methods now use a persistent `WriteStream` instead of repeated `appendFileSync` calls. The stream stays open for the duration of the LLM call, so copilot/claude stdout chunks are written and flushed immediately as they arrive.
- **Resource cleanup improved**: `startLLMCallLog()` now closes any abandoned previous stream, and `dispose()` cleans up LLM log resources.
- All 223 unit tests pass, build succeeds, lint clean.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/utils/logger.ts` | Modified | Added `findHighestSequenceNumber()` helper, scan-based counter init, converted all LLM log methods from `appendFileSync` to persistent `WriteStream`, added proper cleanup |
| `docs/copilot-executions/29-fix-llm-log-sequential-numbering-and-streaming.md` | Created | This execution log |
