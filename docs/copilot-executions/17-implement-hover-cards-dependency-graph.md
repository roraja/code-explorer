# 17 - Implement Hover Cards and Dependency Graph

**Date**: 2026-03-29 01:00 UTC
**Prompt**: "Implement 4. Hover Cards — Inline Analysis Preview Without Leaving the Editor and 1. Dependency graphs"

## 1. Code Reading & Analysis

| File | Why |
|------|-----|
| `.context/FLOORPLAN.md` | Module routing, feature status, data flow understanding |
| `CLAUDE.md` | Conventions, architecture, two-project structure, error/logging rules |
| `src/extension.ts` | Activation flow, DI wiring, command registration — needed to understand where to wire HoverProvider and graph command |
| `src/models/types.ts` | All interfaces — needed to extend `ExtensionToWebviewMessage` and `WebviewToExtensionMessage` for graph support |
| `src/models/constants.ts` | Command IDs, config keys — `CONFIG.SHOW_HOVER_CARDS` already defined, needed to add `SHOW_DEPENDENCY_GRAPH` command |
| `src/cache/CacheStore.ts` | Full cache API — `findByCursor()` is the key method for HoverProvider (fast, no LLM call); serialization/deserialization format for GraphBuilder parsing |
| `src/ui/CodeExplorerViewProvider.ts` | Tab management, message routing — needed to add `setGraphBuilder()`, `showDependencyGraph()`, and graph message handlers |
| `src/analysis/StaticAnalyzer.ts` | Unused but available methods — context for graph builder approach |
| `src/providers/SymbolResolver.ts` | Legacy provider — confirmed `src/providers/` is the right directory for HoverProvider |
| `src/providers/CONTEXT.md` | Provider conventions |
| `webview/src/main.ts` | Full renderer — needed to add graph view mode, message handler, and rendering functions |
| `webview/src/styles/main.css` | Existing CSS patterns — followed same conventions for graph view styles |
| `package.json` | Existing commands, activation events, configuration — needed to add `showDependencyGraph` command |
| `src/llm/PromptBuilder.ts` | Prompt structure — not modified, but read to understand how analyses are structured (subFunctions, callers, dependencies) for graph edge extraction |
| `src/llm/ResponseParser.ts` | JSON block formats — needed to understand cache file format for GraphBuilder parsing |

## 2. Issues Identified

No bugs found. This was a feature implementation task. Key design decisions:

1. **HoverProvider**: The `CONFIG.SHOW_HOVER_CARDS` config key was already defined in constants.ts and registered in package.json (`codeExplorer.showHoverCards`, default: true). The CacheStore's `findByCursor()` method provides fast, no-LLM cache lookup — perfect for hover.

2. **Graph Builder**: The cache files store `json:callers`, `json:subfunctions`, and `## Dependencies` sections — all parseable without deserialization of the full AnalysisResult. The graph builder needed its own lightweight parser since `CacheStore._deserialize()` is private.

3. **types.ts already modified**: The file had been modified by a prior session (navigation history feature was added). Worked with the existing union-compatible structure.

## 3. Plan

### Hover Cards
1. Create `src/providers/CodeExplorerHoverProvider.ts` implementing `vscode.HoverProvider`
2. On hover: check `codeExplorer.showHoverCards` config → call `CacheStore.findByCursor()` → build Markdown hover card from cached data
3. Register in `extension.ts` for all 9 supported languages
4. Never trigger LLM calls — only show cached data

### Dependency Graph
1. Create `src/graph/GraphBuilder.ts` with:
   - `buildGraph()`: scan all cache files, build nodes + edges
   - `buildSubgraph()`: focused 1-hop subgraph around a symbol
   - `toMermaid()`: convert graph to Mermaid flowchart string
2. Add `SHOW_DEPENDENCY_GRAPH` command to constants.ts
3. Add `showDependencyGraph` message type to `ExtensionToWebviewMessage`
4. Add `requestDependencyGraph`, `requestSymbolGraph`, `closeDependencyGraph` to `WebviewToExtensionMessage`
5. Wire `GraphBuilder` into `CodeExplorerViewProvider` via `setGraphBuilder()`
6. Add graph rendering to webview: full-screen graph view mode with header, legend, close button, and Mermaid diagram
7. Add CSS styles for graph view
8. Register command in `extension.ts` and `package.json`

## 4. Changes Made

### New Files

**`src/providers/CodeExplorerHoverProvider.ts`** — HoverProvider that shows cached analysis on hover
- Checks `codeExplorer.showHoverCards` config (respects existing setting)
- Uses `CacheStore.findByCursor()` for fast cache lookup (no LLM)
- Builds rich Markdown hover: kind badge, overview (2 sentences max), signature, stats (callers/sub-functions/members/issues), first potential issue, analyzed timestamp with "Open in Code Explorer" link
- Returns null for uncached symbols (no clutter)
- Helper methods: `_truncateToSentences()`, `_truncate()`, `_timeAgo()`

