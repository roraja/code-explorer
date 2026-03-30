/**
 * Code Explorer — VS Code Source Reader
 *
 * ISourceReader implementation that wraps the existing StaticAnalyzer.
 * Used inside the VS Code extension host where language server APIs
 * are available.
 */
import type { ISourceReader, FileSymbolDescriptor } from '../api/ISourceReader';
import type { SymbolInfo } from '../models/types';
import { StaticAnalyzer } from '../analysis/StaticAnalyzer';

export class VscodeSourceReader implements ISourceReader {
  private readonly _analyzer: StaticAnalyzer;

  constructor() {
    this._analyzer = new StaticAnalyzer();
  }

  async readSymbolSource(symbol: SymbolInfo): Promise<string> {
    return this._analyzer.readSymbolSource(symbol);
  }

  async readContainingScopeSource(symbol: SymbolInfo): Promise<string> {
    return this._analyzer.readContainingScopeSource(symbol);
  }

  async resolveSymbolAtPosition(
    filePath: string,
    line: number,
    character: number,
    word: string
  ): Promise<SymbolInfo | null> {
    return this._analyzer.resolveSymbolAtPosition(filePath, line, character, word);
  }

  async listFileSymbols(filePath: string): Promise<FileSymbolDescriptor[]> {
    // Map StaticAnalyzer's FileSymbolDescriptor to ISourceReader's FileSymbolDescriptor
    // (they have the same shape)
    return this._analyzer.listFileSymbols(filePath);
  }
}
