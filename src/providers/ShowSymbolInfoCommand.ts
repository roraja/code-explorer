/**
 * Code Explorer — Show Symbol Info Command
 *
 * A diagnostic/testing command that gathers all available VS Code
 * intellisense information about the symbol under the cursor and
 * writes it to a new untitled document. Exercises:
 *
 *   - vscode.executeDocumentSymbolProvider  (document symbols tree)
 *   - vscode.executeDefinitionProvider      (go-to-definition)
 *   - vscode.executeTypeDefinitionProvider  (go-to-type-definition)
 *   - vscode.executeHoverProvider           (hover/type info)
 *   - vscode.executeReferenceProvider       (find all references)
 *   - vscode.prepareCallHierarchy + provideIncomingCalls / provideOutgoingCalls
 *   - vscode.prepareTypeHierarchy + provideSupertypes / provideSubtypes
 *   - vscode.executeImplementationProvider  (go-to-implementation)
 *   - vscode.executeSignatureHelpProvider   (signature help)
 *   - vscode.executeDocumentHighlights      (same-file highlights)
 *   - vscode.executeCompletionItemProvider  (completions at cursor)
 *
 * Works especially well when the workspace has clangd, tsserver, or
 * any language server providing rich intellisense.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger';
import { SYMBOL_KIND_PREFIX } from '../models/types';
import type { SymbolKindType } from '../models/types';
import { buildAddress, addressToCachePath } from '../indexing/SymbolAddress';
import { CACHE } from '../models/constants';
import {
  findDeepestSymbol,
  mapVscodeSymbolKind,
} from '../utils/symbolHelpers';

/* ------------------------------------------------------------------ */
/*  Public entry point                                                */
/* ------------------------------------------------------------------ */

