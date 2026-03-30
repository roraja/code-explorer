# Indexing Module — CONTEXT.md

## What This Module Does

The `src/indexing/` module provides **deterministic, AST-based symbol indexing** using [tree-sitter](https://tree-sitter.github.io/). It parses source files into syntax trees, extracts symbol definitions (functions, classes, methods, variables, etc.), and builds an in-memory index with multiple lookup strategies.

## Why It Exists

The extension previously relied on VS Code's document symbol provider (slow, requires VS Code runtime) and LLM-based identification (non-deterministic, expensive) to identify symbols. This module provides a fast (<10ms per file), deterministic alternative that produces stable **symbol addresses** — unique identifiers derived from AST structure, not line numbers.

## Key Concepts

### Symbol Address

A deterministic string that uniquely identifies any symbol in the workspace:

```
<filePath>#<scopeChain>::<kindPrefix>.<symbolName>[~<overloadDiscriminator>]
```

Examples:
- `src/main.cpp#fn.printBanner`
- `src/main.cpp#main::var.logger`
- `include/Logger.h#app::Logger::method.log~a3f2` (overloaded)

Addresses are derived from **AST structure** (name, scope chain, kind, parameter types), never from line numbers. This ensures stability across comments, whitespace changes, and code reordering.

### Overload Discrimination

When multiple symbols share the same `file#scope::kind.name` (e.g., C++ function overloads), a 4-character hex discriminator derived from the parameter signature hash is appended: `~XXXX`. See `SymbolAddress.computeDiscriminator()`.

## File Inventory

| File | Purpose |
|------|---------|
| `SymbolAddress.ts` | Address construction (`buildAddress`), parsing (`parseAddress`), discriminator computation, cache path derivation |
| `SymbolIndex.ts` | In-memory index with 4 lookup maps (byAddress, byName, byFile, byFileSorted), JSON persistence to `_symbol_index.json` |
| `TreeSitterParser.ts` | Manages tree-sitter `Parser` instances per language. Lazy init, caches parsers. Maps file extensions to languages. |
| `extractors/BaseExtractor.ts` | Abstract base class: raw symbol extraction → overload discriminator assignment pipeline |
| `extractors/CppExtractor.ts` | C++ AST walker: namespaces, classes, structs, functions, variables, enums, fields, overloads |
| `extractors/TypeScriptExtractor.ts` | TypeScript AST walker: classes, interfaces, types, enums, functions, arrow functions, methods, properties, local variables |

## Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `tree-sitter` | `0.22.4` | Native Node.js binding for incremental parsing |
| `tree-sitter-cpp` | `0.23.4` | C/C++ grammar |
| `tree-sitter-typescript` | `0.23.2` | TypeScript/TSX grammar (also handles JS/JSX) |

These are marked as `external` in `esbuild.config.mjs` since they contain native `.node` addons that can't be bundled.

## Data Flow

```
Source file content
  → TreeSitterParser.parse(filePath, content)
    → tree-sitter AST (Parser.Tree)
      → CppExtractor.extract(rootNode, filePath, hash)
         or TypeScriptExtractor.extract(...)
        → RawExtractedSymbol[]  (no discriminators yet)
          → BaseExtractor._resolveEntries()
            → detects overloads, assigns discriminators
              → SymbolIndexEntry[]
                → SymbolIndex.addFileEntries(filePath, entries, hash)
                  → populates byAddress, byName, byFile, byFileSorted maps
```

## Lookup Strategies

| Method | Key | Time | Use Case |
|--------|-----|------|----------|
| `getByAddress(addr)` | Full address string | O(1) | Direct cache lookup when address is known |
| `getByName(name)` | Symbol name | O(1)* | Link resolution (may return multiple — overloads, same name different files) |
| `getByFile(filePath)` | File path | O(1) | File-level operations (list all symbols, invalidate) |
| `resolveAtCursor(file, line, col)` | File + position | O(n) scan | Ctrl+Shift+E: resolve what the cursor is on |

*O(1) for the map lookup; the returned array may need filtering.

## Not Yet Implemented (Phase 2+)

- Integration with `AnalysisOrchestrator` (Phase 2)
- Symbol link resolution in webview (Phase 3)
- File watcher → incremental re-indexing (Phase 4)
- Python/Java/C# extractors (Phase 5)

## Testing

Unit tests are in `test/unit/indexing/`:
- `SymbolAddress.test.ts` — address build/parse round-trips, discriminator, cache path derivation
- `SymbolIndex.test.ts` — insert, lookup, remove, cursor resolution, persistence
- `Extractors.test.ts` — C++ and TypeScript symbol extraction, overloads, code-change resilience
