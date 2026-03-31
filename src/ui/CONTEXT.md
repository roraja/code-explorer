# src/ui/

Sidebar webview view provider and tab session persistence — the extension-side controller for the Code Explorer panel.

## Modules

| File | Role |
|------|------|
| `CodeExplorerViewProvider.ts` | `WebviewViewProvider` implementation. Owns all tab state, navigation history, pinned investigations. Routes webview messages, triggers analysis and enhance. Supports cursor-based, legacy symbol-based, dependency graph, and Q&A enhance tab flows. |
| `TabSessionStore.ts` | Persists and restores tab sessions (which tabs are open, which is active, navigation history, pinned investigations) to `.vscode/code-explorer-logs/tab-session.json` so tabs survive window reloads. |

## Architecture

The extension side is the **single source of truth** for all tab state. On every mutation (tab open, close, analysis result, enhance result, error), the full state snapshot is pushed to the webview via a single `setState` message. The webview is a pure renderer.

## CodeExplorerViewProvider — Key Members

### Private State

- `_tabs: TabState[]` — all open tabs
- `_activeTabId: string | null` — currently focused tab
- `_tabCounter: number` — monotonic counter for tab IDs
- `_webviewReady: boolean` — whether the webview has sent `ready`
- `_sessionStore: TabSessionStore | null` — persists tabs to disk
- `_cacheStore: CacheStore | null` — for restoring analysis from cache on session reload
- `_sessionRestored: boolean` — prevents double-restore
- `_navigationHistory: NavigationEntry[]` — ordered navigation steps
- `_navigationIndex: number` — current position in history stack (-1 = empty)
- `_pinnedInvestigations: PinnedInvestigation[]` — saved breadcrumb trails
- `_graphBuilder: GraphBuilder | null` — set via `setGraphBuilder()`

### Key Methods

| Method | Description |
|--------|-------------|
| `resolveWebviewView()` | Sets up webview HTML, CSP, message listener, visibility tracking, restores session |
| `openTab(symbol, trigger?)` | Opens/focuses a tab for a pre-resolved `SymbolInfo`, deduplicates by scope chain, triggers `analyzeSymbol`, records navigation |
| `openTabFromCursor(cursor)` | Opens a tab from `CursorContext` — creates tab with `kind='unknown'`, triggers `analyzeFromCursor`, updates tab with resolved symbol on completion |
| `showDependencyGraph(mermaidSource, nodeCount, edgeCount)` | Sends dependency graph Mermaid source to webview for rendering |
| `setGraphBuilder(graphBuilder)` | Injects the GraphBuilder for webview-initiated graph requests |
| `_pushState()` | Sends full `{tabs, activeTabId, navigationHistory}` to webview. Deferred if webview not ready. Also saves session to disk. |
| `_handleMessage()` | Routes incoming webview messages (see message protocol below) |
| `_handleEnhanceAnalysis()` | Handles Q&A enhance requests — sets tab to loading, calls `orchestrator.enhanceAnalysis()`, updates tab with enhanced result |
| `_exploreSymbolByName()` | Resolves a symbol by name (from webview click), opens tab for it |
| `_navigateToSource()` | Opens file and scrolls to position in the editor |
| `_recordNavigation()` | Adds a NavigationEntry to history, truncating forward history if needed |
| `_historyBack() / _historyForward()` | Navigates back/forward in history stack |
| `_getHtmlForWebview()` | Generates HTML with CSP, loads `webview/dist/main.js` + `main.css` |

## Tab Creation Flows

### Primary: `openTabFromCursor(cursor)`

1. Creates a temporary tab with `kind='unknown'` and `loadingStage='resolving-symbol'`
2. Calls `orchestrator.analyzeFromCursor(cursor)` — single LLM call resolves kind + analysis
3. Updates tab with resolved `SymbolInfo` and `AnalysisResult` on completion
4. Records navigation entry with trigger `'explore-command'`
5. On error, sets tab status to `'error'`

### Legacy: `openTab(symbol, trigger?)`

1. Deduplicates by `filePath + name + scopeChain` comparison
2. Creates tab with known `SymbolInfo` and `loadingStage='cache-check'`
3. Calls `orchestrator.analyzeSymbol(symbol)`
4. Records navigation entry
5. Updates tab on completion

