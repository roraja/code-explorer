# 03 - Add "Explore All Symbols in File" Command

**Date**: 2026-03-29 00:00 UTC
**Prompt**: Add a vscode command for this extension "Explore all symbols of this file" which triggers a copilot cli session which is instructed to analyse the current file and write md cache file for all symbols (crucial ones) in the same cache directory so that when user reads a symbol, there can be a cache hit.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — understood module routing table and overall architecture
- Read `src/models/constants.ts` — COMMANDS enum, CACHE constants (lines 17-22 for command IDs)
- Read `src/models/types.ts` — all interfaces: SymbolInfo, AnalysisResult, CursorContext, AnalysisMetadata, FunctionStep, SubFunctionInfo, etc.
- Read `src/extension.ts` — command registration pattern, DI setup, how existing commands are wired
- Read `src/analysis/AnalysisOrchestrator.ts` — analyzeSymbol() and analyzeFromCursor() flows, cache read/write, related symbol pre-caching
- Read `src/cache/CacheStore.ts` — cache file path resolution (_resolvePath, _buildCacheKey), serialization format (YAML frontmatter + markdown body), findByCursor()
- Read `src/llm/PromptBuilder.ts` — build() and buildUnified() methods, strategy pattern, SYSTEM_PROMPT, cache key naming convention instructions
- Read `src/llm/ResponseParser.ts` — parse() method, parseSymbolIdentity(), parseRelatedSymbolCacheEntries(), all JSON block parsers
- Read `src/llm/CopilotCLIProvider.ts` — how CLI is invoked, args, stdin piping
- Read `src/llm/MaiClaudeProvider.ts` — alternative provider pattern
- Read `src/llm/LLMProvider.ts` — provider interface
- Read `src/llm/LLMProviderFactory.ts` — factory pattern
- Read `src/utils/cli.ts` — runCLI() utility
- Read `src/ui/CodeExplorerViewProvider.ts` — openTab(), openTabFromCursor(), message handling
- Read `package.json` — existing commands, menus, keybindings, activation events

## 2. Issues Identified
- No existing command to analyze all symbols in a file — only single-symbol analysis exists
- The `analyzeWorkspace` command is a stub (line 159-164 in extension.ts)
- Need a new prompt strategy that handles full-file analysis and outputs multiple symbol entries
- Need a new ResponseParser method to handle the `json:file_symbol_analyses` block format
- Need a new orchestrator method that iterates over parsed symbols and writes each to cache

## 3. Plan
- Add new command constant `EXPLORE_FILE_SYMBOLS` to constants.ts
- Add `buildFileAnalysis()` static method to PromptBuilder — crafts a prompt that instructs the LLM to analyze the full file and output all symbols in a structured JSON block
- Add `FileSymbolAnalysisEntry` interface and `parseFileSymbolAnalyses()` method to ResponseParser
- Add `analyzeFile()` method to AnalysisOrchestrator — sends file to LLM, parses response, writes individual cache files for each symbol (skipping already-cached)
- Wire the command in extension.ts with a progress notification
- Register command, keybinding (Ctrl+Shift+Alt+E), context menu entry, and activation event in package.json

Alternative considered: Running N individual `analyzeSymbol()` calls per symbol — rejected because it would require N LLM round-trips vs. a single call for the whole file.

## 4. Changes Made

### `src/models/constants.ts`
- Added `EXPLORE_FILE_SYMBOLS: 'codeExplorer.exploreFileSymbols'` to the COMMANDS object

### `src/llm/PromptBuilder.ts`
- Added `buildFileAnalysis(filePath, fileSource, cacheRoot)` static method
- This method creates a comprehensive prompt that instructs the LLM to:
  - Read the full file source
  - Identify every crucial symbol (classes, functions, methods, interfaces, enums, type aliases, exported variables)
  - Output a `json:file_symbol_analyses` block with a full analysis entry per symbol
  - Follow the exact cache key naming convention so entries are cache-compatible

### `src/llm/ResponseParser.ts`
- Added `FileSymbolAnalysisEntry` interface — extends RelatedSymbolCacheEntry with steps, subFunctions, functionInputs, functionOutput, classMembers, callers, usagePattern
- Added `parseFileSymbolAnalyses(raw)` static method — parses the `json:file_symbol_analyses` block with full type validation for all nested structures (callers, sub-functions, function inputs/output, class members, steps)

### `src/analysis/AnalysisOrchestrator.ts`
- Added `analyzeFile(filePath, fileSource, onProgress)` method
- Flow: check LLM availability -> build prompt -> send to LLM -> parse response -> write each symbol to cache (skipping already-cached non-stale entries)
- Returns count of symbols cached
- Full logging via LLM call log

### `src/extension.ts`
- Registered new `COMMANDS.EXPLORE_FILE_SYMBOLS` command handler
- Reads the active editor's file content
- Uses `vscode.window.withProgress()` for a progress notification
- Calls `orchestrator.analyzeFile()` with progress callbacks
- Shows success/failure message with cached symbol count

### `package.json`
- Added command definition: `codeExplorer.exploreFileSymbols` with title "Explore All Symbols in File"
- Added activation event: `onCommand:codeExplorer.exploreFileSymbols`
- Added keybinding: `Ctrl+Shift+Alt+E` / `Cmd+Shift+Alt+E`
- Added editor context menu entry at navigation group @11 (right after Explore Symbol)

## 5. Commands Run
- `npm run build` — PASS (dist/extension.js 103.8kb, webview built)
- `npm run lint` — 1 warning (unused import FileSymbolAnalysisEntry in orchestrator)
- Fixed unused import, re-ran lint — PASS (0 errors, 0 warnings)
- `npm run test:unit` — PASS (119 passing in 57ms)
- Final `npm run build` — PASS

## 6. Result
- New command "Code Explorer: Explore All Symbols in File" fully implemented
- Accessible via:
  - Command palette: "Code Explorer: Explore All Symbols in File"
  - Keybinding: Ctrl+Shift+Alt+E (Cmd+Shift+Alt+E on Mac)
  - Editor context menu (right-click)
- Flow: reads active file -> sends full source to LLM -> LLM identifies all crucial symbols -> parses structured response -> writes individual cache .md files per symbol
- Future "Explore Symbol" (Ctrl+Shift+E) lookups on any symbol in that file will hit the cache
- All existing tests pass, clean lint, successful build

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `src/models/constants.ts` | Modified | Added `EXPLORE_FILE_SYMBOLS` command constant |
| `src/llm/PromptBuilder.ts` | Modified | Added `buildFileAnalysis()` method for file-level analysis prompt |
| `src/llm/ResponseParser.ts` | Modified | Added `FileSymbolAnalysisEntry` interface and `parseFileSymbolAnalyses()` parser |
| `src/analysis/AnalysisOrchestrator.ts` | Modified | Added `analyzeFile()` method for full-file analysis pipeline |
| `src/extension.ts` | Modified | Wired `exploreFileSymbols` command with progress notification |
| `package.json` | Modified | Added command, keybinding, context menu, activation event |
| `docs/copilot-executions/03-add-explore-all-file-symbols-command.md` | Created | This execution log |
