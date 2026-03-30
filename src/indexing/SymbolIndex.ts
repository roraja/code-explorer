/**
 * Code Explorer — Symbol Index
 *
 * In-memory index of all symbols extracted by tree-sitter, with multiple
 * lookup strategies (by address, by name, by file, by cursor position).
 * Persists to / loads from JSON on disk for fast startup.
 *
 * IMPORTANT: A symbol's identity is its `address` field, which is derived
 * from the AST structure (filePath + scopeChain + kind + name + discriminator).
 * Line numbers are navigation metadata only — never used as identity keys.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SymbolKindType } from '../models/types';
import { CACHE } from '../models/constants';
import { logger } from '../utils/logger';
import { addressToCachePath } from './SymbolAddress';

/** Version of the index format for migration support. */
export const SYMBOL_INDEX_VERSION = '1.0.0';

/** File name for the persisted index. */
export const SYMBOL_INDEX_FILE = '_symbol_index.json';

/**
 * A single entry in the symbol index.
 * Represents one symbol definition found by tree-sitter.
 *
 * The symbol's identity is determined by its `address` field,
 * which is derived from (filePath + scopeChain + kind + name + overloadDiscriminator).
 * Line numbers are metadata for navigation — they are NOT part of identity.
 */
export interface SymbolIndexEntry {
  /** Full symbol address (file#scope::kind.name[~discriminator]) — the identity key */
  address: string;
  /** Symbol name (just the identifier) */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** Relative file path from workspace root */
  filePath: string;
  /**
   * Start line (0-based) — navigation metadata, NOT part of identity.
   * Updated on every re-index; never used for address computation or cache key derivation.
   */
  startLine: number;
  /** End line (0-based) — navigation metadata */
  endLine: number;
  /** Start column (0-based) — navigation metadata */
  startColumn: number;
  /** Scope chain (ancestor names, root to parent) */
  scopeChain: string[];
  /**
   * Normalized parameter signature for functions/methods.
   * Used to compute the overload discriminator hash.
   * Null for non-callable symbols (variables, classes, etc.).
   */
  paramSignature: string | null;
  /**
   * Overload discriminator suffix (e.g., "a3f2").
   * Present only when this symbol is one of multiple overloads sharing the same
   * scope::kind.name. Derived from paramSignature hash.
   */
  overloadDiscriminator: string | null;
  /** Hash of the source file when this entry was indexed */
  sourceHash: string;
  /** Whether this is a local variable inside a function body */
  isLocal: boolean;
}

/**
 * Serialized per-file data for JSON persistence.
 */
interface SerializedFileEntry {
  hash: string;
  indexedAt: string;
  symbols: Omit<SymbolIndexEntry, 'filePath' | 'sourceHash'>[];
}

/**
 * Top-level JSON structure for the persisted index.
 */
interface SerializedIndex {
  version: string;
  lastRebuilt: string;
  symbolCount: number;
  files: Record<string, SerializedFileEntry>;
}

/**
 * In-memory symbol index with multiple lookup strategies.
 */
export class SymbolIndex {
  /** Primary lookup: address -> entry */
  private readonly _byAddress = new Map<string, SymbolIndexEntry>();

  /** Name lookup: symbol name -> entries[] (may include overloads) */
  private readonly _byName = new Map<string, SymbolIndexEntry[]>();

  /** File lookup: relative file path -> entries[] */
  private readonly _byFile = new Map<string, SymbolIndexEntry[]>();

  /**
   * Cursor lookup: file path -> entries sorted by startLine.
   * Rebuilt lazily when entries for a file change.
   */
  private readonly _byFileSorted = new Map<string, SymbolIndexEntry[]>();

  /** Per-file source hash (used to detect changes on re-index) */
  private readonly _fileHashes = new Map<string, string>();

  /** When the index was last fully rebuilt */
  private _lastRebuilt: string = new Date().toISOString();

