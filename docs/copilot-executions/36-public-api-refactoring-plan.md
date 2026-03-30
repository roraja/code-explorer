# 36 - Public API Refactoring Plan

**Date**: 2026-03-30 00:00 UTC
**Prompt**: "I want to be able to test core functionality of this extension without needing to install vscode. Is it possible to expose all core methods like explore symbol, explore file, navigate to symbol, etc in a single public api file which is used by both extension entry points and can be used for testing or standalone invocation. Come up with a plan for refactoring and testing 5 core scenarios with mocks and providing a cli tool for it as well. Write plan in docs/next as md"

## 1. Code Reading & Analysis

Files read to understand the VS Code coupling boundary:

- `.context/FLOORPLAN.md` — routing table, architecture overview, feature inventory
- `src/extension.ts` (lines 1-609) — entry point, all command handlers, DI wiring
- `src/analysis/AnalysisOrchestrator.ts` (lines 1-1205) — full orchestrator including `analyzeSymbol`, `analyzeFromCursor`, `analyzeFile`, `enhanceAnalysis`, and private helpers. Identified single `vscode` import used only for `vscode.EventEmitter` on line 62
- `src/analysis/StaticAnalyzer.ts` (lines 1-647) — deeply VS-Code-coupled: every method uses `vscode.commands.executeCommand`, `vscode.workspace.openTextDocument`, `vscode.Uri`, `vscode.Position`, `vscode.Range`
- `src/cache/CacheStore.ts` (lines 1-700+) — confirmed zero vscode imports, uses `fs` and `path` only
- `src/llm/LLMProvider.ts` (lines 1-13) — pure interface, no vscode
- `src/llm/PromptBuilder.ts` (lines 1-851) — pure string construction, no vscode
- `src/llm/ResponseParser.ts` (lines 1-900+) — pure regex parsing, no vscode
- `src/llm/LLMProviderFactory.ts` (lines 1-59) — pure factory, no vscode
- `src/llm/CopilotCLIProvider.ts` (lines 1-125) — uses `child_process`, no vscode
- `src/llm/NullProvider.ts` (lines 1-33) — pure no-op, no vscode
- `src/graph/GraphBuilder.ts` (lines 1-582) — uses `fs` only, no vscode
- `src/utils/cli.ts` (lines 1-242) — uses `child_process.spawn`, no vscode
- `src/utils/logger.ts` (lines 1-80) — uses `vscode.OutputChannel`, `vscode.window.createOutputChannel`
- `src/ui/CodeExplorerViewProvider.ts` (lines 1-100) — deeply VS-Code-coupled (expected, UI layer)
- `src/models/types.ts` (lines 1-772) — pure types, no vscode
- `src/models/constants.ts` (lines 1-102) — pure constants, no vscode
- `src/indexing/SymbolAddress.ts` (lines 1-198) — pure crypto/string utils, no vscode
- `test/unit/cache/CacheStore.test.ts` (lines 1-60) — existing test pattern using temp dirs

Grep searches run:
- `import * as vscode` across `src/` — found 10 files with this import
- `vscode\.` in `AnalysisOrchestrator.ts` — found exactly 1 usage: `vscode.EventEmitter` on line 62
- `vscode` in `CacheStore.ts` — only `.vscode` path strings, no API import
- `vscode` in `PromptBuilder.ts` — only `.vscode` path strings
- `vscode` in `ResponseParser.ts` — zero matches
- `vscode` in `GraphBuilder.ts` — only `.vscode` path string

Glob searches:
- `src/**/*.ts` — 38 source files
- `test/**/*.ts` — 14 test files
- `docs/next/*` — 5 existing files (next number: 06)
- `docs/copilot-executions/*.md` — 45 existing files (next number: 36)

## 2. Issues Identified

1. **`AnalysisOrchestrator` unnecessarily imports `vscode`** — `src/analysis/AnalysisOrchestrator.ts:15` imports `* as vscode` but only uses `vscode.EventEmitter` on line 62. This single usage prevents the entire orchestrator from being used outside VS Code.

2. **`StaticAnalyzer` is deeply VS-Code-coupled** — every method (`resolveSymbolAtPosition`, `readSymbolSource`, `readContainingScopeSource`, `listFileSymbols`) uses `vscode.commands.executeCommand`, `vscode.workspace.openTextDocument`, `vscode.Uri`, `vscode.Position`, `vscode.Range`. This is a legitimate coupling (it wraps VS Code's language server APIs), but it's injected into the orchestrator without an interface, preventing substitution.

3. **`logger` module-level singleton depends on `vscode.OutputChannel`** — `src/utils/logger.ts:11` imports vscode, and line 77-79 creates the channel. Any module that calls `logger.info()` transitively pulls in vscode.

4. **No public API surface** — all core operations are scattered across command handlers in `extension.ts` (lines 131-599) and `CodeExplorerViewProvider` methods. There's no single importable entry point.

5. **No mechanism to inject mock LLM providers into the orchestrator for testing** — the LLM provider is passed via constructor (good), but the `CodeExplorerAPI` wrapper doesn't exist yet to provide a clean construction path for tests.

## 3. Plan

- Audit all source files to map the exact VS Code dependency boundary
- Design a layered approach: extract `ISourceReader` and `ILogger` interfaces to represent the VS-Code-coupled seams
- Design the `CodeExplorerAPI` class as a facade over all existing core modules
- Design 5 test scenarios covering the primary user-facing operations
- Design a CLI tool that constructs the API with filesystem-based implementations
- Write the plan as a detailed design doc in `docs/next/06-public-api-refactoring-plan.md`

No code changes were made — this is a planning-only prompt.

## 4. Changes Made

- **Created** `docs/next/06-public-api-refactoring-plan.md` — comprehensive refactoring plan (400+ lines) covering:
  - VS Code dependency audit table (18 modules analyzed)
  - Architecture: `ISourceReader` interface, `ILogger` interface, `CodeExplorerAPI` facade class
  - Two implementations per interface (VS Code real + filesystem/console mock)
  - 5 detailed test scenarios with code sketches
  - `MockLLMProvider` test helper design
  - CLI tool design with 5 commands
  - 4-phase implementation order
  - Migration path showing before/after for `extension.ts`
  - Risk table with mitigations
  - Success criteria checklist

## 5. Commands Run

No build/test commands were run — this was a planning-only prompt.

## 6. Result

Created a comprehensive refactoring plan at `docs/next/06-public-api-refactoring-plan.md`. The plan identifies that the codebase is already 90% VS-Code-free — only 3 seams need abstraction:

1. `vscode.EventEmitter` in `AnalysisOrchestrator` (2 lines, trivially replaceable)
2. `StaticAnalyzer` methods (already constructor-injected, just needs an interface)
3. `logger` singleton (needs a transport abstraction)

The plan defines a `CodeExplorerAPI` class that wraps `AnalysisOrchestrator`, `CacheStore`, and `GraphBuilder` with a clean constructor that accepts plain options. It includes 5 test scenarios (explore symbol, explore file, enhance analysis, cache round-trip, dependency graph), a `MockLLMProvider`, and a CLI tool.

No follow-up needed beyond implementation.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `docs/next/06-public-api-refactoring-plan.md` | Created | Comprehensive refactoring plan for VS-Code-free public API, test suite, and CLI tool |
| `docs/copilot-executions/36-public-api-refactoring-plan.md` | Created | This execution log |
