# src/providers/

Legacy symbol resolution — translating a cursor position into a `SymbolInfo` object via VS Code's document symbol provider.

**⚠️ Not the primary flow**: As of the unified prompt architecture, `SymbolResolver` is **no longer imported by `extension.ts`**. Symbol resolution is now handled by the LLM via `PromptBuilder.buildUnified()`. This file is preserved for potential future use or programmatic callers.

## Modules

| File | Contains |
|------|----------|
| `SymbolResolver.ts` | `SymbolResolver` class — resolves the code symbol at a given cursor position using VS Code APIs |

## How SymbolResolver Works (Legacy)

1. Queries `vscode.executeDocumentSymbolProvider` to get the document's symbol tree
2. Walks the tree with `_findDeepest()` to find the most specific symbol containing the cursor position
3. Builds a **scope chain** (ancestor names from root to parent) for unique identification
4. If the cursor is inside a function/class but not on its name, tries `vscode.executeDefinitionProvider` to resolve local variables/parameters
5. Falls back to `document.getWordRangeAtPosition()` as last resort (returns `kind: 'unknown'`)

## Why It Was Replaced

- `vscode.executeDocumentSymbolProvider` is **slow on large codebases** — the language server must index the entire document
- `vscode.executeDefinitionProvider` adds another round-trip
- The new flow gathers a lightweight `CursorContext` (word + ±50 lines) and sends it to the LLM in a single call, which both identifies the symbol kind and performs analysis

## Inputs / Outputs

- **Input**: `TextDocument` + `Position` (from active editor cursor)
- **Output**: `SymbolInfo | null`
