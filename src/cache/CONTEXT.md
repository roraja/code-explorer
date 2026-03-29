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
