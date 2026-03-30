/**
 * Code Explorer — Source Reader Interface
 *
 * Abstracts VS-Code-coupled source reading so the analysis pipeline
 * can run outside VS Code (CLI, tests, MCP server).
 *
 * Two implementations:
 *   - VscodeSourceReader  — wraps StaticAnalyzer (VS Code extension host)
 *   - FileSystemSourceReader — reads files via fs (CLI, tests)
 */
import type { SymbolInfo, SymbolKindType } from '../models/types';

/**
 * Descriptor for a symbol discovered via static analysis.
 * Lightweight — contains only identity info, no source code.
 */
export interface FileSymbolDescriptor {
  /** Symbol name */
  name: string;
  /** Symbol kind (function, class, method, etc.) */
  kind: SymbolKindType;
  /** Relative file path from workspace root */
  filePath: string;
  /** 0-based line number of the symbol definition */
  line: number;
  /** Scope chain from outermost to innermost enclosing scope */
  scopeChain: string[];
  /** Immediate container name (last element of scope chain), if any */
  container?: string;
}

export interface ISourceReader {
  /** Read source code for a symbol's definition. */
  readSymbolSource(symbol: SymbolInfo): Promise<string>;

  /** Read the enclosing scope's source (for variable/property context). */
  readContainingScopeSource(symbol: SymbolInfo): Promise<string>;

  /**
   * Resolve the symbol at a cursor position.
   * Returns null if resolution is not possible (e.g., no language server).
   */
  resolveSymbolAtPosition(
    filePath: string,
    line: number,
    character: number,
    word: string
  ): Promise<SymbolInfo | null>;

  /**
   * List all important symbols in a file.
   * Returns empty array if not supported.
   */
  listFileSymbols(filePath: string): Promise<FileSymbolDescriptor[]>;
}
