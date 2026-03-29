/**
 * Code Explorer — Static Analyzer
 *
 * Uses VS Code's built-in language services to gather references,
 * call hierarchy, and type hierarchy for a symbol.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { SymbolInfo, UsageEntry, CallStackEntry, RelationshipEntry } from '../models/types';
import { logger } from '../utils/logger';

export class StaticAnalyzer {
  /**
   * Find all references to a symbol across the workspace.
   */
  async findReferences(symbol: SymbolInfo): Promise<UsageEntry[]> {
    logger.debug(
      `StaticAnalyzer.findReferences: ${symbol.kind} "${symbol.name}" at ${symbol.filePath}:${symbol.position.line}`
    );
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return [];
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, symbol.filePath));
      const position = new vscode.Position(symbol.position.line, symbol.position.character);

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position
      );

      if (!locations || locations.length === 0) {
        logger.debug(`No references found for ${symbol.name}`);
        return [];
      }

      const usages: UsageEntry[] = [];
      for (const loc of locations) {
        const relPath = path.relative(workspaceRoot, loc.uri.fsPath);
        let contextLine = '';
        try {
          const doc = await vscode.workspace.openTextDocument(loc.uri);
          contextLine = doc.lineAt(loc.range.start.line).text;
        } catch {
          // File might be inaccessible
        }

        const isDefinition =
          relPath === symbol.filePath && loc.range.start.line === symbol.position.line;

        usages.push({
          filePath: relPath,
          line: loc.range.start.line + 1, // 1-based for display
          character: loc.range.start.character,
          contextLine,
          isDefinition,
        });
      }

      logger.info(`Found ${usages.length} references for ${symbol.name}`);
      return usages;
    } catch (err) {
      logger.warn(`Failed to find references for ${symbol.name}: ${err}`);
      return [];
    }
  }

  /**
   * Build incoming call hierarchy (who calls this symbol?).
   */
  async buildCallHierarchy(symbol: SymbolInfo): Promise<CallStackEntry[]> {
    logger.debug(`StaticAnalyzer.buildCallHierarchy: ${symbol.kind} "${symbol.name}"`);
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return [];
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, symbol.filePath));
      const position = new vscode.Position(symbol.position.line, symbol.position.character);

      // Prepare call hierarchy
      const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        'vscode.prepareCallHierarchy',
        uri,
        position
      );

      if (!items || items.length === 0) {
        logger.debug(`No call hierarchy for ${symbol.name}`);
        return [];
      }

      // Get incoming calls
      const incomingCalls = await vscode.commands.executeCommand<
        vscode.CallHierarchyIncomingCall[]
      >('vscode.provideIncomingCalls', items[0]);

      if (!incomingCalls || incomingCalls.length === 0) {
        logger.debug(`StaticAnalyzer.buildCallHierarchy: no incoming calls for ${symbol.name}`);
        return [];
      }

      const entries: CallStackEntry[] = incomingCalls.map((call) => {
        const callerPath = path.relative(workspaceRoot, call.from.uri.fsPath);
        return {
          caller: {
            name: call.from.name,
            filePath: callerPath,
            line: call.from.range.start.line + 1,
            kind: 'function' as const,
          },
          callSites: call.fromRanges.map((r) => ({
            line: r.start.line,
            character: r.start.character,
          })),
          depth: 0,
          chain: `${callerPath}:${call.from.range.start.line + 1} → ${call.from.name}() → ${symbol.name}()`,
        };
      });

      logger.info(`Found ${entries.length} callers for ${symbol.name}`);
      return entries;
    } catch (err) {
      logger.debug(`Call hierarchy not available for ${symbol.name}: ${err}`);
      return [];
    }
  }

  /**
   * Get type hierarchy (supertypes/subtypes) for a class/interface.
   */
  async getTypeHierarchy(symbol: SymbolInfo): Promise<RelationshipEntry[]> {
    if (symbol.kind !== 'class' && symbol.kind !== 'interface') {
      logger.debug(
        `StaticAnalyzer.getTypeHierarchy: skipping ${symbol.kind} "${symbol.name}" (not class/interface)`
      );
      return [];
    }

    logger.debug(`StaticAnalyzer.getTypeHierarchy: ${symbol.kind} "${symbol.name}"`);
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return [];
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, symbol.filePath));
      const position = new vscode.Position(symbol.position.line, symbol.position.character);

      const items = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
        'vscode.prepareTypeHierarchy',
        uri,
        position
      );

      if (!items || items.length === 0) {
        return [];
      }

      const relationships: RelationshipEntry[] = [];

      // Supertypes
      try {
        const supertypes = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
          'vscode.provideSupertypes',
          items[0]
        );
        if (supertypes) {
          for (const st of supertypes) {
            relationships.push({
              type: 'extends',
              targetName: st.name,
              targetFilePath: path.relative(workspaceRoot, st.uri.fsPath),
              targetLine: st.range.start.line + 1,
            });
          }
        }
      } catch {
        // Supertypes not supported
      }

      // Subtypes
      try {
        const subtypes = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
          'vscode.provideSubtypes',
          items[0]
        );
        if (subtypes) {
          for (const st of subtypes) {
            relationships.push({
              type: 'extended-by',
              targetName: st.name,
              targetFilePath: path.relative(workspaceRoot, st.uri.fsPath),
              targetLine: st.range.start.line + 1,
            });
          }
        }
      } catch {
        // Subtypes not supported
      }

      logger.info(`Found ${relationships.length} type relationships for ${symbol.name}`);
      return relationships;
    } catch (err) {
      logger.debug(`Type hierarchy not available for ${symbol.name}: ${err}`);
      return [];
    }
  }

  /**
   * Read the source code for a symbol from the file.
   */
  async readSymbolSource(symbol: SymbolInfo): Promise<string> {
    logger.debug(
      `StaticAnalyzer.readSymbolSource: ${symbol.kind} "${symbol.name}" in ${symbol.filePath}`
    );
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return '';
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, symbol.filePath));
      const doc = await vscode.workspace.openTextDocument(uri);

      if (symbol.range) {
        const range = new vscode.Range(
          symbol.range.start.line,
          symbol.range.start.character,
          symbol.range.end.line,
          symbol.range.end.character
        );
        const text = doc.getText(range);
        logger.debug(
          `StaticAnalyzer.readSymbolSource: read ${text.length} chars from symbol range (lines ${symbol.range.start.line}-${symbol.range.end.line})`
        );
        return text;
      }

      // Fallback: read ~50 lines around the symbol
      const startLine = Math.max(0, symbol.position.line - 2);
      const endLine = Math.min(doc.lineCount - 1, symbol.position.line + 50);
      const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
      const text = doc.getText(range);
      logger.debug(
        `StaticAnalyzer.readSymbolSource: fallback read ${text.length} chars (lines ${startLine}-${endLine})`
      );
      return text;
    } catch (err) {
      logger.warn(`Failed to read source for ${symbol.name}: ${err}`);
      return '';
    }
  }

  /**
   * Read the source code of the containing scope (function/class) for a
   * variable or property symbol. Returns the full body of the enclosing
   * function or class so the LLM has context about how the symbol is used.
   */
  async readContainingScopeSource(symbol: SymbolInfo): Promise<string> {
    logger.debug(
      `StaticAnalyzer.readContainingScopeSource: ${symbol.kind} "${symbol.name}" in ${symbol.filePath}`
    );
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return '';
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, symbol.filePath));
      const doc = await vscode.workspace.openTextDocument(uri);

      // Use scope chain to find the containing symbol in document symbols
      if (symbol.scopeChain && symbol.scopeChain.length > 0) {
        const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          uri
        );

        if (docSymbols) {
          const container = this._findContainerByName(
            docSymbols,
            symbol.scopeChain[symbol.scopeChain.length - 1]
          );
          if (container) {
            const range = container.range;
            const text = doc.getText(
              new vscode.Range(
                range.start.line,
                range.start.character,
                range.end.line,
                range.end.character
              )
            );
            logger.debug(
              `StaticAnalyzer.readContainingScopeSource: read ${text.length} chars from container "${container.name}"`
            );
            return text;
          }
        }
      }

      // Fallback: read ~100 lines around the symbol
      const startLine = Math.max(0, symbol.position.line - 20);
      const endLine = Math.min(doc.lineCount - 1, symbol.position.line + 80);
      const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
      return doc.getText(range);
    } catch (err) {
      logger.warn(`Failed to read containing scope for ${symbol.name}: ${err}`);
      return '';
    }
  }

  /**
   * Find a document symbol by name within a tree (breadth-first).
   */
  private _findContainerByName(
    symbols: vscode.DocumentSymbol[],
    name: string
  ): vscode.DocumentSymbol | null {
    for (const sym of symbols) {
      if (sym.name === name) {
        return sym;
      }
      const child = this._findContainerByName(sym.children || [], name);
      if (child) {
        return child;
      }
    }
    return null;
  }
}
