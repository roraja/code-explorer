/**
 * Code Explorer — File System Source Reader
 *
 * ISourceReader implementation that reads files via Node.js `fs` module.
 * Used outside VS Code (CLI, tests) where no language server is available.
 *
 * - readSymbolSource: reads ±50 lines around the symbol's position
 * - readContainingScopeSource: reads ±100 lines around the symbol
 * - resolveSymbolAtPosition: always returns null (no language server)
 * - listFileSymbols: always returns empty array (no language server)
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ISourceReader, FileSymbolDescriptor } from './ISourceReader';
import type { SymbolInfo } from '../models/types';

export class FileSystemSourceReader implements ISourceReader {
  constructor(private readonly _workspaceRoot: string) {}

  async readSymbolSource(symbol: SymbolInfo): Promise<string> {
    try {
      const absPath = path.join(this._workspaceRoot, symbol.filePath);
      const content = await fs.readFile(absPath, 'utf-8');
      const lines = content.split('\n');

      if (symbol.range) {
        // Read the exact range if available
        const start = Math.max(0, symbol.range.start.line);
        const end = Math.min(lines.length - 1, symbol.range.end.line);
        return lines.slice(start, end + 1).join('\n');
      }

      // Fallback: read ~50 lines around the symbol
      const startLine = Math.max(0, symbol.position.line - 2);
      const endLine = Math.min(lines.length - 1, symbol.position.line + 50);
      return lines.slice(startLine, endLine + 1).join('\n');
    } catch {
      return '';
    }
  }

  async readContainingScopeSource(symbol: SymbolInfo): Promise<string> {
    try {
      const absPath = path.join(this._workspaceRoot, symbol.filePath);
      const content = await fs.readFile(absPath, 'utf-8');
      const lines = content.split('\n');

      // Read ~100 lines around the symbol for context
      const startLine = Math.max(0, symbol.position.line - 20);
      const endLine = Math.min(lines.length - 1, symbol.position.line + 80);
      return lines.slice(startLine, endLine + 1).join('\n');
    } catch {
      return '';
    }
  }

  async resolveSymbolAtPosition(
    _filePath: string,
    _line: number,
    _character: number,
    _word: string
  ): Promise<SymbolInfo | null> {
    // No language server available — return null to fall through to LLM
    return null;
  }

  async listFileSymbols(_filePath: string): Promise<FileSymbolDescriptor[]> {
    // No language server available — return empty to trigger full-source prompt
    return [];
  }
}
