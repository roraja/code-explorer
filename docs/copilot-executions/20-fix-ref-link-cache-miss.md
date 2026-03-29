# 20 - Fix Ref Link Cache Miss (Always Triggers Fresh LLM Analysis)

**Date**: 2026-03-29 UTC
**Prompt**: "Even though llm analysis exist in cache, when I click a ref link from some other llm analysis, it always triggers a fresh analysis. What is wrong. Also, why does llm analysis takes so long even though I see md content is already written"

## 1. Code Reading & Analysis

| File | Why |
|------|-----|
| `.context/FLOORPLAN.md` | Understand overall data flow and module responsibilities |
| `src/ui/CodeExplorerViewProvider.ts` (full file) | Trace the ref link click flow: `_handleMessage` → `exploreSymbol` → `_exploreSymbolByName` → `openTab` |
| `src/analysis/AnalysisOrchestrator.ts` (full file) | Understand cache check logic in `analyzeSymbol` vs `analyzeFromCursor` |
| `src/cache/CacheStore.ts` (full file) | Understand `read()` (exact-path), `findByCursor()` (directory scan), `findByCursorWithLLMFallback()`, `_buildCacheKey()`, `_resolvePath()` |
| `src/utils/cli.ts` | Understand how LLM CLI processes run and return output |
| `src/llm/CopilotCLIProvider.ts` | Understand copilot CLI invocation |
| `src/extension.ts` (lines 1-200) | See how CursorContext is built in the explore command |
| `src/models/types.ts` (lines 1-111) | `SymbolInfo`, `CursorContext` interfaces |
| `webview/src/main.ts` | How `.symbol-link` click events post `exploreSymbol` messages |

Key findings from code reading:
- **Webview** posts `{ type: 'exploreSymbol', symbolName, filePath, line, kind }` on ref link click
- **`_exploreSymbolByName()`** resolves a `SymbolInfo` via VS Code document symbols, but **never sets `scopeChain`**
- **`openTab()`** calls `analyzeSymbol()` which uses `cache.read()` → `_resolvePath()` → `_buildCacheKey()`
- **`_buildCacheKey()`** includes scope chain in the path when present. Without scope chain, the path is different → cache miss
- **`analyzeFromCursor()`** (the Ctrl+Shift+E flow) uses `findByCursorWithLLMFallback()` which scans the directory by name + ±3 lines — this correctly finds cached files regardless of scope chain

## 2. Issues Identified

