/**
 * Code Explorer — Symbol Resolver
 *
 * Resolves the code symbol at a given cursor position by querying
 * VS Code's document symbol provider.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { SymbolInfo, SymbolKindType } from '../models/types';
import { logger } from '../utils/logger';
import {
  findDeepestSymbol,
  buildScopeChainForPosition,
  mapVscodeSymbolKind,
} from '../utils/symbolHelpers';

export class SymbolResolver {
  /**
   * Resolve the symbol at the given position in the document.
   * Returns null if no symbol is found.
   */
  async resolveAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<SymbolInfo | null> {
    logger.debug(
      `SymbolResolver.resolveAtPosition: ${document.fileName}:${position.line}:${position.character}`
    );

    // Get all document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );

    if (!symbols || symbols.length === 0) {
      logger.debug(
        `SymbolResolver: document symbol provider returned 0 symbols for ${document.fileName}`
      );
      return null;
    }

    logger.debug(`SymbolResolver: document has ${symbols.length} top-level symbols`);

    // Find the most specific symbol containing the position
    const match = findDeepestSymbol(symbols, position);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const relPath = path.relative(workspaceRoot, document.fileName);

    if (!match) {
      // Fallback: try definition provider for local variables not in document symbols
      const defResult = await this._resolveViaDefinition(document, position, relPath, symbols);
      if (defResult) {
        return defResult;
      }

      // Last resort: use the word at the cursor
      const wordRange = document.getWordRangeAtPosition(position);
      if (wordRange) {
        const word = document.getText(wordRange);
        logger.info(
          `SymbolResolver: no symbol match, falling back to word "${word}" at ${relPath}:${position.line}`
        );
        return {
          name: word,
          kind: 'unknown',
          filePath: relPath,
          position: { line: position.line, character: position.character },
          scopeChain: [],
        };
      }
      logger.warn('SymbolResolver: no symbol and no word at cursor position');
      return null;
    }

    const matchedKind = mapVscodeSymbolKind(match.symbol.kind);

    // If the matched symbol is a function/method/class but the cursor is on a word
    // inside it (not on its name), the user may be clicking on a local variable.
    // Try definition provider to resolve the exact token.
    if (
      (matchedKind === 'function' || matchedKind === 'method' || matchedKind === 'class') &&
      !match.symbol.selectionRange.contains(position)
    ) {
      const localResult = await this._resolveViaDefinition(document, position, relPath, symbols);
      if (localResult) {
        return localResult;
      }
    }

    // Build the scope chain: names of all ancestors (excluding the symbol itself)
    const scopeChain = match.ancestors.map((a) => a.name);

    const info: SymbolInfo = {
      name: match.symbol.name,
      kind: matchedKind,
      filePath: relPath,
      position: {
        line: match.symbol.selectionRange.start.line,
        character: match.symbol.selectionRange.start.character,
      },
      range: {
        start: {
          line: match.symbol.range.start.line,
          character: match.symbol.range.start.character,
        },
        end: {
          line: match.symbol.range.end.line,
          character: match.symbol.range.end.character,
        },
      },
      containerName:
        match.ancestors.length > 0 ? match.ancestors[match.ancestors.length - 1].name : undefined,
      scopeChain,
    };

    logger.info(
      `Resolved symbol: ${info.kind} ${info.name} in ${info.filePath}:${info.position.line}` +
        (scopeChain.length > 0 ? ` scope=[${scopeChain.join('.')}]` : '')
    );
    return info;
  }

  /**
   * Try to resolve a local variable or identifier via the definition provider.
   * This catches local variables, parameters, and other tokens that don't
   * appear as DocumentSymbol children.
   */
  private async _resolveViaDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _relPath: string,
    allSymbols: vscode.DocumentSymbol[]
  ): Promise<SymbolInfo | null> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);
    try {
      const definitions = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >('vscode.executeDefinitionProvider', document.uri, position);

      if (!definitions || definitions.length === 0) {
        return null;
      }

      // Use the first definition
      const def = definitions[0];
      const defUri = 'targetUri' in def ? def.targetUri : def.uri;
      const defRange = 'targetRange' in def ? def.targetRange : def.range;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const defRelPath = path.relative(workspaceRoot, defUri.fsPath);

      // When the definition is in a different file, fetch that file's document
      // symbols so we build the scope chain from the correct symbol tree.
      const isDifferentFile = defUri.fsPath !== document.uri.fsPath;
      let defSymbols = allSymbols;
      if (isDifferentFile) {
        try {
          const fetchedSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            defUri
          );
          if (fetchedSymbols && fetchedSymbols.length > 0) {
            defSymbols = fetchedSymbols;
          }
        } catch {
          logger.debug(
            `SymbolResolver._resolveViaDefinition: ` +
              `could not fetch document symbols for ${defRelPath}, using current file symbols`
          );
        }
      }

      // Build scope chain from enclosing symbols at the definition site
      const scopeChain = buildScopeChainForPosition(defSymbols, defRange.start);

      // Determine kind: if it's defined inside a class, it's a property;
      // if inside a function, it's a variable.
      let kind: SymbolKindType = 'variable';
      if (scopeChain.length > 0) {
        const parentScope = findDeepestSymbol(defSymbols, defRange.start);
        if (parentScope) {
          const parentKind = mapVscodeSymbolKind(parentScope.symbol.kind);
          if (parentKind === 'class' || parentKind === 'interface') {
            kind = 'property';
          }
        }
      }

      const info: SymbolInfo = {
        name: word,
        kind,
        filePath: defRelPath,
        position: {
          line: defRange.start.line,
          character: defRange.start.character,
        },
        range: {
          start: { line: defRange.start.line, character: defRange.start.character },
          end: { line: defRange.end.line, character: defRange.end.character },
        },
        containerName: scopeChain.length > 0 ? scopeChain[scopeChain.length - 1] : undefined,
        scopeChain,
      };

      logger.info(
        `Resolved via definition provider: ${info.kind} "${info.name}" at ${info.filePath}:${info.position.line}` +
          (scopeChain.length > 0 ? ` scope=[${scopeChain.join('.')}]` : '')
      );
      return info;
    } catch (err) {
      logger.debug(`SymbolResolver._resolveViaDefinition: failed for "${word}": ${err}`);
      return null;
    }
  }
}
