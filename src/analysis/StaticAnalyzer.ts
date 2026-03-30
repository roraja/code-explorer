/**
 * Code Explorer — Static Analyzer
 *
 * Uses VS Code's built-in language services to gather references,
 * call hierarchy, and type hierarchy for a symbol.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import type { SymbolInfo, SymbolKindType, UsageEntry, CallStackEntry, RelationshipEntry } from '../models/types';
import { logger } from '../utils/logger';
import {
  findDeepestSymbol,
  buildScopeChainForPosition,
  mapVscodeSymbolKind,
} from '../utils/symbolHelpers';

export class StaticAnalyzer {
  /**
   * Resolve the symbol at a cursor position using VS Code's built-in
   * language intelligence (definition provider + document symbol provider).
   *
   * This is a fast, deterministic alternative to LLM-based symbol resolution.
   * It uses the same APIs that power Go-to-Definition and breadcrumbs.
   *
   * Returns a SymbolInfo with accurate kind, scope chain, and range — or
   * null if the language server doesn't provide enough information.
   *
   * @param filePath  Relative path from workspace root
   * @param line      0-based line number
   * @param character 0-based character position
   * @param word      The word at the cursor (for fallback)
   */
  async resolveSymbolAtPosition(
    filePath: string,
    line: number,
    character: number,
    word: string
  ): Promise<SymbolInfo | null> {
    logger.debug(
      `StaticAnalyzer.resolveSymbolAtPosition: "${word}" at ${filePath}:${line}:${character}`
    );
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return null;
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, filePath));
      const position = new vscode.Position(line, character);

      // Step 1: Get document symbols (gives us the full symbol tree with kinds)
      const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (!docSymbols || docSymbols.length === 0) {
        logger.debug('StaticAnalyzer.resolveSymbolAtPosition: no document symbols');
        return null;
      }

      // Step 2: Find the deepest symbol containing the cursor position
      const match = findDeepestSymbol(docSymbols, position);

      if (!match) {
        // Step 3: Fallback — try definition provider for tokens not in document symbols
        // (e.g., local variables, references to external symbols)
        return this._resolveViaDefinitionProvider(uri, position, word, filePath, docSymbols);
      }

      // Step 4: Check if cursor is on the symbol's name or inside its body
      // If inside the body (not on the name), try definition provider for the specific token
      if (!match.symbol.selectionRange.contains(position)) {
        const tokenResult = await this._resolveViaDefinitionProvider(
          uri, position, word, filePath, docSymbols
        );
        if (tokenResult) {
          return tokenResult;
        }
      }

      // Step 5: Build SymbolInfo from the matched document symbol
      const kind = mapVscodeSymbolKind(match.symbol.kind);
      const scopeChain = match.ancestors.map((a) => a.name);

      const info: SymbolInfo = {
        name: match.symbol.name,
        kind,
        filePath,
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
          match.ancestors.length > 0
            ? match.ancestors[match.ancestors.length - 1].name
            : undefined,
        scopeChain,
      };

      logger.info(
        `StaticAnalyzer.resolveSymbolAtPosition: resolved ${info.kind} "${info.name}" ` +
          `at ${info.filePath}:${info.position.line}` +
          (scopeChain.length > 0 ? ` scope=[${scopeChain.join('.')}]` : '')
      );

      return info;
    } catch (err) {
      logger.debug(`StaticAnalyzer.resolveSymbolAtPosition: failed: ${err}`);
      return null;
    }
  }

  /**
   * Try to resolve a token via the definition provider.
   * Catches local variables, parameters, and identifiers that
   * don't appear as DocumentSymbol children.
   */
  private async _resolveViaDefinitionProvider(
    uri: vscode.Uri,
    position: vscode.Position,
    word: string,
    _relPath: string,
    allSymbols: vscode.DocumentSymbol[]
  ): Promise<SymbolInfo | null> {
    try {
      const definitions = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >('vscode.executeDefinitionProvider', uri, position);

      if (!definitions || definitions.length === 0) {
        return null;
      }

      const def = definitions[0];
      const defUri = 'targetUri' in def ? def.targetUri : def.uri;
      const defRange = 'targetRange' in def ? def.targetRange : def.range;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const defRelPath = path.relative(workspaceRoot, defUri.fsPath);

      // When the definition is in a different file, fetch that file's document
      // symbols so we build the scope chain from the correct symbol tree.
      // Using the current file's symbols for a cross-file definition produces
      // wrong scope chains (the definition-site position doesn't exist in the
      // current file's symbol tree).
      const isDifferentFile = defUri.fsPath !== uri.fsPath;
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
          // Fall back to current file's symbols — better than nothing
          logger.debug(
            `StaticAnalyzer._resolveViaDefinitionProvider: ` +
              `could not fetch document symbols for ${defRelPath}, using current file symbols`
          );
        }
      }

      // Build scope chain from enclosing symbols at the definition site
      const scopeChain = buildScopeChainForPosition(defSymbols, defRange.start);

      // Infer kind: if inside a class, it's a property; if inside a function, it's a variable
      let kind: SymbolKindType = 'variable';
      if (scopeChain.length > 0) {
        const parentMatch = findDeepestSymbol(defSymbols, defRange.start);
        if (parentMatch) {
          const parentKind = mapVscodeSymbolKind(parentMatch.symbol.kind);
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
        `StaticAnalyzer.resolveSymbolAtPosition: resolved via definition provider: ` +
          `${info.kind} "${info.name}" at ${info.filePath}:${info.position.line}` +
          (scopeChain.length > 0 ? ` scope=[${scopeChain.join('.')}]` : '')
      );

      return info;
    } catch (err) {
      logger.debug(`StaticAnalyzer._resolveViaDefinitionProvider: failed: ${err}`);
      return null;
    }
  }

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
   * List all important symbols in a file using VS Code's document symbol provider.
   *
   * Walks the full symbol tree returned by the language server and flattens it
   * into a list of symbol descriptors with kind, name, line number, and scope chain.
   * Filters to "crucial" symbol kinds: classes, functions, methods, interfaces,
   * enums, structs, type aliases, and exported variables/constants.
   *
   * @param filePath  Relative path from workspace root
   * @returns Array of discovered symbol descriptors, or empty array if the
   *          language server doesn't provide document symbols.
   */
  async listFileSymbols(
    filePath: string
  ): Promise<FileSymbolDescriptor[]> {
    logger.debug(`StaticAnalyzer.listFileSymbols: ${filePath}`);
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return [];
      }

      const uri = vscode.Uri.file(path.join(workspaceRoot, filePath));
      const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (!docSymbols || docSymbols.length === 0) {
        logger.debug('StaticAnalyzer.listFileSymbols: no document symbols returned');
        return [];
      }

      const results: FileSymbolDescriptor[] = [];
      this._flattenSymbols(docSymbols, filePath, [], results);

      logger.info(
        `StaticAnalyzer.listFileSymbols: found ${results.length} symbols in ${filePath}`
      );
      return results;
    } catch (err) {
      logger.warn(`StaticAnalyzer.listFileSymbols: failed for ${filePath}: ${err}`);
      return [];
    }
  }

  /**
   * Recursively flatten a document symbol tree into a list of FileSymbolDescriptors.
   * Only includes "crucial" symbol kinds (classes, functions, methods, interfaces,
   * enums, variables/constants, properties, structs).
   */
  private _flattenSymbols(
    symbols: vscode.DocumentSymbol[],
    filePath: string,
    scopeChain: string[],
    results: FileSymbolDescriptor[]
  ): void {
    for (const sym of symbols) {
      const kind = mapVscodeSymbolKind(sym.kind);

      // Include crucial symbols — skip unknown/unrecognized kinds
      if (kind !== 'unknown') {
        results.push({
          name: sym.name,
          kind,
          filePath,
          line: sym.selectionRange.start.line,
          scopeChain: [...scopeChain],
          container: scopeChain.length > 0 ? scopeChain[scopeChain.length - 1] : undefined,
        });
      }

      // Recurse into children with updated scope chain
      if (sym.children && sym.children.length > 0) {
        this._flattenSymbols(sym.children, filePath, [...scopeChain, sym.name], results);
      }
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

/**
 * Descriptor for a symbol discovered via VS Code's document symbol provider.
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
