/**
 * Code Explorer — Base Symbol Extractor
 *
 * Abstract base class for language-specific tree-sitter symbol extractors.
 * Provides shared logic for address building, scope chain management,
 * and overload discriminator assignment.
 */
import type Parser from 'tree-sitter';
import type { SymbolKindType } from '../../models/types';
import type { SymbolIndexEntry } from '../SymbolIndex';
import { buildAddress, computeDiscriminator } from '../SymbolAddress';

/**
 * Raw extracted symbol before overload discriminators are assigned.
 * The `address` field is built without a discriminator initially;
 * `assignOverloadDiscriminators()` updates it if needed.
 */
export interface RawExtractedSymbol {
  name: string;
  kind: SymbolKindType;
  startLine: number;
  endLine: number;
  startColumn: number;
  scopeChain: string[];
  paramSignature: string | null;
  isLocal: boolean;
}

/**
 * Abstract base class for language-specific symbol extractors.
 *
 * Subclasses implement `extractRaw()` and `extractParamSignature()`
 * for their language's AST node types.
 */
export abstract class BaseExtractor {
  /**
   * Extract all symbol definitions from an AST root node.
   * This is the main entry point: extracts raw symbols, then
   * assigns overload discriminators for duplicates.
   *
   * @param rootNode Tree-sitter root node.
   * @param filePath Relative file path from workspace root.
   * @param sourceHash SHA-256 hash of the source file content.
   * @returns Array of fully resolved SymbolIndexEntry objects.
   */
  extract(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    sourceHash: string
  ): SymbolIndexEntry[] {
    const rawSymbols = this.extractRaw(rootNode, filePath);
    return this._resolveEntries(rawSymbols, filePath, sourceHash);
  }

  /**
   * Language-specific: extract raw symbols from the AST.
   * Subclasses walk the AST and return raw symbol data without
   * overload discriminators.
   */
  protected abstract extractRaw(
    rootNode: Parser.SyntaxNode,
    filePath: string
  ): RawExtractedSymbol[];

  /**
   * Language-specific: extract and normalize the parameter type list
   * from a function/method AST node.
   * Returns null for non-callable symbols.
   */
  protected abstract extractParamSignature(node: Parser.SyntaxNode): string | null;

  /**
   * Resolve raw extracted symbols into SymbolIndexEntry objects,
   * assigning overload discriminators where needed.
   */
  private _resolveEntries(
    rawSymbols: RawExtractedSymbol[],
    filePath: string,
    sourceHash: string
  ): SymbolIndexEntry[] {
    // Build initial addresses (without discriminators)
    const withAddresses = rawSymbols.map((raw) => ({
      raw,
      baseAddress: buildAddress(filePath, raw.scopeChain, raw.kind, raw.name),
    }));

    // Group by base address to detect overloads
    const groups = new Map<string, typeof withAddresses>();
    for (const item of withAddresses) {
      const group = groups.get(item.baseAddress);
      if (group) {
        group.push(item);
      } else {
        groups.set(item.baseAddress, [item]);
      }
    }

    // Build final entries, assigning discriminators for overloaded groups
    const entries: SymbolIndexEntry[] = [];
    for (const [_baseAddress, group] of groups) {
      if (group.length === 1) {
        // No overload — use base address without discriminator
        const { raw } = group[0];
        entries.push({
          address: buildAddress(filePath, raw.scopeChain, raw.kind, raw.name),
          name: raw.name,
          kind: raw.kind,
          filePath,
          startLine: raw.startLine,
          endLine: raw.endLine,
          startColumn: raw.startColumn,
          scopeChain: raw.scopeChain,
          paramSignature: raw.paramSignature,
          overloadDiscriminator: null,
          sourceHash,
          isLocal: raw.isLocal,
        });
      } else {
        // Overloaded — assign discriminators from param signature hashes
        for (const { raw } of group) {
          const sig = raw.paramSignature ?? '';
          const discriminator = computeDiscriminator(sig);
          entries.push({
            address: buildAddress(
              filePath,
              raw.scopeChain,
              raw.kind,
              raw.name,
              discriminator
            ),
            name: raw.name,
            kind: raw.kind,
            filePath,
            startLine: raw.startLine,
            endLine: raw.endLine,
            startColumn: raw.startColumn,
            scopeChain: raw.scopeChain,
            paramSignature: raw.paramSignature,
            overloadDiscriminator: discriminator,
            sourceHash,
            isLocal: raw.isLocal,
          });
        }
      }
    }

    return entries;
  }
}
