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
    const match = this._findDeepest(symbols, position);
    if (!match) {
      // Fallback: use the word at the cursor
      const wordRange = document.getWordRangeAtPosition(position);
      if (wordRange) {
        const word = document.getText(wordRange);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const relPath = path.relative(workspaceRoot, document.fileName);
        logger.info(
          `SymbolResolver: no symbol match, falling back to word "${word}" at ${relPath}:${position.line}`
        );
        return {
          name: word,
          kind: 'unknown',
          filePath: relPath,
          position: { line: position.line, character: position.character },
        };
      }
      logger.warn('SymbolResolver: no symbol and no word at cursor position');
      return null;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const relPath = path.relative(workspaceRoot, document.fileName);

    const info: SymbolInfo = {
      name: match.symbol.name,
      kind: this._mapSymbolKind(match.symbol.kind),
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
      containerName: match.parent?.name,
    };

    logger.info(
      `Resolved symbol: ${info.kind} ${info.name} in ${info.filePath}:${info.position.line}`
    );
    return info;
  }

  /**
   * Walk the symbol tree to find the deepest symbol whose range contains the position.
   */
  private _findDeepest(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position,
    parent?: vscode.DocumentSymbol
  ): { symbol: vscode.DocumentSymbol; parent?: vscode.DocumentSymbol } | null {
    for (const sym of symbols) {
      if (sym.range.contains(position)) {
        // Check children first for a tighter match
        const childMatch = this._findDeepest(sym.children, position, sym);
        if (childMatch) {
          return childMatch;
        }
        // If the cursor is on the symbol's name, return it
        if (sym.selectionRange.contains(position)) {
          return { symbol: sym, parent };
        }
        // Otherwise still return it as the containing symbol
        return { symbol: sym, parent };
      }
    }
    return null;
  }

  /**
   * Map VS Code SymbolKind to our SymbolKindType.
   */
  private _mapSymbolKind(kind: vscode.SymbolKind): SymbolKindType {
    switch (kind) {
      case vscode.SymbolKind.Class:
      case vscode.SymbolKind.Struct:
        return 'class';
      case vscode.SymbolKind.Function:
      case vscode.SymbolKind.Constructor:
        return 'function';
      case vscode.SymbolKind.Method:
        return 'method';
      case vscode.SymbolKind.Variable:
      case vscode.SymbolKind.Constant:
        return 'variable';
      case vscode.SymbolKind.Interface:
        return 'interface';
      case vscode.SymbolKind.TypeParameter:
        return 'type';
      case vscode.SymbolKind.Enum:
        return 'enum';
      case vscode.SymbolKind.Property:
      case vscode.SymbolKind.Field:
        return 'property';
      default:
        return 'unknown';
    }
  }
}