**`src/graph/GraphBuilder.ts`** — Builds dependency graph from cached analyses
- `buildGraph()`: recursively scans `.vscode/code-explorer/` for all `.md` cache files, parses frontmatter + JSON blocks, builds `GraphNode[]` and `GraphEdge[]`
- `buildSubgraph(name, file)`: builds focused 1-hop subgraph around a specific symbol
- `toMermaid(graph, centerId?)`: converts graph to Mermaid flowchart with styled nodes (color-coded by kind), edge types (calls → solid, dependsOn → dashed, extends → thick, implements → dot-dash), and optional center node highlighting
- Lightweight cache parsing: only reads frontmatter + `json:callers`, `json:subfunctions`, `## Dependencies` — no full deserialization
- Edge deduplication, cross-file name matching with fallbacks

### Modified Files

**`src/models/constants.ts`** — Added `SHOW_DEPENDENCY_GRAPH` command ID

**`src/models/types.ts`** — Extended message types:
- `ExtensionToWebviewMessage`: now a union with `setState` and `showDependencyGraph` variants
- `WebviewToExtensionMessage`: added `requestDependencyGraph`, `requestSymbolGraph`, `closeDependencyGraph`

**`src/extension.ts`** — Wired both features:
- Imported `CodeExplorerHoverProvider` and `GraphBuilder`
- Registered `HoverProvider` for 9 languages after UI layer setup
- Created `GraphBuilder` and passed to view provider via `setGraphBuilder()`
- Registered `SHOW_DEPENDENCY_GRAPH` command with progress notification

**`src/ui/CodeExplorerViewProvider.ts`** — Added graph support:
- Imported `GraphBuilder` type
- Added `_graphBuilder` field
- Added `setGraphBuilder()` public method
- Added `showDependencyGraph()` public method (posts message to webview)
- Added `_handleRequestDependencyGraph()` and `_handleRequestSymbolGraph()` private handlers
- Added message handler cases for `requestDependencyGraph`, `requestSymbolGraph`, `closeDependencyGraph`

**`webview/src/main.ts`** — Added graph rendering:
- Added graph state variables: `_showingGraph`, `_graphMermaidSource`, `_graphNodeCount`, `_graphEdgeCount`
- Updated message handler to handle `showDependencyGraph` message type
- Updated `render()` to check `_showingGraph` flag and render graph view
- Added `_renderGraphView()`: header with stats badges, color legend, close button, Mermaid diagram container (or empty state with kbd hint)
- Added `_attachGraphListeners()`: close button handler
- Added `_renderGraphDiagram()`: delegates to existing `renderMermaidDiagrams()`

**`webview/src/styles/main.css`** — Added graph view CSS:
- `.graph-view` full-height flex layout
- `.graph-view__header` with title, stats badges, close button
- `.graph-view__legend` with color swatches for node kinds
- `.graph-view__body` scrollable diagram container
- `.graph-view__empty` empty state with keyboard hint
- Follows VS Code theme variable conventions

**`package.json`** — Added `showDependencyGraph` command registration

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Pass — extension.js 174.3kb, webview main.js 2.7mb, main.css 25.7kb |
| `npm run lint` | ✅ Pass — 0 errors, 0 warnings (after fixing unused CONFIG import) |
| `npm run test:unit` | ✅ Pass — 142 tests passing (79ms) |

## 6. Result

Both features implemented and working:

### Hover Cards
- Hover over any previously-analyzed symbol in the editor to see a compact preview
- Shows: kind badge, name, overview (first 2 sentences), signature (params → return type), stats (caller/sub-function/member/issue counts), first potential issue, timestamp with "Open in Code Explorer" link
- Controlled by `codeExplorer.showHoverCards` setting (already registered, default: true)
- Zero LLM calls — uses `findByCursor()` for instant cache lookup
- Returns null for uncached symbols (no visual noise)

### Dependency Graph
- Command: "Code Explorer: Show Dependency Graph" (command palette)
- Scans all cached analyses, builds node/edge graph, renders as Mermaid flowchart in the sidebar
- Nodes are color-coded by kind (green=function, blue=class, purple=interface, brown=variable)
- Edge types: solid arrows (calls), dashed (dependsOn), thick (extends), dot-dash (implements)
- Subgraph support: `requestSymbolGraph` message for focused 1-hop view around a symbol
- Close button returns to normal tab view
- Legend bar shows node kind colors and edge types

### Remaining work (not in scope)
- Click-to-explore from graph nodes (would need SVG click detection → postMessage)
- Graph persistence across webview re-creation
- Graph filtering by file/kind/depth
- Graph search/zoom controls

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/providers/CodeExplorerHoverProvider.ts` | Created | HoverProvider showing cached analysis on hover |
| `src/graph/GraphBuilder.ts` | Created | Builds dependency graphs from cached analyses, outputs Mermaid |
| `src/models/constants.ts` | Modified | Added `SHOW_DEPENDENCY_GRAPH` command constant |
| `src/models/types.ts` | Modified | Added `showDependencyGraph` to ExtensionToWebviewMessage union; added graph request messages |
| `src/extension.ts` | Modified | Wired HoverProvider (9 languages) and GraphBuilder; added graph command |
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Added graph builder integration, message handlers, showDependencyGraph method |
| `webview/src/main.ts` | Modified | Added graph view state, message handler, rendering functions |
| `webview/src/styles/main.css` | Modified | Added graph view CSS (header, legend, body, empty state) |
| `package.json` | Modified | Registered showDependencyGraph command |
| `docs/copilot-executions/17-implement-hover-cards-dependency-graph.md` | Created | This execution log |
