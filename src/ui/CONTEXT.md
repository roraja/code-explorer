# src/ui/

Sidebar webview view provider — the extension-side controller for the Code Explorer panel.

## Modules

| File | Role |
|------|------|
| `CodeExplorerViewProvider.ts` | `WebviewViewProvider` implementation. Owns all tab state, routes webview messages, triggers analysis and enhance. Supports cursor-based, legacy symbol-based, and Q&A enhance tab flows. |

## Architecture

The extension side is the **single source of truth** for all tab state. On every mutation (tab open, close, analysis result, enhance result, error), the full state snapshot is pushed to the webview via a single `setState` message. The webview is a pure renderer.

## Key Methods

| Method | Description |
|--------|-------------|
| `resolveWebviewView()` | Sets up webview HTML, CSP, message listener, visibility tracking |
| `openTab(symbol)` | Opens/focuses a tab for a pre-resolved `SymbolInfo`, deduplicates by scope chain, triggers `analyzeSymbol` |
| `openTabFromCursor(cursor)` | Opens a tab from `CursorContext` — creates tab with `kind='unknown'`, triggers `analyzeFromCursor`, updates tab with resolved symbol on completion |
| `_pushState()` | Sends full `{tabs, activeTabId}` to webview. Deferred if webview not ready. |
| `_handleMessage()` | Routes incoming webview messages: ready, tabClicked, tabClosed, navigateToSource, refreshRequested, retryAnalysis, exploreSymbol, enhanceAnalysis |
| `_handleEnhanceAnalysis()` | Handles Q&A enhance requests — sets tab to loading, calls `orchestrator.enhanceAnalysis()`, updates tab with enhanced result |
| `_exploreSymbolByName()` | Resolves a symbol by name (from webview click), opens tab for it |
| `_navigateToSource()` | Opens file and scrolls to position in the editor |
| `_getHtmlForWebview()` | Generates HTML with CSP, loads `webview/dist/main.js` + `main.css` |

## Tab Creation Flows

### Primary: `openTabFromCursor(cursor)`

1. Creates a temporary tab with `kind='unknown'` and `loadingStage='resolving-symbol'`
2. Calls `orchestrator.analyzeFromCursor(cursor)` — single LLM call resolves kind + analysis
3. Updates tab with resolved `SymbolInfo` and `AnalysisResult` on completion
4. On error, sets tab status to `'error'`

### Legacy: `openTab(symbol)`

1. Deduplicates by `filePath + name + scopeChain` comparison
2. Creates tab with known `SymbolInfo` and `loadingStage='cache-check'`
3. Calls `orchestrator.analyzeSymbol(symbol)`
4. Updates tab on completion

### Enhance: `_handleEnhanceAnalysis(tabId, userPrompt)`

1. Finds the tab by ID, verifies it has an existing analysis
2. Sets tab to `loading` state with `loadingStage='llm-analyzing'` (keeps existing analysis visible)
3. Calls `orchestrator.enhanceAnalysis(tab.analysis, userPrompt)`
4. Updates tab with enhanced result (includes Q&A history)
5. On error, reverts to `ready` state (preserves existing analysis)

## Tab State Management

```typescript
interface TabState {
  id: string;                    // "tab-1", "tab-2", ...
  symbol: SymbolInfo;
  status: 'loading' | 'ready' | 'error' | 'stale';
  analysis: AnalysisResult | null;
  error?: string;
  loadingStage?: LoadingStage;   // resolving-symbol, cache-check, reading-source, llm-analyzing, writing-cache
}
```

**Tab deduplication**: `openTab()` matches by `filePath` + `name` + full scope chain comparison. Same symbol = focus existing tab. Error/stale tabs are removed and recreated.

## Message Protocol

| Direction | Message Type | Purpose |
|-----------|-------------|---------|
| Extension -> Webview | `setState` | Push full state (tabs + activeTabId) |
| Webview -> Extension | `ready` | Webview initialized, trigger initial state push |
| Webview -> Extension | `tabClicked` | User clicked a tab |
| Webview -> Extension | `tabClosed` | User closed a tab |
| Webview -> Extension | `navigateToSource` | User clicked a file:line reference |
| Webview -> Extension | `refreshRequested` | User clicked refresh on a tab |
| Webview -> Extension | `retryAnalysis` | User clicked retry on an error tab |
| Webview -> Extension | `exploreSymbol` | User clicked a symbol link in the analysis |
| Webview -> Extension | `enhanceAnalysis` | User submitted a Q&A prompt via the ✨ Enhance dialog |

## CSP (Content Security Policy)

The webview enforces CSP:
- `default-src 'none'`
- `style-src` uses `'unsafe-inline'` (required for mermaid diagram rendering which injects inline styles)
- `script-src` uses nonce
- `img-src` and `font-src` from webview source only