### Issue 1: Cache key mismatch on ref link clicks
- **File**: `src/ui/CodeExplorerViewProvider.ts`, lines 706-728 (old code)
- **Root cause**: `_exploreSymbolByName()` constructs a `SymbolInfo` without `scopeChain`, then calls `openTab()` → `analyzeSymbol()` → `cache.read()`. The cache file was originally written with a scope chain (from the LLM's `json:symbol_identity` response), so the path doesn't match.
  - Cache file written at: `.vscode/code-explorer/src/foo.ts/ClassName.fn.methodName.md`
  - Cache lookup tries: `.vscode/code-explorer/src/foo.ts/fn.methodName.md`
  - Different path → **cache miss → unnecessary fresh LLM analysis**

### Issue 2: Analysis appears slow even though .md file exists
- **Root cause**: This is a direct consequence of Issue 1. Because of the cache miss, a full LLM analysis is triggered. The .md file the user sees is the **existing** cache file (from the original analysis). The new LLM call runs for minutes, and only when it completes does the tab update. The user perceives this as "takes long even though content is written" — the content was already there, but the code didn't find it.

## 3. Plan

**Approach**: Modify `_exploreSymbolByName()` to use `openTabFromCursor()` instead of `openTab()`. This routes through `analyzeFromCursor()` which uses `findByCursorWithLLMFallback()` (directory scan + name matching) instead of the exact-path `cache.read()`. This is the same flow used by Ctrl+Shift+E and was designed to handle the case where scope chain / kind are unknown.

**Steps**:
1. Replace `_exploreSymbolByName()` to build a `CursorContext` from the document and call `openTabFromCursor()`
2. Add a `_buildCursorContext()` helper method to gather ±50 lines of surrounding source
3. Remove unused `_findSymbolInTree()` and `_vscodeKindToString()` helper methods
4. Build, lint, test

**Alternative considered**: Modifying `analyzeSymbol()` to fall back to `findByCursor()` on `cache.read()` miss. Rejected because `analyzeFromCursor` already has this logic and is the designed solution — better to route through it than duplicate the fallback.

## 4. Changes Made

### File: `src/ui/CodeExplorerViewProvider.ts`

**Changed `_exploreSymbolByName()`** (lines 680-761 → 680-767):
- **Before**: Resolved `SymbolInfo` via VS Code document symbols (without scope chain), called `openTab()` which uses exact-path `cache.read()`
- **After**: Builds a `CursorContext` from the document (with ±50 lines surrounding source), calls `openTabFromCursor()` which uses `findByCursorWithLLMFallback()` (directory scan)
- Both branches (filePath present and workspace symbol search) now use the cursor-based flow

**Added `_buildCursorContext()`** (lines 742-767):
- New private helper that constructs a `CursorContext` from a `vscode.TextDocument`, symbol name, relative path, and target line
- Gathers ±50 lines of surrounding source (same as `extension.ts` explore command)

**Removed `_findSymbolInTree()` and `_vscodeKindToString()`**:
- These were only used by the old `_exploreSymbolByName()` implementation
- No longer needed since we don't resolve VS Code document symbols anymore

```diff
-  private async _exploreSymbolByName(
-    symbolName: string,
-    filePath?: string,
-    line?: number,
-    kind?: string
-  ): Promise<void> {
-    try {
-      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
-      if (!workspaceRoot) {
-        return;
-      }
-
-      // If we have a file path and line, resolve the symbol at that location
-      if (filePath && line) {
-        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
-        try {
-          const doc = await vscode.workspace.openTextDocument(uri);
-          const position = new vscode.Position(Math.max(0, line - 1), 0);
-
-          // Try to find the symbol in the document's symbols
-          const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
-            'vscode.executeDocumentSymbolProvider',
-            doc.uri
-          );
-
-          const found = this._findSymbolInTree(symbols || [], symbolName);
-          if (found) {
-            const symbolInfo: SymbolInfo = {
-              name: found.name,
-              kind: (kind as SymbolInfo['kind']) || this._vscodeKindToString(found.kind),
-              filePath,
-              position: { line: found.range.start.line, character: found.range.start.character },
-              range: {
-                start: { line: found.range.start.line, character: found.range.start.character },
-                end: { line: found.range.end.line, character: found.range.end.character },
-              },
-            };
-            this.openTab(symbolInfo, 'symbol-link');
-            return;
-          }
-
-          // Fallback: use the line position
-          const symbolInfo: SymbolInfo = {
-            name: symbolName,
-            kind: (kind as SymbolInfo['kind']) || 'function',
-            filePath,
-            position: { line: position.line, character: 0 },
-          };
-          this.openTab(symbolInfo, 'symbol-link');
-        } catch (err) {
-          logger.warn(`ViewProvider._exploreSymbolByName: failed to open ${filePath}: ${err}`);
-        }
-      } else {
-        // No file path — use workspace symbol search
-        const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
-          'vscode.executeWorkspaceSymbolProvider',
-          symbolName
-        );
-
-        if (wsSymbols && wsSymbols.length > 0) {
-          const match = wsSymbols.find((s) => s.name === symbolName) || wsSymbols[0];
-          const relPath = vscode.workspace.asRelativePath(match.location.uri);
-          const symbolInfo: SymbolInfo = {
-            name: match.name,
-            kind: this._vscodeKindToString(match.kind),
-            filePath: relPath,
-            position: {
-              line: match.location.range.start.line,
-              character: match.location.range.start.character,
-            },
-          };
-          this.openTab(symbolInfo, 'symbol-link');
-        } else {
-          logger.warn(
-            `ViewProvider._exploreSymbolByName: symbol "${symbolName}" not found in workspace`
-          );
-        }
-      }
-    } catch (err) {
-      logger.error(`ViewProvider._exploreSymbolByName: ${err}`);
-    }
-  }
+  private async _exploreSymbolByName(
+    symbolName: string,
+    filePath?: string,
+    line?: number,
+    _kind?: string
+  ): Promise<void> {
+    try {
+      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
+      if (!workspaceRoot) {
+        return;
+      }
+
+      // If we have a file path, build a CursorContext and use the cursor-based
+      // flow. This ensures cache lookup goes through findByCursorWithLLMFallback()
+      // (directory scan + name matching) instead of exact-path cache.read()
+      // which misses when the SymbolInfo lacks scopeChain / has wrong kind.
+      if (filePath) {
+        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
+        try {
+          const doc = await vscode.workspace.openTextDocument(uri);
+          const targetLine = Math.max(0, (line || 1) - 1);
+          const cursorContext = this._buildCursorContext(doc, symbolName, filePath, targetLine);
+          this.openTabFromCursor(cursorContext);
+        } catch (err) {
+          logger.warn(`ViewProvider._exploreSymbolByName: failed to open ${filePath}: ${err}`);
+        }
+      } else {
+        // No file path — use workspace symbol search to find the file first,
+        // then use the cursor-based flow.
+        const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
+          'vscode.executeWorkspaceSymbolProvider',
+          symbolName
+        );
+
+        if (wsSymbols && wsSymbols.length > 0) {
+          const match = wsSymbols.find((s) => s.name === symbolName) || wsSymbols[0];
+          const relPath = vscode.workspace.asRelativePath(match.location.uri);
+          try {
+            const doc = await vscode.workspace.openTextDocument(match.location.uri);
+            const targetLine = match.location.range.start.line;
+            const cursorContext = this._buildCursorContext(doc, symbolName, relPath, targetLine);
+            this.openTabFromCursor(cursorContext);
+          } catch (err) {
+            logger.warn(
+              `ViewProvider._exploreSymbolByName: failed to open resolved file ${relPath}: ${err}`
+            );
+          }
+        } else {
+          logger.warn(
+            `ViewProvider._exploreSymbolByName: symbol "${symbolName}" not found in workspace`
+          );
+        }
+      }
+    } catch (err) {
+      logger.error(`ViewProvider._exploreSymbolByName: ${err}`);
+    }
+  }
+
+  /**
+   * Build a CursorContext from a document, symbol name, and target line.
+   * Gathers ±50 lines of surrounding source for the LLM prompt context.
+   */
+  private _buildCursorContext(
+    doc: vscode.TextDocument,
+    word: string,
+    relPath: string,
+    targetLine: number
+  ): CursorContext {
+    const startLine = Math.max(0, targetLine - 50);
+    const endLine = Math.min(doc.lineCount - 1, targetLine + 50);
+    const surroundingRange = new vscode.Range(
+      startLine,
+      0,
+      endLine,
+      doc.lineAt(endLine).text.length
+    );
+    const surroundingSource = doc.getText(surroundingRange);
+    const cursorLine =
+      targetLine < doc.lineCount ? doc.lineAt(targetLine).text : '';
+
+    return {
+      word,
+      filePath: relPath,
+      position: { line: targetLine, character: 0 },
+      surroundingSource,
+      cursorLine,
+    };
+  }

-  private _findSymbolInTree(
-    symbols: vscode.DocumentSymbol[],
-    name: string
-  ): vscode.DocumentSymbol | undefined {
-    for (const sym of symbols) {
-      if (sym.name === name) {
-        return sym;
-      }
-      const child = this._findSymbolInTree(sym.children || [], name);
-      if (child) {
-        return child;
-      }
-    }
-    return undefined;
-  }
-
-  private _vscodeKindToString(kind: vscode.SymbolKind): SymbolInfo['kind'] {
-    const map: Record<number, SymbolInfo['kind']> = {
-      [vscode.SymbolKind.Class]: 'class',
-      [vscode.SymbolKind.Function]: 'function',
-      [vscode.SymbolKind.Method]: 'method',
-      [vscode.SymbolKind.Variable]: 'variable',
-      [vscode.SymbolKind.Interface]: 'interface',
-      [vscode.SymbolKind.Enum]: 'enum',
-      [vscode.SymbolKind.Property]: 'property',
-    };
-    return map[kind] || 'unknown';
-  }
```

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Pass — extension.js 178.3kb, webview main.js 2.8mb |
| `npm run lint` | ✅ Pass — no lint errors |
| `npm run test:unit` | ✅ Pass — 150 passing (100ms) |

## 6. Result

**Both issues are fixed by one change:**

1. **Cache miss on ref link click**: Fixed. `_exploreSymbolByName()` now uses `openTabFromCursor()` which routes through `analyzeFromCursor()` → `findByCursorWithLLMFallback()`. This does a directory scan matching by symbol name + ±3 line tolerance, which correctly finds cached files regardless of scope chain differences.

2. **Analysis appearing slow despite .md being written**: Fixed as a consequence. The perceived slowness was caused by the unnecessary fresh LLM analysis triggered by the cache miss. With the cache now being found correctly, clicking a ref link for a cached symbol returns instantly (no LLM call).

**Verification**: Build, lint, and all 150 unit tests pass.

**Remaining consideration**: If a ref link points to a symbol that has NOT been analyzed yet (no cache file), the cursor-based flow will correctly trigger a full unified LLM analysis — same as Ctrl+Shift+E. This is the desired behavior.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/ui/CodeExplorerViewProvider.ts` | Modified | Rewrote `_exploreSymbolByName()` to use cursor-based flow (`openTabFromCursor`) instead of `openTab`, added `_buildCursorContext()` helper, removed unused `_findSymbolInTree()` and `_vscodeKindToString()` |
