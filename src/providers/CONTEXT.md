# src/providers/

VS Code-specific providers — hover cards, CodeLens annotations, diagnostic commands, source reading, and legacy symbol resolution.

## Modules

| File | Role |
|------|------|
| `CodeExplorerHoverProvider.ts` | Shows cached analysis preview on symbol hover. No LLM calls — cache-only. Controlled by `codeExplorer.showHoverCards` (default: true). |
| `CodeExplorerCodeLensProvider.ts` | Shows inline annotations (overview, steps, data flow, issues) above analyzed symbols. Cache-only. Controlled by `codeExplorer.showCodeLens` (default: false). |
| `ShowSymbolInfoCommand.ts` | Diagnostic command that gathers all VS Code intellisense info (11 providers) about cursor symbol and writes to a new document. Uses `findDeepestSymbol` and `buildAddress` for symbol address derivation. |
| `VscodeSourceReader.ts` | `ISourceReader` implementation wrapping `StaticAnalyzer`. Used inside VS Code where language server APIs are available. |
| `SymbolResolver.ts` | Legacy symbol resolution via `vscode.executeDocumentSymbolProvider`. **Not imported by `extension.ts`** — preserved for potential future use. |

## CodeExplorerHoverProvider

Shows a compact markdown hover card when the user hovers over a symbol:

1. Checks `codeExplorer.showHoverCards` setting
2. Gets word at cursor, computes relative file path
3. Calls `CacheStore.findByCursor(word, relPath, cursorLine)` — fast, no LLM
4. If cached analysis found: shows kind, name, overview (first 2 sentences), signature (if function), stats (callers, sub-functions, members, issues), first potential issue, timestamp + provider + "Open in Code Explorer" link
5. If no cached analysis: returns null (no hover)

Constructor: `(cacheStore: CacheStore, workspaceRoot: string)`

## CodeExplorerCodeLensProvider

Shows contextual annotations directly in the editor above analyzed symbols:

1. Checks `codeExplorer.showCodeLens` setting (default: **false**)
2. Reads all cached analyses for the current file via `CacheStore.readAllForFile(relPath)`
3. For each cached symbol, generates CodeLens items:
   - **Overview**: One-line summary at symbol definition line
   - **Function Steps**: Distributed approximately across the function body
   - **Data Flow**: At exact line numbers (for variables)
   - **Potential Issues**: Warning annotations at symbol line
4. All CodeLens items are clickable → opens `codeExplorer.exploreSymbol` command

Constructor: `(cacheStore: CacheStore, workspaceRoot: string)`

Has `refresh()` method to trigger `onDidChangeCodeLenses` event, and `dispose()` for cleanup.

## ShowSymbolInfoCommand

Exported function `showSymbolInfo()`. Runs 11 VS Code intellisense providers concurrently via `Promise.allSettled`:
- Document symbols, definitions, type definitions, hover, references, call hierarchy (incoming + outgoing), type hierarchy (supertypes + subtypes), implementations, signature help, document highlights, completions

Includes **Symbol Address** derivation using three strategies:
1. From Document Symbols (VS Code API) — exact match vs. inner token
2. From Definition Provider — resolves to definition site in different files
3. From Tree-Sitter Symbol Index — reads `_symbol_index.json` if available

Uses `findDeepestSymbol` and `mapVscodeSymbolKind` from `src/utils/symbolHelpers.ts`, and `buildAddress`/`addressToCachePath` from `src/indexing/SymbolAddress.ts`.

## VscodeSourceReader

Implements `ISourceReader` by wrapping `StaticAnalyzer`:
- `readSymbolSource(symbol)` → `StaticAnalyzer.readSymbolSource()`
- `readContainingScopeSource(symbol)` → `StaticAnalyzer.readContainingScopeSource()`
- `resolveSymbolAtPosition(filePath, line, character, word)` → `StaticAnalyzer.resolveSymbolAtPosition()`
- `listFileSymbols(filePath)` → `StaticAnalyzer.listFileSymbols()`

## SymbolResolver (Legacy)

⚠️ **Not the primary flow**. Not imported by `extension.ts`. Preserved for potential future use.

Resolves cursor position to `SymbolInfo` using:
1. `vscode.executeDocumentSymbolProvider` → walk tree with `_findDeepest()`
2. `vscode.executeDefinitionProvider` fallback for local variables
3. `document.getWordRangeAtPosition()` last resort

Replaced because `vscode.executeDocumentSymbolProvider` is slow on large codebases. The new flow uses lightweight `CursorContext` + LLM unified prompt.

## Do NOT

- Use the HoverProvider to trigger LLM calls (cache-only for performance)
- Enable CodeLens by default (some users find inline annotations distracting)
- Import `SymbolResolver` in new code (use LLM-based resolution via unified prompt)
