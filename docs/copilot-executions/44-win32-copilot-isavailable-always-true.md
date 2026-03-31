# 44 - Win32 Copilot isAvailable Always True

**Date**: 2026-03-31 UTC
**Prompt**: For win32, the src/llm/CopilotCLIProvider.ts isAvailable should return true always, where doesn't work

## 1. Code Reading & Analysis
- Read `src/llm/CopilotCLIProvider.ts` — the `isAvailable()` method (lines 36-47) uses `where` on Windows and `which` on Unix to detect whether the `copilot` CLI is on PATH. On Windows, `where copilot` is unreliable for detecting CLI tools installed as `.cmd`/`.ps1` wrappers or via npm globals, causing `isAvailable()` to return `false` even when copilot is actually available.
- Read `.context/FLOORPLAN.md` for project context and module responsibilities.
- Read `src/llm/MaiClaudeProvider.ts` (lines 1-50) — has the same `where`/`which` pattern in its `isAvailable()` method (not changed in this PR, separate concern).
- Grepped for all `isAvailable` references across the codebase — found usage in `AnalysisOrchestrator.ts` (lines 215, 599, 914, 1097) where it gates whether LLM analysis proceeds. When `isAvailable()` returns `false`, the orchestrator skips LLM analysis entirely and returns degraded results.
- Grepped for test files referencing `CopilotCLIProvider` — none found (no existing unit tests for this provider).

## 2. Issues Identified
- **File**: `src/llm/CopilotCLIProvider.ts`, lines 39-40
- **Problem**: On Windows (`win32`), the `where copilot` command is unreliable. The `where` command may not find CLI tools installed as `.cmd` or `.ps1` wrappers, npm global binaries, or tools available through modified PATH in shell profiles but not in the spawned process environment.
- **Impact**: `isAvailable()` returns `false` on Windows even when `copilot` is actually available, causing the extension to skip LLM analysis entirely and fall back to degraded/placeholder results.
- **Root cause**: `where.exe` on Windows has different search semantics than Unix `which` — it searches PATH but may miss shim wrappers or tools available through other mechanisms.

## 3. Plan
- On `win32`, skip the `where` check entirely and always return `true`.
- This is safe because if `copilot` is truly not installed, the `analyze()` method will fail gracefully — it catches errors and throws `LLMError` with `ErrorCode.LLM_UNAVAILABLE`, which the `AnalysisOrchestrator` handles by returning degraded results.
- On non-Windows platforms, continue using `which` (which works reliably on Unix/macOS).
- Alternative considered: fix the `where` command (e.g., try `where copilot.cmd`, `where copilot.exe`). Rejected because there are too many possible wrapper formats and the fail-safe approach (always try, handle errors) is more robust.

## 4. Changes Made

### `src/llm/CopilotCLIProvider.ts`

**Before** (lines 36-47):
```typescript
async isAvailable(): Promise<boolean> {
    try {
      // Use 'where' on Windows, 'which' on Unix to locate the CLI binary
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      await execFileAsync(cmd, ['copilot']);
      logger.debug('copilot CLI is available');
      return true;
    } catch {
      logger.warn('copilot CLI not found on PATH');
      return false;
    }
  }
```

**After** (lines 36-54):
```typescript
async isAvailable(): Promise<boolean> {
    // On Windows, 'where' is unreliable for detecting CLI tools that are
    // installed as .cmd/.ps1 wrappers or via npm globals. Always assume
    // copilot is available on win32 — if it truly isn't, the analyze()
    // call will fail gracefully with a clear error.
    if (process.platform === 'win32') {
      logger.debug('copilot CLI: win32 detected, assuming available');
      return true;
    }

    try {
      await execFileAsync('which', ['copilot']);
      logger.debug('copilot CLI is available');
      return true;
    } catch {
      logger.warn('copilot CLI not found on PATH');
      return false;
    }
  }
```

**Why**: The `where` command on Windows doesn't reliably detect CLI tools. By always returning `true` on win32, we ensure the extension always attempts to use copilot. If copilot is truly absent, the `analyze()` method's error handling will catch the spawn failure and produce a clear `LLMError` with `ErrorCode.LLM_UNAVAILABLE`, which the orchestrator handles gracefully (showing degraded results with a user-friendly message).

Additionally, the `cmd` variable with ternary is no longer needed — the Unix path always uses `'which'` directly, which is cleaner.

## 5. Commands Run
- `npm run build` — ✅ Success (extension 239.5kb, webview 2.8mb)
- `npm run lint` — 1 pre-existing error in `src/utils/logger.ts:71` (`@typescript-eslint/no-var-requires`), not related to this change
- `npm run test:unit` — ✅ 291 passing (54s), all tests pass

## 6. Result
- `CopilotCLIProvider.isAvailable()` now always returns `true` on Windows (`win32`).
- On non-Windows platforms, behavior is unchanged (uses `which` to check).
- The change is safe because `analyze()` already has comprehensive error handling for spawn failures, so a missing `copilot` binary will produce a clear error message rather than silently doing nothing.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/llm/CopilotCLIProvider.ts` | Modified | Skip `where` check on win32, always return `true` for `isAvailable()` |
| `docs/copilot-executions/44-win32-copilot-isavailable-always-true.md` | Created | Execution log |