export async function showSymbolInfo(): Promise<void> {
  logger.info('Command: showSymbolInfo invoked');

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor. Open a file and place the cursor on a symbol.');
    return;
  }

  const document = editor.document;
  const position = editor.selection.active;
  const wordRange = document.getWordRangeAtPosition(position);

  if (!wordRange) {
    vscode.window.showWarningMessage('No symbol found at cursor position.');
    return;
  }

  const word = document.getText(wordRange);
  const uri = document.uri;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const relPath = path.relative(workspaceRoot, document.fileName);

  const lines: string[] = [];
  const _line = (s = '') => lines.push(s);
  const _heading = (s: string) => { _line(); _line(`${'='.repeat(72)}`); _line(`  ${s}`); _line(`${'='.repeat(72)}`); };
  const _sub = (s: string) => { _line(); _line(`--- ${s} ---`); };

  _line('VS Code Symbol Info Report');
  _line(`Generated: ${new Date().toISOString()}`);
  _line(`File:      ${relPath}`);
  _line(`Position:  line ${position.line + 1}, col ${position.character + 1}`);
  _line(`Word:      ${word}`);
  _line(`Language:  ${document.languageId}`);

  // Run all providers concurrently for speed
  const [
    docSymbols,
    definitions,
    typeDefinitions,
    hovers,
    references,
    callHierarchyItems,
    typeHierarchyItems,
    implementations,
    signatureHelp,
    highlights,
  ] = await Promise.allSettled([
    vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri),
    vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', uri, position),
    vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeTypeDefinitionProvider', uri, position),
    vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position),
    vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position),
    vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position),
    vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>('vscode.prepareTypeHierarchy', uri, position),
    vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeImplementationProvider', uri, position),
    vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', uri, position),
    vscode.commands.executeCommand<vscode.DocumentHighlight[]>('vscode.executeDocumentHighlights', uri, position),
  ]);

  /* ---- 1. Document Symbols (find containing symbol) ---- */
  _heading('1. DOCUMENT SYMBOL (containing symbol at cursor)');
  if (docSymbols.status === 'fulfilled' && docSymbols.value) {
    const match = findDeepestSymbol(docSymbols.value, position);
    if (match) {
      const sym = match.symbol;
      const cursorOnSymbolName = sym.selectionRange.contains(position) && sym.name === word;

      if (cursorOnSymbolName) {
        _line(`Cursor is ON the symbol name:`);
        _line(`  Name:            ${sym.name}`);
        _line(`  Detail:          ${sym.detail || '(none)'}`);
        _line(`  Kind:            ${vscode.SymbolKind[sym.kind]} (${sym.kind})`);
        _line(`  Range:           ${_fmtRange(sym.range)}`);
        _line(`  Selection Range: ${_fmtRange(sym.selectionRange)}`);
        _line(`  Children:        ${sym.children.length}`);
        if (match.ancestors.length > 0) {
          _line(`  Scope Chain:     ${match.ancestors.map(a => `${vscode.SymbolKind[a.kind]}:${a.name}`).join(' > ')}`);
        }
      } else {
        // Cursor is on a token INSIDE the symbol's body (e.g., a variable inside a function)
        _line(`Cursor is INSIDE a symbol body (not on its name):`);
        _line(`  Word at cursor:  "${word}"`);
        _line(`  Container:       ${sym.name} (${vscode.SymbolKind[sym.kind]})`);
        _line(`  Container Range: ${_fmtRange(sym.range)}`);
        if (match.ancestors.length > 0) {
          _line(`  Full Scope:      ${[...match.ancestors.map(a => `${vscode.SymbolKind[a.kind]}:${a.name}`), `${vscode.SymbolKind[sym.kind]}:${sym.name}`].join(' > ')}`);
        } else {
          _line(`  Full Scope:      ${vscode.SymbolKind[sym.kind]}:${sym.name}`);
        }

        // Check if the word matches a child DocumentSymbol (e.g., class members from clangd)
        const childMatch = sym.children.find(c => c.name === word && c.selectionRange.start.line === position.line);
        if (childMatch) {
          _line(`  Resolved as:     child DocumentSymbol "${childMatch.name}" (${vscode.SymbolKind[childMatch.kind]})`);
          _line(`  Child Range:     ${_fmtRange(childMatch.range)}`);
        } else {
          // Infer what the cursor token is from hover info
          const tokenKind = _inferKindFromHover(
            hovers.status === 'fulfilled' ? hovers.value : null,
            word
          );
          if (tokenKind) {
            _line(`  Inferred kind:   ${tokenKind} (from hover provider)`);
          } else {
            const containerKind = mapVscodeSymbolKind(sym.kind);
            const guess = (containerKind === 'class' || containerKind === 'interface') ? 'property' : 'variable';
            _line(`  Inferred kind:   ${guess} (guessed from container kind "${containerKind}")`);
          }
        }
      }

      _line('');
      _line(`Detail:          ${sym.detail || '(none)'}`);

      // List immediate children
      if (sym.children.length > 0) {
        _sub('Children');
        for (const child of sym.children) {
          _line(`  ${vscode.SymbolKind[child.kind].padEnd(15)} ${child.name}  ${_fmtRange(child.selectionRange)}  ${child.detail || ''}`);
        }
      }
    } else {
      _line('(cursor is not inside any document symbol)');
    }

    // Also show top-level symbol count
    _sub('All top-level symbols in file');
    for (const sym of docSymbols.value) {
      _line(`  ${vscode.SymbolKind[sym.kind].padEnd(15)} ${sym.name}  ${_fmtRange(sym.selectionRange)}  children=${sym.children.length}`);
    }
  } else {
    _line(_rejected(docSymbols));
  }

  /* ---- 1b. Symbol Address (unique identifier) ---- */
  _heading('1b. SYMBOL ADDRESS (unique identifier across the repo)');
  {
    let addressFromDocSymbol: string | null = null;
    let addressFromDefinition: string | null = null;

    // --- Helper: infer the kind of the cursor word from hover info ---
    // Hover contents often contain signatures like "int count", "void foo()",
    // "class Foo", "field int x", etc. We parse these to infer the kind.
    const inferredKind = _inferKindFromHover(
      hovers.status === 'fulfilled' ? hovers.value : null,
      word
    );

    // ---- Strategy 1: From Document Symbols (VS Code API) ----
    if (docSymbols.status === 'fulfilled' && docSymbols.value) {
      const match = findDeepestSymbol(docSymbols.value, position);
      if (match) {
        const sym = match.symbol;
        const cursorOnSymbolName = sym.selectionRange.contains(position) && sym.name === word;

        if (cursorOnSymbolName) {
          // Cursor IS on this document symbol's name — address is for this symbol itself
          const kind = mapVscodeSymbolKind(sym.kind);
          const scopeChain = match.ancestors.map(a => a.name);
          addressFromDocSymbol = buildAddress(relPath, scopeChain, kind, sym.name);

          _sub('From Document Symbol (exact match)');
          _line(`  Name:        ${sym.name}`);
          _line(`  Kind:        ${kind} (prefix: ${SYMBOL_KIND_PREFIX[kind] || 'sym'})`);
          _line(`  Scope Chain: [${scopeChain.join(', ')}]`);
        } else {
          // Cursor is on a DIFFERENT token inside this symbol's body.
          // The containing symbol becomes part of the scope chain.
          // The cursor word is the actual symbol we're identifying.
          const scopeChain = [...match.ancestors.map(a => a.name), sym.name];

          // Check if it's a child DocumentSymbol (e.g. class members reported by clangd)
          const childMatch = sym.children.find(c => c.name === word && c.selectionRange.start.line === position.line);
          if (childMatch) {
            // It's a child document symbol (class member, nested function, etc.)
            const childKind = mapVscodeSymbolKind(childMatch.kind);
            addressFromDocSymbol = buildAddress(relPath, scopeChain, childKind, word);

            _sub('From Document Symbol (child of container)');
            _line(`  Name:        ${word}`);
            _line(`  Kind:        ${childKind} (prefix: ${SYMBOL_KIND_PREFIX[childKind] || 'sym'})`);
            _line(`  Container:   ${sym.name} (${vscode.SymbolKind[sym.kind]})`);
            _line(`  Scope Chain: [${scopeChain.join(', ')}]`);
          } else {
            // Not a child DocumentSymbol — likely a local variable, parameter, or
            // reference to an external symbol. Determine kind from context.
            const containerKind = mapVscodeSymbolKind(sym.kind);
            let symbolKind: SymbolKindType;

            if (inferredKind) {
              symbolKind = inferredKind;
            } else if (containerKind === 'class' || containerKind === 'interface') {
              symbolKind = 'property';  // inside a class → likely a member
            } else if (containerKind === 'function' || containerKind === 'method') {
              symbolKind = 'variable';  // inside a function → likely a local var or param
            } else {
              symbolKind = 'variable';
            }

            addressFromDocSymbol = buildAddress(relPath, scopeChain, symbolKind, word);

            _sub('From Document Symbol (token inside container)');
            _line(`  Name:        ${word}`);
            _line(`  Kind:        ${symbolKind} (prefix: ${SYMBOL_KIND_PREFIX[symbolKind] || 'sym'})${inferredKind ? ' (from hover)' : ' (inferred from container)'}`);
            _line(`  Container:   ${sym.name} (${vscode.SymbolKind[sym.kind]})`);
            _line(`  Scope Chain: [${scopeChain.join(', ')}]`);
          }
        }

        _line(`  Address:     ${addressFromDocSymbol}`);
        _line(`  Cache Path:  ${addressToCachePath(addressFromDocSymbol)}`);
        // Legacy cache key
        const parsed = _addressToLegacyKey(addressFromDocSymbol);
        _line(`  Legacy Key:  ${parsed}`);
        _line(`  Cache File:  .vscode/${CACHE.DIR_NAME}/${relPath}/${parsed}.md`);
      } else {
        _line('  (cursor not inside any document symbol — cannot derive address)');
      }
    }

    // ---- Strategy 2: From Definition Provider (resolves to definition site) ----
    if (definitions.status === 'fulfilled' && definitions.value && definitions.value.length > 0) {
      const def = definitions.value[0];
      const defUri = 'targetUri' in def ? def.targetUri : def.uri;
      const defRange = 'targetRange' in def ? def.targetRange : def.range;
      const defRelPath = path.relative(workspaceRoot, defUri.fsPath);
      const defPosition = defRange.start;

      const isDifferentFile = defUri.fsPath !== uri.fsPath;
      const isDifferentPos = defPosition.line !== position.line || defPosition.character !== position.character;

      if (isDifferentFile || isDifferentPos) {
        try {
          const defDocSymbols = isDifferentFile
            ? await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider', defUri
              )
            : (docSymbols.status === 'fulfilled' ? docSymbols.value : null);

          if (defDocSymbols) {
            const defMatch = findDeepestSymbol(defDocSymbols, defPosition);
            if (defMatch) {
              const defSym = defMatch.symbol;
              const cursorOnDefName = defSym.selectionRange.contains(defPosition) && defSym.name === word;

              let defAddress: string;
              if (cursorOnDefName) {
                // Definition IS this document symbol
                const defKind = mapVscodeSymbolKind(defSym.kind);
                const defScopeChain = defMatch.ancestors.map(a => a.name);
                defAddress = buildAddress(defRelPath, defScopeChain, defKind, defSym.name);
              } else {
                // Definition is a sub-token inside a container (local var, member, param)
                const defScopeChain = [...defMatch.ancestors.map(a => a.name), defSym.name];

                // Check children
                const defChild = defSym.children.find(c => c.name === word && c.selectionRange.start.line === defPosition.line);
                if (defChild) {
                  const childKind = mapVscodeSymbolKind(defChild.kind);
                  defAddress = buildAddress(defRelPath, defScopeChain, childKind, word);
                } else {
                  const containerKind = mapVscodeSymbolKind(defSym.kind);
                  let symbolKind: SymbolKindType;
                  if (inferredKind) {
                    symbolKind = inferredKind;
                  } else if (containerKind === 'class' || containerKind === 'interface') {
                    symbolKind = 'property';
                  } else {
                    symbolKind = 'variable';
                  }
                  defAddress = buildAddress(defRelPath, defScopeChain, symbolKind, word);
                }
              }

              addressFromDefinition = defAddress;

              _sub('From Definition Provider (definition site)');
              _line(`  Def File:    ${defRelPath}`);
              _line(`  Address:     ${addressFromDefinition}`);
              _line(`  Cache Path:  ${addressToCachePath(addressFromDefinition)}`);
            }
          }
        } catch {
          _line('  (could not resolve document symbols at definition site)');
        }
      }
    }

    // ---- Strategy 3: From Tree-Sitter Symbol Index ----
    _sub('From Tree-Sitter Symbol Index (if available)');
    try {
      const indexPath = path.join(workspaceRoot, '.vscode', CACHE.DIR_NAME, '_symbol_index.json');
      const indexUri = vscode.Uri.file(indexPath);
      const indexDoc = await vscode.workspace.openTextDocument(indexUri);
      const indexData = JSON.parse(indexDoc.getText());

      const fileEntry = indexData.files?.[relPath];
      if (fileEntry && fileEntry.symbols) {
        type IndexSymbol = {
          address: string;
          name: string;
          kind: string;
          startLine: number;
          endLine: number;
          startColumn: number;
          scopeChain: string[];
          paramSignature: string | null;
          overloadDiscriminator: string | null;
          isLocal: boolean;
        };
        const symbols = fileEntry.symbols as IndexSymbol[];

        // Prefer an exact name match at the cursor line, then fall back to deepest containing
        const exactMatch = symbols.find(
          (s: IndexSymbol) => s.name === word && position.line >= s.startLine && position.line <= s.endLine
        );

        const containing = symbols.filter(
          (s: IndexSymbol) => position.line >= s.startLine && position.line <= s.endLine
        );
        containing.sort((a: IndexSymbol, b: IndexSymbol) => {
          const scopeDiff = b.scopeChain.length - a.scopeChain.length;
          if (scopeDiff !== 0) {
            return scopeDiff;
          }
          return (a.endLine - a.startLine) - (b.endLine - b.startLine);
        });

        const best = exactMatch || containing[0];
        if (best) {
          _line(`  Name:            ${best.name}`);
          _line(`  Kind:            ${best.kind}`);
          _line(`  Address:         ${best.address}`);
          _line(`  Scope Chain:     [${best.scopeChain.join(', ')}]`);
          _line(`  Range:           L${best.startLine + 1}-L${best.endLine + 1}`);
          _line(`  Param Signature: ${best.paramSignature ?? '(none)'}`);
          _line(`  Discriminator:   ${best.overloadDiscriminator ?? '(none)'}`);
          _line(`  Is Local:        ${best.isLocal}`);
          _line(`  Cache Path:      ${addressToCachePath(best.address)}`);
          if (exactMatch && containing[0] && exactMatch.address !== containing[0].address) {
            _line(`  (exact name match found — "${word}" matched over deepest container "${containing[0].name}")`);
          }
        } else {
          _line('  (cursor not inside any indexed symbol in this file)');
        }
      } else {
        _line(`  (file "${relPath}" not found in symbol index)`);
      }
    } catch {
      _line('  (symbol index not available — run tree-sitter indexing first)');
    }

    // ---- Recommended Address ----
    _sub('Recommended Address');
    const bestAddress = addressFromDefinition || addressFromDocSymbol;
    if (bestAddress) {
      _line(`  ${bestAddress}`);
    } else {
      const fallbackAddress = buildAddress(relPath, [], 'unknown', word);
      _line(`  ${fallbackAddress}  (fallback — could not resolve symbol structure)`);
    }
  }

  /* ---- 2. Definition ---- */
  _heading('2. DEFINITION (go-to-definition)');
  if (definitions.status === 'fulfilled' && definitions.value) {
    const defs = definitions.value;
    _line(`Found ${defs.length} definition(s):`);
    for (const def of defs) {
      const defUri = 'targetUri' in def ? def.targetUri : def.uri;
      const defRange = 'targetRange' in def ? def.targetRange : def.range;
      const defSelRange = 'targetSelectionRange' in def ? def.targetSelectionRange : undefined;
      const defRelPath = path.relative(workspaceRoot, defUri.fsPath);
      _line(`  File:             ${defRelPath}`);
      _line(`  Range:            ${_fmtRange(defRange)}`);
      if (defSelRange) {
        _line(`  Selection Range:  ${_fmtRange(defSelRange)}`);
      }
      // Read the definition line(s)
      try {
        const defDoc = await vscode.workspace.openTextDocument(defUri);
        const startLine = defRange.start.line;
        const endLine = Math.min(defRange.end.line, startLine + 10);
        for (let i = startLine; i <= endLine; i++) {
          _line(`    ${(i + 1).toString().padStart(5)}| ${defDoc.lineAt(i).text}`);
        }
      } catch {
        _line('    (could not read definition source)');
      }
      _line('');
    }
  } else {
    _line(_rejected(definitions));
  }

  /* ---- 3. Type Definition ---- */
  _heading('3. TYPE DEFINITION (go-to-type-definition)');
  if (typeDefinitions.status === 'fulfilled' && typeDefinitions.value) {
    const typeDefs = typeDefinitions.value;
    _line(`Found ${typeDefs.length} type definition(s):`);
    for (const td of typeDefs) {
      const tdUri = 'targetUri' in td ? td.targetUri : td.uri;
      const tdRange = 'targetRange' in td ? td.targetRange : td.range;
      const tdRelPath = path.relative(workspaceRoot, tdUri.fsPath);
      _line(`  File:   ${tdRelPath}`);
      _line(`  Range:  ${_fmtRange(tdRange)}`);
      // Read the type definition line(s)
      try {
        const tdDoc = await vscode.workspace.openTextDocument(tdUri);
        const startLine = tdRange.start.line;
        const endLine = Math.min(tdRange.end.line, startLine + 15);
        for (let i = startLine; i <= endLine; i++) {
          _line(`    ${(i + 1).toString().padStart(5)}| ${tdDoc.lineAt(i).text}`);
        }
      } catch {
        _line('    (could not read type definition source)');
      }
      _line('');
    }
  } else {
    _line(_rejected(typeDefinitions));
  }

  /* ---- 4. Hover Info (type + docs) ---- */
  _heading('4. HOVER INFO (type signature, documentation)');
  if (hovers.status === 'fulfilled' && hovers.value) {
    const hoverList = hovers.value;
    _line(`Found ${hoverList.length} hover result(s):`);
    for (let i = 0; i < hoverList.length; i++) {
      const hover = hoverList[i];
      _sub(`Hover result ${i + 1}`);
      for (const content of hover.contents) {
        if (typeof content === 'string') {
          _line(content);
        } else if (content instanceof vscode.MarkdownString) {
          _line(content.value);
        } else if ('language' in content && 'value' in content) {
          // MarkedString { language, value }
          _line(`\`\`\`${content.language}`);
          _line(content.value);
          _line('```');
        }
      }
    }
  } else {
    _line(_rejected(hovers));
  }

  /* ---- 5. References ---- */
  _heading('5. REFERENCES (find all references)');
  if (references.status === 'fulfilled' && references.value) {
    const refs = references.value;
    _line(`Found ${refs.length} reference(s):`);
    // Group by file
    const byFile = new Map<string, vscode.Location[]>();
    for (const ref of refs) {
      const rp = path.relative(workspaceRoot, ref.uri.fsPath);
      if (!byFile.has(rp)) {
        byFile.set(rp, []);
      }
      byFile.get(rp)!.push(ref);
    }
    for (const [file, locs] of byFile) {
      _line(`  ${file} (${locs.length}):`);
      for (const loc of locs.slice(0, 20)) {
        let contextLine = '';
        try {
          const refDoc = await vscode.workspace.openTextDocument(loc.uri);
          contextLine = refDoc.lineAt(loc.range.start.line).text.trim();
        } catch {
          // ignore
        }
        _line(`    L${loc.range.start.line + 1}:${loc.range.start.character + 1}  ${contextLine}`);
      }
      if (locs.length > 20) {
        _line(`    ... and ${locs.length - 20} more`);
      }
    }
  } else {
    _line(_rejected(references));
  }

  /* ---- 6. Call Hierarchy ---- */
  _heading('6. CALL HIERARCHY');
  if (callHierarchyItems.status === 'fulfilled' && callHierarchyItems.value && callHierarchyItems.value.length > 0) {
    const items = callHierarchyItems.value;
    for (const item of items) {
      _line(`Prepared: ${item.name} (${vscode.SymbolKind[item.kind]})`);
      _line(`  File:   ${path.relative(workspaceRoot, item.uri.fsPath)}`);
      _line(`  Range:  ${_fmtRange(item.range)}`);
      _line(`  Detail: ${item.detail || '(none)'}`);

      // Incoming calls
      try {
        const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
          'vscode.provideIncomingCalls', item
        );
        if (incoming && incoming.length > 0) {
          _sub(`Incoming callers (${incoming.length})`);
          for (const call of incoming.slice(0, 20)) {
            const callerPath = path.relative(workspaceRoot, call.from.uri.fsPath);
            _line(`  ${call.from.name} (${vscode.SymbolKind[call.from.kind]})  ${callerPath}:${call.from.range.start.line + 1}`);
            for (const r of call.fromRanges) {
              _line(`    call site: L${r.start.line + 1}:${r.start.character + 1}`);
            }
          }
          if (incoming.length > 20) {
            _line(`  ... and ${incoming.length - 20} more`);
          }
        } else {
          _line('  Incoming callers: (none)');
        }
      } catch (err) {
        _line(`  Incoming callers: (error: ${err})`);
      }

      // Outgoing calls
      try {
        const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
          'vscode.provideOutgoingCalls', item
        );
        if (outgoing && outgoing.length > 0) {
          _sub(`Outgoing calls (${outgoing.length})`);
          for (const call of outgoing.slice(0, 20)) {
            const calleePath = path.relative(workspaceRoot, call.to.uri.fsPath);
            _line(`  ${call.to.name} (${vscode.SymbolKind[call.to.kind]})  ${calleePath}:${call.to.range.start.line + 1}`);
            for (const r of call.fromRanges) {
              _line(`    call site: L${r.start.line + 1}:${r.start.character + 1}`);
            }
          }
          if (outgoing.length > 20) {
            _line(`  ... and ${outgoing.length - 20} more`);
          }
        } else {
          _line('  Outgoing calls: (none)');
        }
      } catch (err) {
        _line(`  Outgoing calls: (error: ${err})`);
      }
    }
  } else {
    _line(callHierarchyItems.status === 'rejected'
      ? _rejected(callHierarchyItems)
      : '(no call hierarchy available for this symbol)');
  }

  /* ---- 7. Type Hierarchy ---- */
  _heading('7. TYPE HIERARCHY (supertypes / subtypes)');
  if (typeHierarchyItems.status === 'fulfilled' && typeHierarchyItems.value && typeHierarchyItems.value.length > 0) {
    const items = typeHierarchyItems.value;
    for (const item of items) {
      _line(`Prepared: ${item.name} (${vscode.SymbolKind[item.kind]})`);
      _line(`  File:   ${path.relative(workspaceRoot, item.uri.fsPath)}`);
      _line(`  Range:  ${_fmtRange(item.range)}`);
      _line(`  Detail: ${item.detail || '(none)'}`);

      // Supertypes
      try {
        const supers = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
          'vscode.provideSupertypes', item
        );
        if (supers && supers.length > 0) {
          _sub(`Supertypes (${supers.length})`);
          for (const st of supers) {
            _line(`  ${st.name} (${vscode.SymbolKind[st.kind]})  ${path.relative(workspaceRoot, st.uri.fsPath)}:${st.range.start.line + 1}`);
          }
        } else {
          _line('  Supertypes: (none)');
        }
      } catch (err) {
        _line(`  Supertypes: (error: ${err})`);
      }

      // Subtypes
      try {
        const subs = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
          'vscode.provideSubtypes', item
        );
        if (subs && subs.length > 0) {
          _sub(`Subtypes (${subs.length})`);
          for (const st of subs) {
            _line(`  ${st.name} (${vscode.SymbolKind[st.kind]})  ${path.relative(workspaceRoot, st.uri.fsPath)}:${st.range.start.line + 1}`);
          }
        } else {
          _line('  Subtypes: (none)');
        }
      } catch (err) {
        _line(`  Subtypes: (error: ${err})`);
      }
    }
  } else {
    _line(typeHierarchyItems.status === 'rejected'
      ? _rejected(typeHierarchyItems)
      : '(no type hierarchy available for this symbol)');
  }

  /* ---- 8. Implementation ---- */
  _heading('8. IMPLEMENTATION (go-to-implementation)');
  if (implementations.status === 'fulfilled' && implementations.value) {
    const impls = implementations.value;
    _line(`Found ${impls.length} implementation(s):`);
    for (const impl of impls) {
      const implUri = 'targetUri' in impl ? impl.targetUri : impl.uri;
      const implRange = 'targetRange' in impl ? impl.targetRange : impl.range;
      const implRelPath = path.relative(workspaceRoot, implUri.fsPath);
      _line(`  ${implRelPath}  ${_fmtRange(implRange)}`);
      try {
        const implDoc = await vscode.workspace.openTextDocument(implUri);
        const ln = implRange.start.line;
        _line(`    ${(ln + 1).toString().padStart(5)}| ${implDoc.lineAt(ln).text}`);
      } catch {
        // ignore
      }
    }
  } else {
    _line(_rejected(implementations));
  }

  /* ---- 9. Signature Help ---- */
  _heading('9. SIGNATURE HELP (function signature at cursor)');
  if (signatureHelp.status === 'fulfilled' && signatureHelp.value) {
    const sh = signatureHelp.value;
    _line(`Active signature index: ${sh.activeSignature}`);
    _line(`Active parameter index: ${sh.activeParameter}`);
    for (let i = 0; i < sh.signatures.length; i++) {
      const sig = sh.signatures[i];
      _sub(`Signature ${i + 1}`);
      _line(`  Label: ${sig.label}`);
      if (sig.documentation) {
        const docStr = typeof sig.documentation === 'string'
          ? sig.documentation
          : sig.documentation.value;
        _line(`  Documentation: ${docStr}`);
      }
      if (sig.parameters.length > 0) {
        _line(`  Parameters (${sig.parameters.length}):`);
        for (const param of sig.parameters) {
          const paramLabel = typeof param.label === 'string'
            ? param.label
            : sig.label.substring(param.label[0], param.label[1]);
          const paramDoc = param.documentation
            ? (typeof param.documentation === 'string' ? param.documentation : param.documentation.value)
            : '';
          _line(`    ${paramLabel}${paramDoc ? '  — ' + paramDoc : ''}`);
        }
      }
    }
  } else {
    _line(signatureHelp.status === 'rejected'
      ? _rejected(signatureHelp)
      : '(no signature help available at this position — try placing cursor inside function call parentheses)');
  }

  /* ---- 10. Document Highlights ---- */
  _heading('10. DOCUMENT HIGHLIGHTS (same-file occurrences)');
  if (highlights.status === 'fulfilled' && highlights.value) {
    const hl = highlights.value;
    const kindNames = ['Text', 'Read', 'Write'];
    _line(`Found ${hl.length} highlight(s):`);
    for (const h of hl.slice(0, 30)) {
      const kindLabel = h.kind !== undefined ? kindNames[h.kind] || 'Unknown' : 'Text';
      let contextLine = '';
      try {
        contextLine = document.lineAt(h.range.start.line).text.trim();
      } catch {
        // ignore
      }
      _line(`  [${kindLabel.padEnd(5)}]  L${h.range.start.line + 1}:${h.range.start.character + 1}  ${contextLine}`);
    }
    if (hl.length > 30) {
      _line(`  ... and ${hl.length - 30} more`);
    }
  } else {
    _line(_rejected(highlights));
  }

  /* ---- 11. Completions at cursor ---- */
  _heading('11. COMPLETIONS (top items at cursor position)');
  try {
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider', uri, position
    );
    if (completions && completions.items.length > 0) {
      _line(`Found ${completions.items.length} completion(s) (showing top 15):`);
      const completionKindNames: Record<number, string> = {
        [vscode.CompletionItemKind.Text]: 'Text',
        [vscode.CompletionItemKind.Method]: 'Method',
        [vscode.CompletionItemKind.Function]: 'Function',
        [vscode.CompletionItemKind.Constructor]: 'Constructor',
        [vscode.CompletionItemKind.Field]: 'Field',
        [vscode.CompletionItemKind.Variable]: 'Variable',
        [vscode.CompletionItemKind.Class]: 'Class',
        [vscode.CompletionItemKind.Interface]: 'Interface',
        [vscode.CompletionItemKind.Module]: 'Module',
        [vscode.CompletionItemKind.Property]: 'Property',
        [vscode.CompletionItemKind.Unit]: 'Unit',
        [vscode.CompletionItemKind.Value]: 'Value',
        [vscode.CompletionItemKind.Enum]: 'Enum',
        [vscode.CompletionItemKind.Keyword]: 'Keyword',
        [vscode.CompletionItemKind.Snippet]: 'Snippet',
        [vscode.CompletionItemKind.Color]: 'Color',
        [vscode.CompletionItemKind.File]: 'File',
        [vscode.CompletionItemKind.Reference]: 'Reference',
        [vscode.CompletionItemKind.Folder]: 'Folder',
        [vscode.CompletionItemKind.EnumMember]: 'EnumMember',
        [vscode.CompletionItemKind.Constant]: 'Constant',
        [vscode.CompletionItemKind.Struct]: 'Struct',
        [vscode.CompletionItemKind.Event]: 'Event',
        [vscode.CompletionItemKind.Operator]: 'Operator',
        [vscode.CompletionItemKind.TypeParameter]: 'TypeParam',
      };
      for (const item of completions.items.slice(0, 15)) {
        const label = typeof item.label === 'string' ? item.label : item.label.label;
        const kindName = item.kind !== undefined ? (completionKindNames[item.kind] || `Kind(${item.kind})`) : '?';
        const detail = item.detail ? `  — ${item.detail}` : '';
        _line(`  [${kindName.padEnd(12)}]  ${label}${detail}`);
      }
      if (completions.items.length > 15) {
        _line(`  ... and ${completions.items.length - 15} more`);
      }
    } else {
      _line('(no completions)');
    }
  } catch (err) {
    _line(`(error fetching completions: ${err})`);
  }

  /* ---- Summary ---- */
  _heading('SUMMARY');
  _line(`Symbol:          "${word}"`);
  _line(`Language Server:  ${document.languageId}`);
  _line(`Providers tested: 11`);
  _line('');
  _line('Provider availability:');

  const _avail = (name: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === 'rejected') {
      _line(`  ${name.padEnd(25)} ERROR`);
    } else if (result.value === null || result.value === undefined || (Array.isArray(result.value) && result.value.length === 0)) {
      _line(`  ${name.padEnd(25)} no data`);
    } else if (Array.isArray(result.value)) {
      _line(`  ${name.padEnd(25)} ${result.value.length} result(s)`);
    } else {
      _line(`  ${name.padEnd(25)} available`);
    }
  };

  _avail('Document Symbols', docSymbols);
  _avail('Definition', definitions);
  _avail('Type Definition', typeDefinitions);
  _avail('Hover', hovers);
  _avail('References', references);
  _avail('Call Hierarchy', callHierarchyItems);
  _avail('Type Hierarchy', typeHierarchyItems);
  _avail('Implementation', implementations);
  _avail('Signature Help', signatureHelp);
  _avail('Document Highlights', highlights);

  // Write to new untitled document
  const content = lines.join('\n');
  const newDoc = await vscode.workspace.openTextDocument({
    content,
    language: 'plaintext',
  });
  await vscode.window.showTextDocument(newDoc, { viewColumn: vscode.ViewColumn.Beside, preview: false });

  logger.info(`showSymbolInfo: wrote ${lines.length} lines for "${word}"`);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function _fmtRange(range: vscode.Range): string {
  return `L${range.start.line + 1}:${range.start.character + 1} - L${range.end.line + 1}:${range.end.character + 1}`;
}

