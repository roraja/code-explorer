# 43 - Update Context Files

**Date**: 2026-03-31 00:00 UTC
**Prompt**: Run the /update-context:skills command — walk through the codebase and update all context documentation files to reflect the current state of the code.

## 1. Code Reading & Analysis
- Ran `find` to inventory all 65 `.ts` source files across the project
- Read all 15 existing CONTEXT.md files (src/, src/models/, src/providers/, src/analysis/, src/llm/, src/llm/prompts/, src/cache/, src/ui/, src/utils/, webview/, test/, src/api/, src/indexing/, src/skills/, src/git/)
- Read all key source files: `extension.ts`, `types.ts`, `constants.ts`, `errors.ts`, `CodeExplorerViewProvider.ts`, `TabSessionStore.ts`, `CodeExplorerHoverProvider.ts`, `CodeExplorerCodeLensProvider.ts`, `ShowSymbolInfoCommand.ts`, `VscodeSourceReader.ts`, `GraphBuilder.ts`, `CodeExplorerAPI.ts`, `LLMProviderFactory.ts`, `BuildServiceProvider.ts`, `MockCopilotProvider.ts`, `code-explorer-cli.ts`, `AdoSync.ts`, `symbolHelpers.ts`
- Checked for missing CONTEXT.md files in new folders: `src/graph/`, `src/cli/`
- Checked test directory structure for new test files
- Verified package.json scripts

## 2. Issues Identified
- `.context/FLOORPLAN.md` was missing: HoverProvider and CodeLensProvider (listed as "Not implemented" but fully implemented), BuildServiceProvider, MockCopilotProvider, GraphBuilder/dependency graph, ShowSymbolInfoCommand, TabSessionStore, navigation history, pinned investigations, tab notes, tab reordering, ADO upstream sync, all new commands
- `src/CONTEXT.md` was missing: new module folders (graph/, cli/, indexing/), new providers (Hover, CodeLens, ShowSymbolInfo), new commands (PULL_ADO_UPSTREAM, PUSH_ADO_UPSTREAM, SHOW_DEPENDENCY_GRAPH, SHOW_SYMBOL_INFO), updated dependency graph
- `src/models/CONTEXT.md` was missing: NavigationEntry, NavigationTrigger, NavigationHistoryState, PinnedInvestigation, new commands, new config keys, TabState.enhancing/notes fields, showDependencyGraph message type, many new WebviewToExtensionMessage types
- `src/providers/CONTEXT.md` was missing: CodeExplorerHoverProvider.ts, CodeExplorerCodeLensProvider.ts, ShowSymbolInfoCommand.ts, VscodeSourceReader.ts
- `src/ui/CONTEXT.md` was missing: TabSessionStore.ts, navigation history, pinned investigations, tab notes, GraphBuilder injection, showDependencyGraph, many new message types
- `src/llm/CONTEXT.md` was missing: MockCopilotProvider.ts
- `src/utils/CONTEXT.md` was missing: symbolHelpers.ts
- `src/git/CONTEXT.md` was missing: upstream sync functions (pullAdoUpstream, pushAdoUpstream), SyncTarget architecture, branch switching logic
- `test/CONTEXT.md` was missing: test/unit/api/ (5 test files + helpers), test/unit/ui/ (2 test files), test/unit/indexing/ (3 test files), test/unit/llm/BuildServiceProvider.test.ts, test/unit/llm/MockCopilotProvider.test.ts
- No CONTEXT.md existed for `src/graph/` and `src/cli/`

## 3. Plan
- Update all 12 listed CONTEXT.md files with current code state
- Create 2 new CONTEXT.md files for `src/graph/` and `src/cli/`
- Update FLOORPLAN.md with correct feature status table, folder routing, data flow, and troubleshooting
- Leave src/analysis/CONTEXT.md, src/cache/CONTEXT.md, src/llm/prompts/CONTEXT.md, src/api/CONTEXT.md, src/indexing/CONTEXT.md, src/skills/CONTEXT.md, webview/CONTEXT.md unchanged (already accurate)

## 4. Changes Made

### `.context/FLOORPLAN.md`
- Added routing entries for `src/graph/`, `src/cli/`, `src/indexing/`
- Updated providers routing to include hover/CodeLens/diagnostic
- Updated utils routing to include symbolHelpers
- Updated git routing to mention upstream
- Updated ui routing to include TabSessionStore
- Changed HoverProvider status from "Not implemented" to "Implemented"
- Changed CodeLensProvider status from "Not implemented" to "Implemented"
- Added features: TabSessionStore, NavigationHistory, PinnedInvestigations, TabNotes, TabReordering, BuildServiceProvider, MockCopilotProvider, ShowSymbolInfoCommand, DependencyGraph, TreeSitterIndexing, PerCommandLogFiles, ADO upstream sync
- Added dependency graph data flow diagram
- Added troubleshooting entries for tabs lost on reload, build service, hover cards, CodeLens, dependency graph

