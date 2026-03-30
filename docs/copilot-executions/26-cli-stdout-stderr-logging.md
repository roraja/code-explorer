# 26 - CLI stdout/stderr Real-time Logging

**Date**: 2026-03-29 00:00 UTC
**Prompt**: "When triggering copilot cli for any reason, make sure its stdout/stderr is logged. Its hard to know if copilot is stuck anywhere, make it easy to see what exactly copilot is doing"

## 1. Code Reading & Analysis
- Read `src/utils/cli.ts` — the shared `runCLI()` utility used by both LLM providers
- Read `src/llm/CopilotCLIProvider.ts` — copilot CLI provider, passes `onStdoutChunk`/`onStderrChunk` callbacks
- Read `src/llm/MaiClaudeProvider.ts` — claude CLI provider, same pattern
- Read `src/utils/logger.ts` — dual-output logger (OutputChannel + file), includes `logLLMChunk()` for per-call markdown log files
- Read `src/analysis/AnalysisOrchestrator.ts` — coordinates LLM calls, already has extensive `logLLMStep` usage
- Read `.context/FLOORPLAN.md` — workspace floorplan for context

## 2. Issues Identified
- **`src/utils/cli.ts` line 101-107**: stdout chunks are only forwarded to the optional `onStdoutChunk` callback, which writes to the per-LLM-call markdown file via `logLLMChunk()`. They are NOT logged to the main Output Channel or daily log file — invisible during normal operation.
- **`src/utils/cli.ts` line 109-115**: stderr chunks have the same problem — only forwarded to `onStderrChunk` callback, not logged to main logger.
- **`src/utils/cli.ts` line 79-86**: The periodic "still waiting" log provides no useful information about what copilot has been doing — just says "still waiting" with elapsed time, no output snippet.
- **`src/utils/cli.ts` line 89-99**: Timeout handler provides no information about what was captured before the timeout.
- **`src/utils/cli.ts` line 117-123**: Error handler doesn't log any context about elapsed time or PID.
- **`src/utils/cli.ts` line 126-155**: Close handler doesn't log success with timing/size summary; only logs failures.
- **`src/utils/cli.ts` line 141-143**: stderr is logged once at the end at debug level, truncated to 500 chars — too late and too quiet to help diagnose stuck processes.

Root cause: The CLI runner was designed to be "quiet" in the main log, deferring all output visibility to the per-LLM-call markdown file. But when debugging stuck processes, you need to see what's happening in the VS Code Output Channel in real time, not open a separate file.

## 3. Plan
- Add real-time logging of every stdout/stderr chunk directly in `runCLI()` to the main logger
- stdout chunks → `logger.debug()` level (visible in file logs always, Output Channel when debug enabled)
- stderr chunks → `logger.warn()` level (always visible in Output Channel since stderr often indicates problems/progress)
- Track line counts and last output snippets for the periodic "still waiting" log
- Enhance the "still waiting" log to show stdout/stderr line counts, byte counts, and last snippet
- Enhance timeout handler to log what was captured before timeout
- Enhance error handler with elapsed time and PID context
- Add success summary log on normal close

No changes needed to providers or orchestrator — all improvements are in the shared `runCLI()` utility.

## 4. Changes Made
- **`src/utils/cli.ts`**:
  - **Spawn log** (line 71): Now includes the full command with args for easier identification
  - **Tracking variables** (lines 78-82): Added `_lastStdoutSnippet`, `_lastStderrSnippet`, `_stdoutLineCount`, `_stderrLineCount`
  - **Periodic "still waiting" log** (lines 84-101): Now shows stdout/stderr line counts, byte counts, and last output snippet (truncated to 120 chars)
  - **Timeout handler** (lines 103-130): Now logs detailed stats (byte counts, line counts) and last stdout/stderr snippets before timeout at ERROR level
  - **stdout handler** (lines 132-153): Now logs every non-empty line to `logger.debug()` in real time, tracks line counts and last snippet
  - **stderr handler** (lines 155-176): Now logs every non-empty line to `logger.warn()` in real time, tracks line counts and last snippet
  - **Error handler** (lines 178-189): Now logs elapsed time and PID at ERROR level
  - **Close handler** (lines 191-235): Now logs elapsed time, PID, stdout/stderr byte counts on signal kill, non-zero exit, and success

## 5. Commands Run
- `npm run lint` → PASS (no errors)
- `npm run build` → PASS (extension.js 201.9kb, webview/dist built)
- `npm run test:unit` → PASS (223 tests passing in 262ms)

## 6. Result
All CLI process stdout/stderr output is now logged in real time through the main logger, making it visible in:
1. **VS Code Output Channel** ("Code Explorer") — stderr at WARN level (always visible), stdout at DEBUG level
2. **Daily log file** (`.vscode/code-explorer-logs/<date>.log`) — all output captured
3. **Per-command log file** — if a command session is active
4. **Per-LLM-call markdown file** — still receives chunks via the existing `onStdoutChunk`/`onStderrChunk` callbacks (unchanged)

The periodic "still waiting" log now provides a rich snapshot of process state, and timeout/error scenarios log comprehensive context to help diagnose issues.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/utils/cli.ts` | Modified | Added real-time stdout/stderr logging to main logger, enhanced periodic waiting log with output snippets and stats, enriched timeout/error/close handlers with diagnostic context |
