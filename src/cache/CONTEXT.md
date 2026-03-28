# src/cache/

Markdown-based cache layer — reads and writes analysis results as markdown files with YAML frontmatter.

## Modules

| File | Role |
|------|------|
| `CacheStore.ts` | Primary cache implementation: read, write, clear, serialize, deserialize. Used by `AnalysisOrchestrator`. |
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

## Callers
1. **main** -- `src/main.cpp:42` -- main() -> printBanner()

```json:callers
[{"name": "main", "filePath": "src/main.cpp", "line": 42, ...}]
```

...more sections...
```

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
| `json:variable_lifecycle` | `_parseJsonObjectBlock<T>()` |
| Bullet lists (key points, deps, issues) | `_parseList()` |

## Not Yet Implemented

From `docs/05-implementation_plan.md`:
- **CacheManager**: High-level cache operations (TTL, size limits, batch invalidation)
- **IndexManager**: Master index at `.vscode/code-explorer/_index.json` for O(1) lookups
- **HashService**: SHA-256 hashing for staleness detection
- **CacheKeyResolver**: Advanced key resolution with disambiguation
- **File watcher pipeline**: Detect file changes -> invalidate affected cache entries
