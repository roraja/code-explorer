# 34 - Windows Compatibility Fixes

**Date**: 2026-03-30 UTC
**Prompt**: "Make sure that this works with Windows as well, check all crucial places and ensure it works on windows. Commit and trigger release."

## 1. Code Reading & Analysis

Systematically reviewed every file that does OS-level operations (process spawning, path manipulation, file system operations):

- **`src/utils/cli.ts`** — Core CLI runner used by all LLM providers. Uses `spawn()` without `shell: true` → `.cmd`/`.bat` shims won't be found on Windows.
- **`src/llm/CopilotCLIProvider.ts`** — Uses `execFileAsync('which', ['copilot'])` which fails on Windows (`which` doesn't exist).
- **`src/llm/MaiClaudeProvider.ts`** — Same issue: `execFileAsync('which', ['claude'])`.
- **`src/llm/BuildServiceProvider.ts`** — HTTP-only, no OS-specific code. ✅
- **`src/llm/NullProvider.ts`** — No-op. ✅
- **`src/llm/LLMProviderFactory.ts`** — Pure routing logic. ✅
- **`src/git/AdoSync.ts`** — Three `spawn('git', ...)` calls without `shell: true`.
- **`src/cache/CacheStore.ts`** — Uses `path.join()` and `path.relative()` correctly. `_sanitizeName()` already replaces both `/` and `\`. Symlink fallback to `copyFile` already handles Windows. ✅
- **`src/providers/CodeExplorerHoverProvider.ts`** — `relPath.startsWith('..')` check misses Windows cross-drive absolute paths.
- **`src/providers/CodeExplorerCodeLensProvider.ts`** — Same `startsWith('..')` issue.
- **`src/providers/ShowSymbolInfoCommand.ts`** — Uses `path.relative()` for display only. ✅
- **`src/providers/SymbolResolver.ts`** — Uses `path.relative()` correctly. ✅
- **`src/ui/CodeExplorerViewProvider.ts`** — Uses `path.join()` and `vscode.Uri` APIs. ✅
- **`src/ui/TabSessionStore.ts`** — Uses `path.join()` correctly. ✅
- **`src/utils/logger.ts`** — Uses `path.join()` correctly. ✅
- **`src/analysis/AnalysisOrchestrator.ts`** — No direct OS operations. ✅
- **`src/analysis/StaticAnalyzer.ts`** — Uses `path.relative()` for display. ✅
- **`src/graph/GraphBuilder.ts`** — Uses `path.join()` and `fs` correctly. ✅
- **`src/indexing/SymbolAddress.ts`** — Uses `path.join()` for cache paths. ✅
- **`src/skills/SkillInstaller.ts`** — Uses `os.homedir()` and `path.join()`. ✅
- **`src/extension.ts`** — Uses `path.relative()` correctly. ✅
- **`webview/src/main.ts`** — Browser-only, no OS operations. ✅
- **`esbuild.config.mjs`** — Node.js standard APIs. ✅
- **`webview/esbuild.config.mjs`** — Browser build config. ✅

Also checked:
- Signal handling (`SIGTERM`/`killed`) in cli.ts and providers — works because `killed` property covers Windows ✅
- `\r\n` line endings — YAML frontmatter parsing uses `\r?\n` regex ✅
- Cache file path sanitization — already replaces `\` ✅
- Symlink creation — already has copy fallback for Windows ✅

## 2. Issues Identified

### Issue 1: `which` command doesn't exist on Windows
- **Files**: `src/llm/CopilotCLIProvider.ts:38`, `src/llm/MaiClaudeProvider.ts:31`
- **Problem**: `execFileAsync('which', ['copilot'/'claude'])` — `which` is a Unix command. Windows equivalent is `where`.
- **Impact**: `isAvailable()` would always return false on Windows → extension thinks no LLM is available.

### Issue 2: `spawn()` can't find `.cmd`/`.bat` on Windows without `shell: true`
- **Files**: `src/utils/cli.ts:64`, `src/git/AdoSync.ts:38,76`
- **Problem**: Node.js `spawn()` without `shell: true` only searches for `.exe` files on Windows PATH. CLI tools installed via npm (like `copilot`, `claude`) are typically `.cmd` shim scripts on Windows.
- **Impact**: All LLM analysis and git commands would fail with `ENOENT` on Windows.

### Issue 3: Cross-drive path detection on Windows
- **Files**: `src/providers/CodeExplorerHoverProvider.ts:49`, `src/providers/CodeExplorerCodeLensProvider.ts:57`
- **Problem**: `relPath.startsWith('..')` doesn't catch files on different drives. On Windows, `path.relative('C:\\ws', 'D:\\other\\file.ts')` returns `'D:\\other\\file.ts'` (absolute), not `..`.
- **Impact**: Edge case — hover/codelens would attempt cache lookups for cross-drive files (unlikely to cause a crash but wasteful).

### Non-issues confirmed
- `SIGTERM` handling: `error.killed` check covers Windows (Node.js sets it on `TerminateProcess()`) ✅
- `path.join()` / `path.relative()`: All path construction uses Node's `path` module which handles separators correctly ✅
- YAML parsing: Uses `\r?\n` in frontmatter regex, handles Windows line endings ✅
- Symlink creation: Already has copy fallback (`catch` on line 777 of CacheStore.ts) ✅
- `_sanitizeName()`: Already replaces both `/` and `\` with `_` ✅

## 3. Plan

1. Fix `isAvailable()` in both LLM providers: use `where` on Windows, `which` on Unix
2. Add `shell: process.platform === 'win32'` to `spawn()` in `cli.ts` and `AdoSync.ts`
3. Add `path.isAbsolute(relPath)` check in HoverProvider and CodeLensProvider
4. Build, lint, test, commit, push

## 4. Changes Made

### `src/llm/CopilotCLIProvider.ts`
```diff
   async isAvailable(): Promise<boolean> {
     try {
-      await execFileAsync('which', ['copilot']);
+      // Use 'where' on Windows, 'which' on Unix to locate the CLI binary
+      const cmd = process.platform === 'win32' ? 'where' : 'which';
+      await execFileAsync(cmd, ['copilot']);
```

### `src/llm/MaiClaudeProvider.ts`
```diff
   async isAvailable(): Promise<boolean> {
     try {
-      await execFileAsync('which', ['claude']);
+      // Use 'where' on Windows, 'which' on Unix to locate the CLI binary
+      const cmd = process.platform === 'win32' ? 'where' : 'which';
+      await execFileAsync(cmd, ['claude']);
```

### `src/utils/cli.ts`
```diff
     const child = spawn(command, args, {
       env,
       cwd: cwd || process.cwd(),
       stdio: ['pipe', 'pipe', 'pipe'],
+      // On Windows, spawn doesn't search for .cmd/.bat extensions without shell:true.
+      // CLI tools installed via npm (copilot, claude) are often .cmd shims on Windows.
+      shell: process.platform === 'win32',
     });
```

### `src/git/AdoSync.ts`
All three `spawn('git', ...)` calls got `shell: process.platform === 'win32'`:
- `_runGit` function (line 38)
- `_runGitEnv` function (line 76)

### `src/providers/CodeExplorerHoverProvider.ts`
```diff
-    // Skip files outside the workspace
-    if (relPath.startsWith('..')) {
+    // Skip files outside the workspace (on Windows, cross-drive paths are absolute)
+    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
```

### `src/providers/CodeExplorerCodeLensProvider.ts`
```diff
-    // Skip files outside the workspace
-    if (relPath.startsWith('..')) {
+    // Skip files outside the workspace (on Windows, cross-drive paths are absolute)
+    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
```

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ extension.js 227.1kb, webview 2.8mb |
| `npm run lint` | ✅ clean |
| `npm run test:unit` | ✅ 248 passing (403ms) |
| `git push origin master` | ✅ pushed to trigger release |

## 6. Result

- All three categories of Windows issues fixed
- Default LLM provider remains `copilot-cli` ✅
- All 248 tests pass, lint clean
- Build succeeds
- Pushed to `origin/master` to trigger release

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/llm/CopilotCLIProvider.ts` | Modified | Use `where` on Windows instead of `which` for CLI availability check |
| `src/llm/MaiClaudeProvider.ts` | Modified | Use `where` on Windows instead of `which` for CLI availability check |
| `src/utils/cli.ts` | Modified | Add `shell: true` on Windows for spawn to find .cmd/.bat shims |
| `src/git/AdoSync.ts` | Modified | Add `shell: true` on Windows for all three git spawn calls |
| `src/providers/CodeExplorerHoverProvider.ts` | Modified | Add `path.isAbsolute()` check for cross-drive files on Windows |
| `src/providers/CodeExplorerCodeLensProvider.ts` | Modified | Add `path.isAbsolute()` check for cross-drive files on Windows |
| `docs/copilot-executions/33-*.md` | Created | Execution log for previous prompt (vscodeignore + build-service config) |