### `src/CONTEXT.md`
- Updated dependency graph to include new imports (api, providers/*, graph/*)
- Updated commands list: 8 → 12 commands (added upstream ADO, dependency graph, show symbol info)
- Updated module folders table: added api/, cli/, graph/, indexing/, expanded descriptions

### `src/models/CONTEXT.md`
- Added NavigationEntry, NavigationTrigger, NavigationHistoryState, PinnedInvestigation types
- Updated TabState to note enhancing/notes fields
- Updated ExtensionToWebviewMessage to include showDependencyGraph + navigationHistory
- Updated WebviewToExtensionMessage with all 22+ message types
- Updated Commands list: 8 → 12 commands
- Added Config Keys section

### `src/providers/CONTEXT.md`
- Complete rewrite: expanded from 1 file to 5 files documentation
- Added CodeExplorerHoverProvider documentation with constructor, rendering details
- Added CodeExplorerCodeLensProvider documentation with all CodeLens types, refresh(), dispose()
- Added ShowSymbolInfoCommand documentation with 11 providers, 3 address strategies
- Added VscodeSourceReader documentation
- Kept SymbolResolver as legacy

### `src/ui/CONTEXT.md`
- Added TabSessionStore.ts module entry
- Added full private state listing for CodeExplorerViewProvider
- Added new methods: showDependencyGraph, setGraphBuilder, _recordNavigation, _historyBack/_historyForward
- Added navigation history section
- Added TabSessionStore section with interface definitions
- Added tab creation flow for session restore
- Updated message protocol: 8 → 22+ message types
- Added TabState.enhancing and TabState.notes fields

### `src/llm/CONTEXT.md`
- Added MockCopilotProvider.ts to modules table
- Added MockCopilotProvider to provider architecture section
- Added mock-copilot row to provider-specific details table
- Added BuildServiceProvider output collection section

### `src/utils/CONTEXT.md`
- Added symbolHelpers.ts to modules table
- Added Symbol Helpers section with findDeepestSymbol, buildScopeChainForPosition, mapVscodeSymbolKind
- Added DeepestSymbolMatch interface
- Updated Do NOT section to include "don't duplicate symbolHelpers"
- Updated logger.init() to note extensionVersion parameter

### `src/git/CONTEXT.md`
- Complete rewrite: expanded from 2-function to 4-function API with SyncTarget architecture
- Added upstream branch configuration
- Documented _pull()/_push() generic functions with branch switching logic
- Updated public API table: 2 → 4 functions
- Updated VS Code integration: 2 → 4 commands

### `test/CONTEXT.md`
- Added test/unit/api/ directory with 5 test files + helpers
- Added test/unit/ui/ directory with 2 test files
- Added test/unit/indexing/ directory with 3 test files
- Added test/unit/llm/BuildServiceProvider.test.ts and MockCopilotProvider.test.ts
- Added npm run test:api command
- Added more test file naming examples

### `src/graph/CONTEXT.md` (NEW)
- Created from scratch documenting GraphBuilder, types, data flow, Mermaid rendering, usage examples

### `src/cli/CONTEXT.md` (NEW)
- Created from scratch documenting CLI tool, commands, options, architecture, output conventions

## 5. Commands Run
- `find . -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' | sort` — inventoried 65 TypeScript files
- `ls` on test directories — confirmed new test file locations
- `grep` on package.json — verified test:api and cli scripts
- `ls` on src/cli/ and src/graph/ — confirmed no CONTEXT.md files existed

## 6. Result
- Updated 10 existing CONTEXT.md files
- Created 2 new CONTEXT.md files (src/graph/, src/cli/)
- Updated FLOORPLAN.md with comprehensive current state
- Left 5 CONTEXT.md files unchanged (already accurate): src/analysis/, src/cache/, src/llm/prompts/, src/api/, src/indexing/, src/skills/, webview/

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `.context/FLOORPLAN.md` | Modified | Updated feature status, folder routing, data flow, troubleshooting |
| `src/CONTEXT.md` | Modified | Updated dependency graph, commands, module folders |
| `src/models/CONTEXT.md` | Modified | Added navigation types, updated messages, commands, config keys |
| `src/providers/CONTEXT.md` | Modified | Added HoverProvider, CodeLensProvider, ShowSymbolInfoCommand, VscodeSourceReader |
| `src/ui/CONTEXT.md` | Modified | Added TabSessionStore, navigation history, pinned investigations, expanded message protocol |
| `src/llm/CONTEXT.md` | Modified | Added MockCopilotProvider, BuildService output collection |
| `src/utils/CONTEXT.md` | Modified | Added symbolHelpers.ts documentation |
| `src/git/CONTEXT.md` | Modified | Added upstream sync, SyncTarget architecture, 4-function API |
| `test/CONTEXT.md` | Modified | Added all new test files and directories |
| `src/graph/CONTEXT.md` | Created | New: GraphBuilder documentation |
| `src/cli/CONTEXT.md` | Created | New: CLI tool documentation |
