# src/providers/

Symbol resolution — translating a cursor position into a `SymbolInfo` object.

## Modules

| File | Contains |
|------|----------|
| `SymbolResolver.ts` | `SymbolResolver` class — resolves the code symbol at a given cursor position |

## How SymbolResolver Works

1. Queries `vscode.executeDocumentSymbolProvider` to get the document's symbol tree
2. Walks the tree with `_findDeepest()` to find the most specific symbol containing the cursor position
3. Builds a **scope chain** (ancestor names from root to parent) for unique identification
4. If the cursor is inside a function/class but not on its name, tries `vscode.executeDefinitionProvider` to resolve local variables/parameters
5. Falls back to `document.getWordRangeAtPosition()` as last resort (returns `kind: 'unknown'`)

## Key Design Decisions

- **Scope chain**: Used as the primary axis for cache key resolution and tab deduplication. Two variables with the same name in different functions get different scope chains and thus different cache entries.
- **Definition provider fallback**: Local variables don't appear as `DocumentSymbol` children in all language servers. The definition provider catches these.
- **Kind mapping**: Maps VS Code's numeric `SymbolKind` to string identifiers (`'class'`, `'function'`, `'method'`, etc.) via `_mapSymbolKind()`.

## Inputs / Outputs

- **Input**: `TextDocument` + `Position` (from active editor cursor)
- **Output**: `SymbolInfo | null`