function _rejected(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'rejected') {
    return `(error: ${result.reason})`;
  }
  if (result.status === 'fulfilled' && (result.value === null || result.value === undefined)) {
    return '(not available — language server may not support this provider)';
  }
  if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length === 0) {
    return '(no results)';
  }
  return '(unknown state)';
}

/**
 * Infer the symbol kind from hover contents.
 *
 * Language servers like clangd and tsserver return hover text containing
 * type signatures. We parse these to distinguish between variables,
 * parameters, fields, functions, classes, etc.
 *
 * Returns null if we cannot determine the kind from hover info.
 */
function _inferKindFromHover(
  hoverResults: vscode.Hover[] | null | undefined,
  _word: string
): SymbolKindType | null {
  if (!hoverResults || hoverResults.length === 0) {
    return null;
  }

  // Collect all hover text into a single string for pattern matching
  const texts: string[] = [];
  for (const hover of hoverResults) {
    for (const content of hover.contents) {
      if (typeof content === 'string') {
        texts.push(content);
      } else if (content instanceof vscode.MarkdownString) {
        texts.push(content.value);
      } else if ('value' in content) {
        texts.push(content.value);
      }
    }
  }
  const combined = texts.join('\n');

  // Pattern matching on hover text (works with clangd, tsserver, etc.)
  // Order matters — check more specific patterns first.

  // Class / struct
  if (/\b(class|struct)\s/i.test(combined)) {
    // Make sure it's the definition, not just a type reference inside a var decl
    // e.g., "class Foo" vs "Foo *ptr" — only match if "class" appears as the leading keyword
    if (/^```\w*\n\s*(class|struct)\s/m.test(combined) || /^\s*(class|struct)\s/m.test(combined)) {
      return 'class';
    }
  }

  // Enum
  if (/^```\w*\n\s*enum\s/m.test(combined) || /^\s*enum\s/m.test(combined)) {
    return 'enum';
  }

  // Interface (TypeScript)
  if (/^```\w*\n\s*interface\s/m.test(combined) || /^\s*interface\s/m.test(combined)) {
    return 'interface';
  }

  // Function / method (look for parentheses in the signature)
  // clangd: "void foo(int x)" / "auto foo(int x) -> int"
  // tsserver: "(method) Foo.bar(): void" / "(function) baz(): number"
  if (/\(method\)/i.test(combined)) {
    return 'method';
  }
  if (/\(function\)/i.test(combined)) {
    return 'function';
  }
  // Generic function signature: name followed by parameter list
  if (/\w+\s*\([^)]*\)\s*(->|:|\{|;|$)/m.test(combined)) {
    return 'function';
  }

  // Parameter (tsserver: "(parameter) name: type")
  if (/\(parameter\)/i.test(combined)) {
    return 'parameter';
  }

  // Property / field (tsserver: "(property) Foo.bar: type")
  if (/\(property\)/i.test(combined) || /\(field\)/i.test(combined)) {
    return 'property';
  }

  // Local variable (tsserver: "(local var)" or just "let/const/var name: type")
  if (/\(local var\)/i.test(combined)) {
    return 'variable';
  }

  // clangd typically shows just the type for variables/fields, e.g.:
  // "int count" or "std::string name" — if it's a simple type + name and no parens, it's a variable
  if (/^```\w*\n\s*[\w:<>&*\s]+\s+\w+\s*$/m.test(combined)) {
    return 'variable';
  }

  return null;
}

/**
 * Convert a symbol address to a legacy cache key string.
 * Address format: `file#scope::kind.name[~disc]`
 * Legacy key format: `scope.kind.name` (:: replaced with .)
 */
function _addressToLegacyKey(address: string): string {
  const hashIdx = address.indexOf('#');
  if (hashIdx < 0) {
    return address;
  }
  const symbolPart = address.slice(hashIdx + 1);
  // Replace :: with . and strip discriminator
  let key = symbolPart.replace(/::/g, '.');
  const tildeIdx = key.indexOf('~');
  if (tildeIdx >= 0) {
    key = key.slice(0, tildeIdx);
  }
  return key;
}
