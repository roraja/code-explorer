# 04 — Caching Mechanism Deep Dive

**Date**: 2026-03-29
**Scope**: Complete documentation of how Code Explorer's caching system works — cache key resolution, file layout, read/write flows, lookup strategies across all trigger paths, serialization format, and related-symbol pre-caching.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Cache File Layout](#2-cache-file-layout)
3. [Cache Key Resolution](#3-cache-key-resolution)
4. [Trigger Paths and Cache Key Determination](#4-trigger-paths-and-cache-key-determination)
   - 4.1 [Ctrl+Shift+E (Explore Symbol command — cursor-based)](#41-ctrlshifte-explore-symbol-command--cursor-based)
   - 4.2 [Symbol Link Click (from webview)](#42-symbol-link-click-from-webview)
   - 4.3 [Programmatic Call (SymbolInfo passed directly)](#43-programmatic-call-symbolinfo-passed-directly)
   - 4.4 [Refresh / Retry (from webview tab button)](#44-refresh--retry-from-webview-tab-button)
   - 4.5 [Explore All File Symbols Command](#45-explore-all-file-symbols-command)
   - 4.6 [Enhance (Q&A) Flow](#46-enhance-qa-flow)
   - 4.7 [Hover Provider](#47-hover-provider)
   - 4.8 [CodeLens Provider](#48-codelens-provider)
   - 4.9 [Session Restore (window reload)](#49-session-restore-window-reload)
   - 4.10 [CodeLens Click (from editor annotation)](#410-codelens-click-from-editor-annotation)
5. [Cache Lookup Strategies](#5-cache-lookup-strategies)
   - 5.1 [Exact-Path Lookup (`read`)](#51-exact-path-lookup-read)
   - 5.2 [Fuzzy Cursor Lookup (`findByCursor`)](#52-fuzzy-cursor-lookup-findbycursor)
   - 5.3 [LLM-Assisted Fallback (`findByCursorWithLLMFallback`)](#53-llm-assisted-fallback-findbycursorwithllmfallback)
   - 5.4 [Batch Read (`readAllForFile`)](#54-batch-read-readallforfile)
6. [Serialization Format](#6-serialization-format)
7. [Pre-Caching Related Symbols](#7-pre-caching-related-symbols)
8. [Cache Hit/Miss Decision Logic](#8-cache-hitmiss-decision-logic)
9. [Cache Invalidation and Staleness](#9-cache-invalidation-and-staleness)
10. [Summary: Trigger → Lookup → Key Matrix](#10-summary-trigger--lookup--key-matrix)

---

## 1. Overview

Code Explorer caches every analyzed symbol as a **standalone markdown file** with YAML frontmatter. The cache serves two purposes:

1. **Avoid redundant LLM calls** — if a symbol has been analyzed before and the cache entry is fresh, the cached result is returned immediately (typically in < 50ms vs. 15–60 seconds for an LLM call).
2. **Human-readable artifacts** — cached files are valid markdown that can be browsed, searched, and version-controlled directly in `.vscode/code-explorer/`.

**Key implementation file**: `src/cache/CacheStore.ts`

**Cache root directory**: `<workspace>/.vscode/code-explorer/`

---

## 2. Cache File Layout

```
<workspace>/
└── .vscode/
    └── code-explorer/                        ← cache root
        └── <source-file-relative-path>/      ← mirrors source tree
            ├── fn.printBanner.md             ← top-level function
            ├── class.UserController.md       ← class
            ├── UserController.method.getUser.md  ← method with container
            ├── main.fn.helper.md             ← function with scope chain
            └── CacheStore.method._serialize.md  ← private method
```

Each source file gets its own subdirectory under the cache root, mirroring the workspace-relative path. Within that directory, each analyzed symbol gets one `.md` file named by its **cache key**.

---

## 3. Cache Key Resolution

The cache key determines the **file name** (without `.md`) of a cached analysis. It is built by `CacheStore._buildCacheKey(symbol: SymbolInfo)` using three layers of resolution:

### Algorithm (`_buildCacheKey`)

```typescript
_buildCacheKey(symbol: SymbolInfo): string {
  const prefix = SYMBOL_KIND_PREFIX[symbol.kind] || 'sym';  // e.g., "fn", "class", "method"

  // Priority 1: Scope chain (most precise)
  if (symbol.scopeChain && symbol.scopeChain.length > 0) {
    const chain = symbol.scopeChain.map(s => sanitize(s)).join('.');
    return `${chain}.${prefix}.${sanitize(symbol.name)}`;
  }

  // Priority 2: Container name (fallback for symbols without scope chain)
  if (symbol.containerName) {
    return `${sanitize(symbol.containerName)}.${prefix}.${sanitize(symbol.name)}`;
  }

  // Priority 3: Name only (top-level symbols)
  return `${prefix}.${sanitize(symbol.name)}`;
}
```

### Kind Prefix Map

| Symbol Kind | Prefix |
|-------------|--------|
| `class`     | `class` |
| `function`  | `fn` |
| `method`    | `method` |
| `variable`  | `var` |
| `interface` | `interface` |
| `type`      | `type` |
| `enum`      | `enum` |
| `property`  | `prop` |
| `parameter` | `param` |
| `struct`    | `struct` |
| `unknown`   | `sym` |

### Examples

| Symbol | Kind | Scope Chain | Container | Cache Key | File Path |
|--------|------|-------------|-----------|-----------|-----------|
| `printBanner` | function | `[]` | — | `fn.printBanner` | `src/main.cpp/fn.printBanner.md` |
| `getUser` | method | `["UserController"]` | `UserController` | `UserController.method.getUser` | `src/controllers/UserController.ts/UserController.method.getUser.md` |
| `_cacheRoot` | property | `["CacheStore"]` | `CacheStore` | `CacheStore.prop._cacheRoot` | `src/cache/CacheStore.ts/CacheStore.prop._cacheRoot.md` |
| `count` | variable | `["main", "processItems"]` | — | `main.processItems.var.count` | `src/main.ts/main.processItems.var.count.md` |
| `MyClass` | class | `[]` | — | `class.MyClass` | `src/models/MyClass.ts/class.MyClass.md` |
| `helper` | function | `["main"]` | — | `main.fn.helper` | `src/main.ts/main.fn.helper.md` |
| `_serialize` | method | `[]` | `CacheStore` | `CacheStore.method._serialize` | `src/cache/CacheStore.ts/CacheStore.method._serialize.md` |

### Full Disk Path

```
_resolvePath(symbol) = <cacheRoot> / <symbol.filePath> / <_buildCacheKey(symbol)>.md
```

Example:
```
/workspace/.vscode/code-explorer/src/cache/CacheStore.ts/CacheStore.method._serialize.md
```

### Name Sanitization

The `_sanitizeName()` method replaces unsafe characters for file systems:
- `<`, `>` → `_`
- `/`, `\`, `:`, `*`, `?`, `"` → `_`
- Whitespace → `_`
- Truncated to 200 characters max

---

## 4. Trigger Paths and Cache Key Determination

This section traces every user action that leads to a cache read or write, showing exactly how the cache key is determined in each case.

### 4.1 Ctrl+Shift+E (Explore Symbol command — cursor-based)

**This is the primary, most common flow.**

```
User places cursor on "myFunction" → presses Ctrl+Shift+E
  → extension.ts: gathers CursorContext {
      word: "myFunction",
      filePath: "src/app.ts",          (relative to workspace)
      position: { line: 42, character: 12 },
      surroundingSource: "...",         (±50 lines around cursor)
      cursorLine: "  const result = myFunction(data);"
    }
  → CodeExplorerViewProvider.openTabFromCursor(cursor)
  → AnalysisOrchestrator.analyzeFromCursor(cursor)
```

**Cache lookup**: **No cache key is computed directly** because the symbol kind is unknown at this point. Instead, a multi-tier fuzzy search is used:

1. **Tier 1 — `findByCursorWithLLMFallback(cursor, workspaceRoot)`**
   - First calls `findByCursor(word="myFunction", filePath="src/app.ts", cursorLine=42)`:
     - Scans all `.md` files in `.vscode/code-explorer/src/app.ts/`
     - Quick-parses each file's YAML frontmatter
     - Matches if: `symbol` field === `"myFunction"` **AND** `line` field is within **±3 lines** of `42`
     - Returns the first match (no cache key computation needed — it's a file-scan)

2. **Tier 2 — LLM-assisted fallback** (only if Tier 1 misses):
   - Calls `listCachedSymbols("src/app.ts")` to gather lightweight summaries of all cached symbols
   - Sends a lightweight Copilot CLI call (30s timeout) with the cursor context + cached symbol descriptions
   - LLM outputs `json:cache_match` with `matched_index` pointing to the correct cached symbol
   - If matched, reads that specific cache file by filename (no cache key computation)

3. **If no cache hit**: Full unified LLM analysis runs. The LLM response includes a `json:symbol_identity` block that provides the **kind**, **name**, **container**, and **scope chain**. A `SymbolInfo` is built:
   ```typescript
   resolvedSymbol = {
     name: identity.name,        // e.g., "myFunction"
     kind: identity.kind,        // e.g., "function"
     filePath: "src/app.ts",
     position: { line: 42, character: 12 },
     containerName: identity.container || undefined,
     scopeChain: identity.scopeChain,
   }
   ```
   **Cache key for writing**: Computed via `_buildCacheKey(resolvedSymbol)` → e.g., `fn.myFunction`
   **Cache file path**: `.vscode/code-explorer/src/app.ts/fn.myFunction.md`

**Key insight**: In the cursor-based flow, the cache key is **never needed for reading** — reads use fuzzy file scanning. The cache key is only computed for **writing** after the LLM responds with the symbol identity.

---

### 4.2 Symbol Link Click (from webview)

When a user clicks on a linked symbol name in the analysis text (e.g., clicking "parseResponse" in a sub-function list):

```
User clicks "<a class='symbol-link' data-symbol-name='parseResponse'
                data-symbol-file='src/llm/ResponseParser.ts'
                data-symbol-line='42'
                data-symbol-kind='function'>"
  → webview posts { type: 'exploreSymbol', symbolName, filePath, line, kind }
  → CodeExplorerViewProvider._handleMessage()
  → CodeExplorerViewProvider._exploreSymbolByName(name, filePath, line, kind)
```

**Symbol resolution in `_exploreSymbolByName`**:

1. If `filePath` and `line` are provided (most common case for link clicks):
   - Opens the document and queries `vscode.executeDocumentSymbolProvider`
   - Searches the symbol tree for a `DocumentSymbol` with matching `name`
   - If found: builds `SymbolInfo` from the `DocumentSymbol`'s range, kind (mapped from VS Code `SymbolKind`), and file path. The `kind` from the link data is preferred if provided.
   - If not found: falls back to using the provided `name`, `kind` (or `"function"`), `filePath`, and `line` directly

2. If only `symbolName` is provided (no file path):
   - Uses `vscode.executeWorkspaceSymbolProvider` to search across the workspace
   - Takes the first matching symbol

**Cache lookup**: Uses `viewProvider.openTab(symbolInfo, 'symbol-link')` → `orchestrator.analyzeSymbol(symbol)` → `cacheStore.read(symbol)` which does an **exact-path lookup** via `_resolvePath(symbol)`.

**Cache key**: Built from the resolved `SymbolInfo` — typically has `name`, `kind`, and `filePath`. The `scopeChain` is usually **empty** (since `_exploreSymbolByName` doesn't set it), and `containerName` may be set from `DocumentSymbol` data.

**Potential issue**: Since link clicks resolve via VS Code's symbol provider (not the LLM), the resulting `SymbolInfo` may lack a `scopeChain`. If the original analysis was cached with a scope chain (from the cursor-based flow), the cache key will differ and cause a **cache miss**, forcing a re-analysis via the legacy `analyzeSymbol` path.

---

### 4.3 Programmatic Call (SymbolInfo passed directly)

When the `exploreSymbol` command is invoked with a pre-built `SymbolInfo` object (e.g., from another extension or from CodeLens):

```
vscode.commands.executeCommand('codeExplorer.exploreSymbol', symbolInfo)
  → extension.ts: detects argument is a SymbolInfo (has name, kind, filePath, position)
  → CodeExplorerViewProvider.openTab(symbol)
  → AnalysisOrchestrator.analyzeSymbol(symbol)
  → CacheStore.read(symbol)  ← exact-path lookup
```

**Cache key**: Computed directly from the passed `SymbolInfo` via `_buildCacheKey(symbol)`. The key depends on whatever `name`, `kind`, `scopeChain`, and `containerName` the caller provides.

**Cache file path**: `_resolvePath(symbol)` = `<cacheRoot>/<filePath>/<cacheKey>.md`

---

### 4.4 Refresh / Retry (from webview tab button)

When the user clicks the refresh or retry button on a tab:

```
webview posts { type: 'refreshRequested', tabId } or { type: 'retryAnalysis', tabId }
  → CodeExplorerViewProvider._handleMessage()
  → Removes old tab
  → Calls viewProvider.openTab(tab.symbol)  ← reuses the existing SymbolInfo
  → AnalysisOrchestrator.analyzeSymbol(symbol, force=false)
  → CacheStore.read(symbol)  ← exact-path lookup with same SymbolInfo
```

**Cache key**: Same as the original tab's `SymbolInfo`. The `symbol` object is preserved from the original analysis, so the cache key is identical. If the analysis ran via the cursor-based flow and the LLM resolved the symbol with a scope chain, that scope chain is retained.

**Note**: `force` is `false` for refresh, so a cache hit will return the cached result. For a true re-analysis, the cache entry would need to be marked stale or manually cleared first.

---

### 4.5 Explore All File Symbols Command

```
User runs "Explore All File Symbols" command
  → extension.ts: reads editor document source
  → AnalysisOrchestrator.analyzeFile(filePath, fileSource)
  → Sends full file to LLM with buildFileAnalysis() prompt
  → ResponseParser.parseFileSymbolAnalyses()
  → For each symbol: builds SymbolInfo from parsed data, calls CacheStore.write()
```

**Cache key per symbol**: Built from the LLM's response data. The LLM provides `name`, `kind`, `filePath`, `line`, `container`, and `scopeChain` for each symbol. The `_buildCacheKey` runs on the constructed `SymbolInfo`.

**Dedup**: Before writing, each symbol is checked against the cache via `CacheStore.read(symbolInfo)`. If a non-stale LLM analysis already exists, the write is skipped to avoid overwriting potentially richer single-symbol analyses.

---

### 4.6 Enhance (Q&A) Flow

```
User clicks ✨ Enhance button → enters question
  → webview posts { type: 'enhanceAnalysis', tabId, userPrompt }
  → CodeExplorerViewProvider._handleEnhanceAnalysis(tabId, userPrompt)
  → AnalysisOrchestrator.enhanceAnalysis(existingResult, userPrompt)
  → Appends Q&A entry to result.qaHistory
  → CacheStore.write(updatedResult)
```

**Cache key**: Uses the **same `SymbolInfo`** from the existing tab's `analysis.symbol`. The cache key is identical to the original analysis — the file is overwritten in place with the updated Q&A history.

---

### 4.7 Hover Provider

```
User hovers over "myFunction" in editor
  → CodeExplorerHoverProvider.provideHover()
  → CacheStore.findByCursor(word, relPath, position.line)
```

**Cache lookup**: Uses the **fuzzy cursor lookup** — scans cache files for the source file, matching by name + ±3 line tolerance. No cache key is computed. If found, renders a compact hover card from cached data. **No LLM call is ever triggered** — hover is cache-only.

---

### 4.8 CodeLens Provider

```
User opens a file in editor
  → CodeExplorerCodeLensProvider.provideCodeLenses()
  → CacheStore.readAllForFile(relPath)
```

**Cache lookup**: Uses the **batch read** — reads all `.md` files from the cache directory for that source file, deserializes each one. No cache key is needed — it's a directory listing. Returns all cached analyses for that file to generate inline annotations.

---

### 4.9 Session Restore (window reload)

```
VS Code window reloads
  → CodeExplorerViewProvider._restoreSession()
  → For each persisted tab: CacheStore.read(persistedTab.symbol)
```

**Cache key**: Uses the `SymbolInfo` that was persisted in the session file (`_tab-session.json`). This `SymbolInfo` preserves the original `name`, `kind`, `filePath`, `position`, `scopeChain`, and `containerName` from when the tab was first analyzed. The exact-path lookup via `_buildCacheKey` is used.

---

### 4.10 CodeLens Click (from editor annotation)

```
User clicks a CodeLens annotation in the editor
  → Executes exploreSymbol command with SymbolInfo argument:
      { name: symbolName, kind: 'unknown', filePath, position: { line, character: 0 } }
```

**Cache key**: The `kind` is hardcoded to `'unknown'` by the CodeLens provider (see `_createCodeLens`), so the cache key prefix is `sym`. This means clicking a CodeLens for a function named `foo` generates cache key `sym.foo`, while the original analysis may have been cached as `fn.foo`. **This creates a cache miss** and the symbol goes through the `analyzeSymbol` legacy flow with `kind='unknown'`.

---

## 5. Cache Lookup Strategies

### 5.1 Exact-Path Lookup (`read`)

```typescript
async read(symbol: SymbolInfo): Promise<AnalysisResult | null>
```

- Computes exact file path: `_resolvePath(symbol)` → `_buildCacheKey(symbol)` → `<cacheRoot>/<filePath>/<key>.md`
- Attempts `fs.readFile()` at that exact path
- On success: deserializes the markdown content and returns `AnalysisResult`
- On file-not-found: returns `null` (cache miss)

**Used by**: `analyzeSymbol()` (legacy flow), session restore, pre-cache dedup checks, symbol link clicks.

**Pros**: O(1) lookup, very fast (single file read).
**Cons**: Requires knowing the exact `kind` and `scopeChain` — any mismatch means miss.

---

### 5.2 Fuzzy Cursor Lookup (`findByCursor`)

```typescript
async findByCursor(word: string, filePath: string, cursorLine: number):
  Promise<{ symbol: SymbolInfo; result: AnalysisResult } | null>
```

- Lists all `.md` files in `<cacheRoot>/<filePath>/`
- For each file, quick-parses YAML frontmatter to extract `symbol`, `kind`, `line`
- Matches if:
  - `symbol` === `word` (case-sensitive exact match)
  - `|line - cursorLine|` <= 3 (±3 line tolerance)
- Returns the **first** matching file's deserialized result

**Used by**: Cursor-based flow (Tier 1), hover provider.

**Pros**: Works without knowing the symbol kind; tolerates small line shifts from edits.
**Cons**: O(n) where n = number of cached symbols for that file; false positives possible with common variable names at nearby lines.

---

### 5.3 LLM-Assisted Fallback (`findByCursorWithLLMFallback`)

```typescript
async findByCursorWithLLMFallback(cursor: CursorContext, workspaceRoot: string):
  Promise<{ symbol: SymbolInfo; result: AnalysisResult } | null>
```

Two-tier approach:

**Tier 1**: Calls `findByCursor()` first (fast, ~1-5ms).

**Tier 2** (on Tier 1 miss):
1. Calls `listCachedSymbols(filePath)` to gather lightweight metadata for all cached symbols in that file (name, kind, line, scope chain, 150-char overview snippet)
2. Builds a matching prompt including the cursor's surrounding code context
3. Sends a lightweight Copilot CLI call with a 30-second timeout
4. LLM responds with `json:cache_match` containing `matched_index` (1-based) and confidence
5. If confident match: reads that specific cache file by filename and returns the deserialized result

**Used by**: Cursor-based flow (when workspace root is available).

**Pros**: Can match symbols even when the name at cursor differs from the cached symbol name (e.g., cursor on a usage/call site vs. definition), or when lines have shifted significantly.
**Cons**: 5–15 second latency for the LLM call; requires Copilot CLI availability.

---

### 5.4 Batch Read (`readAllForFile`)

```typescript
async readAllForFile(filePath: string): Promise<AnalysisResult[]>
```

- Lists all `.md` files in `<cacheRoot>/<filePath>/`
- For each file: parses frontmatter, constructs a `SymbolInfo`, deserializes the full content
- Returns all successfully deserialized results

**Used by**: CodeLens provider (needs all cached symbols for a file to generate annotations).

---

## 6. Serialization Format

Each cache file is a markdown document with the following structure:

### YAML Frontmatter

```yaml
---
symbol: printBanner           # Symbol name
kind: function                # Symbol kind
file: src/main.cpp            # Source file (relative path)
line: 10                      # Line number of definition (0-based)
scope_chain: "main"           # Dot-separated scope chain (optional)
analyzed_at: "2026-03-28T..." # ISO 8601 timestamp
analysis_version: "1.0.0"    # Cache format version
llm_provider: copilot-cli    # Which LLM generated this (optional)
source_hash: "sha256:abc..."  # Source file hash at analysis time (optional)
stale: false                  # Whether source has changed since analysis
---
```

### Body Sections (in serialization order)

| # | Section | Format | Description |
|---|---------|--------|-------------|
| 1 | `# kind name` | Heading | Title |
| 2 | `## Overview` | Markdown prose | AI-generated summary |
| 3 | `## Key Points` | Bullet list | Key observations |
| 4 | `## Callers` | Numbered list + `json:callers` | Who calls this symbol |
| 5 | `## Usage` | Table | All references across workspace |
| 6 | `## Relationships` | Bullet list | Type/dependency relationships |
| 7 | `## Data Flow` | Bullet list + `json:data_flow` | Data lifecycle steps |
| 8 | `## Variable Lifecycle` | `json:variable_lifecycle` | Declaration → mutation → consumption |
| 9 | `## Data Kind` | Prose + `json:data_kind` | What kind of data the variable holds |
| 10 | `## Class Members` | Bullet list + `json:class_members` | Fields, methods, properties |
| 11 | `## Member Access Patterns` | Bullet list + `json:member_access` | Read/write tracking |
| 12 | `## Diagrams` | Mermaid fences + `json:diagrams` | Visual flow diagrams |
| 13 | `## Step-by-Step Breakdown` | Numbered list + `json:steps` | Function execution steps |
| 14 | `## Sub-Functions` | Bullet list + `json:subfunctions` | Called functions with I/O |
| 15 | `## Function Input` | Bullet list + `json:function_inputs` | Parameters with types/mutation info |
| 16 | `## Function Output` | Prose + `json:function_output` | Return type details |
| 17 | `## Dependencies` | Bullet list | External dependencies |
| 18 | `## Usage Pattern` | Prose | Suggested usage pattern |
| 19 | `## Potential Issues` | Bullet list | AI-detected issues |
| 20 | `## Q&A` | Per-entry heading + `json:qa_history` | User Q&A from Enhance |

### Dual-Format Pattern

Most sections use a **dual-format** approach:
- **Human-readable** markdown (headings, bullet lists, prose) for browsing
- **Machine-readable** JSON blocks (````json:<tag>` ``` fences) for deserialization

The `_deserialize()` method reads the JSON blocks for structured data and the markdown sections for prose content (overview, usage pattern, etc.).

---

## 7. Pre-Caching Related Symbols

During analysis, the LLM may discover and briefly analyze related symbols. These are cached immediately to save future LLM calls.

### Two Pre-Cache Formats

1. **Legacy format** (`json:related_symbols`): Parsed via `ResponseParser.parse()` into `AnalysisResult.relatedSymbols`. Each entry has `name`, `kind`, `filePath`, `line`, `overview`, and optional key points. Cached via `_cacheRelatedSymbols()`.

2. **New format** (`json:related_symbol_analyses`): Parsed via `ResponseParser.parseRelatedSymbolCacheEntries()`. Each entry includes `cache_file_path`, `name`, `kind`, `filePath`, `line`, `container`, `scopeChain`, and analysis content. Cached via `_cacheRelatedSymbolAnalyses()`.

### Pre-Cache Dedup

Before writing a pre-cached entry, the orchestrator checks:
```typescript
const existing = await this._cache.read(relatedSymbolInfo);
if (existing && !existing.metadata.stale) {
  continue;  // Don't overwrite richer single-symbol analyses
}
```

This ensures pre-cached entries (which are brief summaries) never replace full dedicated analyses.

---

## 8. Cache Hit/Miss Decision Logic

A cache hit is returned only if **all three conditions** are met:

```typescript
if (cached && !cached.metadata.stale && cached.metadata.llmProvider) {
  return cached;  // CACHE HIT
}
```

| Condition | Rationale |
|-----------|-----------|
| `cached` is non-null | File exists and was successfully deserialized |
| `!metadata.stale` | Source file hasn't changed since analysis (not yet enforced — always `false` currently) |
| `metadata.llmProvider` is truthy | Analysis was performed by an LLM, not just static analysis (placeholder data) |

### Cache Miss Scenarios

| Scenario | What happens |
|----------|-------------|
| No cache file at the computed path | `read()` returns `null` → full LLM analysis |
| Cache file exists but `stale: true` | Treated as miss → re-analysis with LLM |
| Cache file exists but no `llm_provider` | Static-only result → re-analysis with LLM |
| `findByCursor` scans but no name+line match | Falls through to Tier 2 (LLM fallback) or full analysis |
| Kind mismatch (link click vs. original) | `_buildCacheKey` generates different path → miss → re-analysis |

---

## 9. Cache Invalidation and Staleness

### Current State

Cache invalidation is **minimal** in the current implementation:

| Feature | Status |
|---------|--------|
| `metadata.stale` field | Exists in schema, always set to `false` on write |
| `sourceHash` field | Exists in frontmatter, always empty string (`""`) |
| File watcher → invalidation | Not implemented |
| TTL expiration | Not implemented (setting exists: `cacheTTLHours`, default 168h) |
| Size limits | Not implemented |
| Manual clear | Implemented: `codeExplorer.clearCache` command deletes entire cache root |

### Planned (Not Yet Implemented)

From `docs/05-implementation_plan.md`:
- **HashService**: SHA-256 hashing for source file change detection
- **CacheManager**: TTL enforcement, size limits, batch invalidation
- **IndexManager**: Master index at `_index.json` for O(1) lookups and file-level invalidation
- **File watcher pipeline**: Detect source file changes → mark affected cache entries as stale

---

## 10. Summary: Trigger → Lookup → Key Matrix

| # | Trigger | Entry Point | Lookup Method | Cache Key Computed? | Notes |
|---|---------|-------------|---------------|---------------------|-------|
| 1 | **Ctrl+Shift+E** (cursor) | `openTabFromCursor` → `analyzeFromCursor` | `findByCursorWithLLMFallback` (fuzzy + LLM) | Only for **write** (after LLM resolves kind) | Primary flow; kind unknown until LLM responds |
| 2 | **Symbol link click** | `_exploreSymbolByName` → `openTab` → `analyzeSymbol` | `read` (exact path) | Yes — from VS Code symbol resolution | May miss if scope chain differs from original |
| 3 | **Programmatic call** | `openTab` → `analyzeSymbol` | `read` (exact path) | Yes — from caller-provided SymbolInfo | Depends on caller accuracy |
| 4 | **Refresh/Retry** | `openTab` (same SymbolInfo) → `analyzeSymbol` | `read` (exact path) | Yes — reuses original SymbolInfo | Same key as original; `force=false` |
| 5 | **Explore All File Symbols** | `analyzeFile` | `read` per symbol (dedup check) | Yes — from LLM-parsed identity | One LLM call for all symbols in file |
| 6 | **Enhance (Q&A)** | `enhanceAnalysis` | No read (uses existing result in memory) | Yes — same key for **write** | Overwrites same cache file with Q&A |
| 7 | **Hover** | `provideHover` | `findByCursor` (fuzzy) | No | Cache-only; no LLM call triggered |
| 8 | **CodeLens display** | `provideCodeLenses` | `readAllForFile` (batch) | No | Reads all cached symbols for file |
| 9 | **Session restore** | `_restoreTabsAsync` | `read` (exact path) | Yes — from persisted SymbolInfo | Preserved from original analysis |
| 10 | **CodeLens click** | `exploreSymbol` command with SymbolInfo | `read` (exact path) | Yes — but `kind='unknown'` → `sym.` prefix | Likely cache miss vs. original `fn.`/`class.` key |
| 11 | **Pre-cache (related)** | `_cacheRelatedSymbols` | `read` per symbol (dedup check) | Yes — from LLM-discovered data | Never overwrites richer existing analyses |

---

### Known Cache Key Mismatches

1. **CodeLens click → cache miss**: CodeLens hardcodes `kind: 'unknown'` → key prefix `sym.` instead of actual kind prefix. The symbol goes through `analyzeSymbol` legacy flow which will likely miss the cache and trigger re-analysis.

2. **Symbol link click → scope chain mismatch**: Links resolved via `vscode.executeDocumentSymbolProvider` typically lack a `scopeChain`. If the original was cached with a scope chain (from cursor-based flow), the keys differ:
   - Original: `main.processItems.var.count.md`
   - Link click: `var.count.md` (no scope chain)

3. **Container name vs. scope chain**: `_buildCacheKey` uses `containerName` only when `scopeChain` is empty. If one path sets `containerName` and another sets `scopeChain`, the keys may differ even for the same symbol.
