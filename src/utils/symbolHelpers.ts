/**
 * Code Explorer — Shared Symbol Helper Utilities
 *
 * Common functions for working with VS Code DocumentSymbols.
 * Used by StaticAnalyzer, SymbolResolver, ShowSymbolInfoCommand,
 * and any other module that traverses the document symbol tree.
 *
 * Extracted here so the logic is defined in exactly one place —
 * previously it was duplicated across 3 files with identical code.
 */
import * as vscode from 'vscode';
import type { SymbolKindType } from '../models/types';

/**
 * Result of finding the deepest symbol at a cursor position.
 * Contains the matched symbol and the full ancestor chain (root → parent).
 */
export interface DeepestSymbolMatch {
  /** The matched document symbol */
  symbol: vscode.DocumentSymbol;
  /** Ancestor symbols from root to direct parent (does NOT include the matched symbol) */
  ancestors: vscode.DocumentSymbol[];
}

/**
 * Walk the symbol tree to find the deepest symbol whose range contains the position.
 * Returns the matched symbol and the full ancestor chain (root → parent).
 *
 * @param symbols  Top-level document symbols array
 * @param position The cursor position to locate
 * @param ancestors  Internal — accumulated ancestor chain (caller should omit)
 * @returns The deepest match, or null if the position is not inside any symbol.
 */
export function findDeepestSymbol(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position,
  ancestors: vscode.DocumentSymbol[] = []
): DeepestSymbolMatch | null {
  for (const sym of symbols) {
    if (sym.range.contains(position)) {
      // Check children first for a tighter match
      const childMatch = findDeepestSymbol(sym.children, position, [...ancestors, sym]);
      if (childMatch) {
        return childMatch;
      }
      return { symbol: sym, ancestors };
    }
  }
  return null;
}

/**
 * Build a scope chain (ancestor names) for a given position in the symbol tree.
 * The returned array lists names from outermost to innermost enclosing scope.
 *
 * @param symbols   Top-level document symbols array
 * @param position  The position to build the scope chain for
 * @param chain     Internal — accumulated chain (caller should omit)
 * @returns Array of scope names, e.g. ['Namespace', 'ClassName', 'methodName']
 */
export function buildScopeChainForPosition(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position,
  chain: string[] = []
): string[] {
  for (const sym of symbols) {
    if (sym.range.contains(position)) {
      const childChain = buildScopeChainForPosition(sym.children, position, [
        ...chain,
        sym.name,
      ]);
      // Return the deepest chain found
      return childChain.length > chain.length ? childChain : [...chain, sym.name];
    }
  }
  return chain;
}

/**
 * Map VS Code SymbolKind enum to our string-based SymbolKindType.
 *
 * @param kind VS Code SymbolKind enum value
 * @returns Corresponding SymbolKindType string
 */
export function mapVscodeSymbolKind(kind: vscode.SymbolKind): SymbolKindType {
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
