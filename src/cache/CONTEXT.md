# src/cache/

Markdown-based cache layer — reads and writes analysis results as markdown files with YAML frontmatter.

## Modules

| File | Role |
|------|------|
| `CacheStore.ts` | Primary cache implementation: read, write, clear, findByCursor (fuzzy lookup), serialize, deserialize. Used by `AnalysisOrchestrator`. |
| `CacheWriter.ts` | Earlier/alternative writer with simpler serialization. Not used by the main pipeline (superseded by `CacheStore`). |

## Cache File Format

Each analyzed symbol gets a markdown file at:
```
.vscode/code-explorer/<source-path>/<scope-chain>.<kind>.<Name>.md
```

Example: `.vscode/code-explorer/src/main.cpp/fn.printBanner().md`

### Structure

```markdown
---
symbol: printBanner
kind: function
file: src/main.cpp
line: 10
scope_chain: "main"
analyzed_at: "2026-03-28T..."
analysis_version: "1.0.0"
llm_provider: copilot-cli
stale: false
---

# function printBanner

## Overview
...

## Key Points
- ...

## Data Kind (for variables)
**Cache / Lookup Table**
...

## Callers
1. **main** -- `src/main.cpp:42` -- main() -> printBanner()

```json:callers
[{"name": "main", "filePath": "src/main.cpp", "line": 42, ...}]
```

...more sections...
```

## Read Methods

### `read(symbol)` — Exact-Path Lookup

Computes the exact cache file path from the symbol's kind, name, and scope chain via `_buildCacheKey()`. Returns `AnalysisResult | null`. Used by the legacy `analyzeSymbol` flow and for pre-cache dedup checks.

### `findByCursor(word, filePath, cursorLine)` — Fuzzy Cursor Lookup

Used by the primary `analyzeFromCursor` flow where the symbol kind is not yet known. Scans the cache directory for the source file and inspects each `.md` file's YAML frontmatter:

1. Lists all `.md` files in `.vscode/code-explorer/<filePath>/`
2. For each file, quick-parses frontmatter: `symbol`, `kind`, `line`
3. Matches if symbol name equals `word` AND line is within **±3 lines** of cursor
4. Returns `{ symbol: SymbolInfo, result: AnalysisResult } | null`

Includes extensive debug logging at every step (directory listing, each file checked, name/line comparisons, match details).

### `listCachedSymbols(filePath)` — Lightweight Metadata Scan

Lists all cached symbols for a given source file by reading YAML frontmatter + a short overview snippet (~150 chars) from each `.md` cache file. Returns `CachedSymbolSummary[]`. Used by the LLM-assisted cache fallback to describe available cached symbols to the LLM.

### `findByCursorWithLLMFallback(cursor, workspaceRoot)` — Smart Cache Lookup

Two-tier cache lookup used as the primary entry point in `analyzeFromCursor`:

1. **Tier 1**: Calls `findByCursor(word, filePath, cursorLine)` — fast, exact name + ±3 lines.
2. **Tier 2** (on miss): If `listCachedSymbols` finds any cached symbols for this file, sends a **lightweight Copilot CLI call** (30s timeout, `--yolo -s`) with the cursor context and a numbered list of cached symbol descriptions. The LLM outputs a `json:cache_match` block identifying which cached symbol (if any) matches the cursor. On match, deserializes and returns the cached result.
3. If both tiers miss, returns `null` — the orchestrator proceeds with full LLM analysis.

The Tier 2 LLM call is cheap and fast because it only asks the LLM to match against a short list of descriptions — no code analysis is performed. This avoids expensive full re-analysis when the user clicks on a reference/usage of a previously-analyzed symbol, or when line numbers have shifted slightly due to edits.

## Cache Key Resolution

`_buildCacheKey(symbol)` builds a unique key from:
1. **Scope chain** (if present): `scopeA.scopeB.kind.Name`
2. **Container name** (fallback): `Container.kind.Name`
3. **Name only**: `kind.Name`

This ensures local variables in different functions get distinct cache files.

## Serialization Round-Trip

| Write (`_serialize`) | Read (`_deserialize`) |
|---------------------|----------------------|
| YAML frontmatter with metadata | `_parseFrontmatter()` extracts key-value pairs |
| Markdown sections with headings | `_extractSections()` keys by heading text |
| `json:callers` fenced blocks | `_parseCallersJson()` |
| `json:data_flow`, `json:class_members`, `json:member_access` | `_parseJsonBlock<T>()` |
| `json:variable_lifecycle`, `json:data_kind` | `_parseJsonObjectBlock<T>()` |
| Bullet lists (key points, deps, issues) | `_parseList()` |

## Not Yet Implemented

From `docs/05-implementation_plan.md`:
- **CacheManager**: High-level cache operations (TTL, size limits, batch invalidation)
- **IndexManager**: Master index at `.vscode/code-explorer/_index.json` for O(1) lookups
- **HashService**: SHA-256 hashing for staleness detection
- **CacheKeyResolver**: Advanced key resolution with disambiguation
- **File watcher pipeline**: Detect file changes -> invalidate affected cache entries