### Enhance: `_handleEnhanceAnalysis(tabId, userPrompt)`

1. Finds the tab by ID, verifies it has an existing analysis
2. Sets `enhancing: true` on the tab (keeps existing analysis visible)
3. Calls `orchestrator.enhanceAnalysis(tab.analysis, userPrompt)`
4. Updates tab with enhanced result (includes Q&A history)
5. On error, reverts to `ready` state (preserves existing analysis)

## Tab State

```typescript
interface TabState {
  id: string;                    // "tab-1", "tab-2", ...
  symbol: SymbolInfo;
  status: 'loading' | 'ready' | 'error' | 'stale';
  analysis: AnalysisResult | null;
  error?: string;
  loadingStage?: LoadingStage;
  enhancing?: boolean;           // True during Q&A request
  notes?: string;                // User-added notes
}
```

**Tab deduplication**: `openTab()` matches by `filePath` + `name` + full scope chain comparison. Same symbol = focus existing tab. Error/stale tabs are removed and recreated.

## Navigation History

Navigation entries record every step in the user's exploration journey:
- Each `openTab()` / `openTabFromCursor()` call records a `NavigationEntry` with the trigger type
- Back/forward navigation via `historyBack` / `historyForward` messages
- Pinned investigations save named breadcrumb trails for later restoration
- History + investigations are persisted in the tab session file

## TabSessionStore

Persists tab sessions to `.vscode/code-explorer-logs/tab-session.json`:

```typescript
interface TabSession {
  version: 1;
  savedAt: string;
  tabs: PersistedTab[];          // Only ready tabs with analysis
  activeTabId: string | null;
  navigationHistory?: NavigationEntry[];
  navigationIndex?: number;
  pinnedInvestigations?: PinnedInvestigation[];
}
```

- `save()` — synchronous write (avoids race conditions with rapid state changes)
- `load()` — reads and validates session file, filters invalid tabs
- `clear()` — deletes session file

Session is restored in `resolveWebviewView()` by reading cache for each persisted tab.

## Message Protocol

| Direction | Message Type | Purpose |
|-----------|-------------|---------|
| Extension -> Webview | `setState` | Push full state (tabs + activeTabId + navigationHistory) |
| Extension -> Webview | `showDependencyGraph` | Push Mermaid source for graph rendering |
| Webview -> Extension | `ready` | Webview initialized, trigger initial state push |
| Webview -> Extension | `tabClicked` | User clicked a tab |
| Webview -> Extension | `tabClosed` | User closed a tab |
| Webview -> Extension | `navigateToSource` | User clicked a file:line reference |
| Webview -> Extension | `refreshRequested` | User clicked refresh on a tab |
| Webview -> Extension | `retryAnalysis` | User clicked retry on an error tab |
| Webview -> Extension | `exploreSymbol` | User clicked a symbol link in the analysis |
| Webview -> Extension | `navigateToSymbol` | User clicked a symbol name to navigate |
| Webview -> Extension | `enhanceAnalysis` | User submitted a Q&A prompt via the ✨ Enhance dialog |
| Webview -> Extension | `requestDependencyGraph` | User requested dependency graph |
| Webview -> Extension | `requestSymbolGraph` | User requested symbol-focused subgraph |
| Webview -> Extension | `closeDependencyGraph` | User closed the dependency graph view |
| Webview -> Extension | `historyBack` | Navigate backward in history |
| Webview -> Extension | `historyForward` | Navigate forward in history |
| Webview -> Extension | `pinInvestigation` | Save current breadcrumb trail with a name |
| Webview -> Extension | `unpinInvestigation` | Remove a pinned investigation |
| Webview -> Extension | `restoreInvestigation` | Restore a pinned investigation |
| Webview -> Extension | `reorderTabs` | User dragged tabs to reorder |
| Webview -> Extension | `updateNotes` | User edited notes on a tab |
| Webview -> Extension | `saveInvestigation` | Save current investigation state |
| Webview -> Extension | `saveInvestigationAs` | Save with a new name |
| Webview -> Extension | `renameInvestigation` | Rename current investigation |

## CSP (Content Security Policy)

The webview enforces CSP:
- `default-src 'none'`
- `style-src` uses `'unsafe-inline'` (required for mermaid diagram rendering which injects inline styles)
- `script-src` uses nonce
- `img-src` and `font-src` from webview source only