  /** Path to workspace root (for persistence) */
  private readonly _workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this._workspaceRoot = workspaceRoot;
  }

  // ────────────── Accessors ──────────────

  /** Total number of indexed symbols. */
  get symbolCount(): number {
    return this._byAddress.size;
  }

  /** Get all indexed file paths. */
  get indexedFiles(): string[] {
    return [...this._byFile.keys()];
  }

  // ────────────── Insert / Remove ──────────────

  /**
   * Add entries for a file, replacing any previous entries for that file.
   * Rebuilds the sorted-by-line index for cursor resolution.
   *
   * @param filePath Relative file path from workspace root.
   * @param entries Symbol entries extracted from the file.
   * @param sourceHash SHA-256 hash of the file content.
   */
  addFileEntries(filePath: string, entries: SymbolIndexEntry[], sourceHash: string): void {
    // Remove old entries for this file first
    this.removeFile(filePath);

    // Store the source hash
    this._fileHashes.set(filePath, sourceHash);

    // Insert new entries
    const fileEntries: SymbolIndexEntry[] = [];
    for (const entry of entries) {
      this._byAddress.set(entry.address, entry);

      const nameEntries = this._byName.get(entry.name);
      if (nameEntries) {
        nameEntries.push(entry);
      } else {
        this._byName.set(entry.name, [entry]);
      }

      fileEntries.push(entry);
    }

    this._byFile.set(filePath, fileEntries);

    // Build sorted-by-line index for cursor resolution
    const sorted = [...fileEntries].sort((a, b) => a.startLine - b.startLine);
    this._byFileSorted.set(filePath, sorted);
  }

  /**
   * Remove all entries for a file.
   */
  removeFile(filePath: string): void {
    const existing = this._byFile.get(filePath);
    if (!existing) {
      return;
    }

    for (const entry of existing) {
      this._byAddress.delete(entry.address);

      // Remove from byName
      const nameEntries = this._byName.get(entry.name);
      if (nameEntries) {
        const filtered = nameEntries.filter((e) => e.address !== entry.address);
        if (filtered.length > 0) {
          this._byName.set(entry.name, filtered);
        } else {
          this._byName.delete(entry.name);
        }
      }
    }

    this._byFile.delete(filePath);
    this._byFileSorted.delete(filePath);
    this._fileHashes.delete(filePath);
  }

  /** Clear the entire index. */
  clear(): void {
    this._byAddress.clear();
    this._byName.clear();
    this._byFile.clear();
    this._byFileSorted.clear();
    this._fileHashes.clear();
  }

  // ────────────── Lookups ──────────────

  /**
   * Look up a symbol by its full address. O(1).
   */
  getByAddress(address: string): SymbolIndexEntry | undefined {
    return this._byAddress.get(address);
  }

  /**
   * Look up all symbols with a given name.
   * Returns an array (may contain overloads, same-name symbols in different files/scopes).
   */
  getByName(name: string): SymbolIndexEntry[] {
    return this._byName.get(name) || [];
  }

  /**
   * Get all symbol entries for a file.
   */
  getByFile(filePath: string): SymbolIndexEntry[] {
    return this._byFile.get(filePath) || [];
  }

  /**
   * Get the stored source hash for a file.
   * Returns undefined if the file is not in the index.
   */
  getFileHash(filePath: string): string | undefined {
    return this._fileHashes.get(filePath);
  }

  /**
   * Resolve the symbol at a cursor position (line, column).
   * Returns the deepest (most specific) symbol whose range contains the position.
   *
   * The cursor line is used to find the AST-corresponding entry,
   * but the returned entry's identity is its `address` — not the line number.
   *
   * @param filePath Relative file path.
   * @param line 0-based line number.
   * @param _column 0-based column (reserved for future use).
   * @returns The matching entry, or undefined.
   */
  resolveAtCursor(filePath: string, line: number, _column: number): SymbolIndexEntry | undefined {
    const entries = this._byFileSorted.get(filePath);
    if (!entries || entries.length === 0) {
      return undefined;
    }

    // Find all entries whose range contains this line
    const containing: SymbolIndexEntry[] = [];
    for (const entry of entries) {
      if (line >= entry.startLine && line <= entry.endLine) {
        containing.push(entry);
      }
    }

    if (containing.length === 0) {
      return undefined;
    }

    // Return the deepest (most specific) symbol:
    // 1. Prefer deeper scope chains
    // 2. Prefer narrower ranges (fewer lines)
    containing.sort((a, b) => {
      const scopeDiff = b.scopeChain.length - a.scopeChain.length;
      if (scopeDiff !== 0) {
        return scopeDiff;
      }
      return (a.endLine - a.startLine) - (b.endLine - b.startLine);
    });

    return containing[0];
  }

  /**
   * Derive the cache file path for a symbol address.
   * Convenience wrapper around `addressToCachePath`.
   */
  getCachePath(address: string): string {
    return addressToCachePath(address);
  }

  // ────────────── Persistence ──────────────

  /**
   * Persist the index to disk as JSON.
   */
  async save(): Promise<void> {
    const indexPath = path.join(
      this._workspaceRoot,
      '.vscode',
      CACHE.DIR_NAME,
      SYMBOL_INDEX_FILE
    );

    const serialized: SerializedIndex = {
      version: SYMBOL_INDEX_VERSION,
      lastRebuilt: this._lastRebuilt,
      symbolCount: this._byAddress.size,
      files: {},
    };

    for (const [filePath, entries] of this._byFile.entries()) {
      const hash = this._fileHashes.get(filePath) || '';
      serialized.files[filePath] = {
        hash,
        indexedAt: new Date().toISOString(),
        symbols: entries.map((e) => ({
          address: e.address,
          name: e.name,
          kind: e.kind,
          startLine: e.startLine,
          endLine: e.endLine,
          startColumn: e.startColumn,
          scopeChain: e.scopeChain,
          paramSignature: e.paramSignature,
          overloadDiscriminator: e.overloadDiscriminator,
          sourceHash: e.sourceHash,
          isLocal: e.isLocal,
        })),
      };
    }

    const dir = path.dirname(indexPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(serialized, null, 2), 'utf8');

    logger.info(`SymbolIndex: saved ${this._byAddress.size} symbols to ${indexPath}`);
  }

  /**
   * Load the index from disk.
   * Returns false if the index file doesn't exist or is corrupt.
   */
  async load(): Promise<boolean> {
    const indexPath = path.join(
      this._workspaceRoot,
      '.vscode',
      CACHE.DIR_NAME,
      SYMBOL_INDEX_FILE
    );

    try {
      const content = await fs.readFile(indexPath, 'utf8');
      const data: SerializedIndex = JSON.parse(content);

      if (data.version !== SYMBOL_INDEX_VERSION) {
        logger.warn(
          `SymbolIndex: index version mismatch (got ${data.version}, expected ${SYMBOL_INDEX_VERSION}). Rebuilding.`
        );
        return false;
      }

      this.clear();
      this._lastRebuilt = data.lastRebuilt;

      for (const [filePath, fileEntry] of Object.entries(data.files)) {
        const entries: SymbolIndexEntry[] = fileEntry.symbols.map((s) => ({
          ...s,
          filePath,
          sourceHash: fileEntry.hash,
        }));

        this.addFileEntries(filePath, entries, fileEntry.hash);
      }

      logger.info(
        `SymbolIndex: loaded ${this._byAddress.size} symbols from ${indexPath}`
      );
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('SymbolIndex: no persisted index found, starting fresh');
      } else {
        logger.warn(`SymbolIndex: failed to load index: ${err}`);
      }
      return false;
    }
  }

  /**
   * Update the last-rebuilt timestamp to now.
   */
  markRebuilt(): void {
    this._lastRebuilt = new Date().toISOString();
  }
}
