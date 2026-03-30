/**
 * Code Explorer — Symbol Address Utilities
 *
 * A symbol address is a deterministic, human-readable string that uniquely
 * identifies any symbol within a workspace. It is derived from the AST
 * structure (name, scope chain, kind, parameter signature) — never from
 * line numbers. This ensures addresses remain stable when code is
 * reformatted, reordered, or when comments/blank lines are added.
 *
 * Format: `<filePath>#<scope>::<kindPrefix>.<name>[~<discriminator>]`
 *
 * Examples:
 *   "src/main.cpp#fn.printBanner"
 *   "src/main.cpp#main::var.logger"
 *   "src/UserService.cpp#app::fn.UserService::createUser"
 *   "include/Logger.h#app::Logger::method.log~a3f2"   (overloaded)
 */
import * as crypto from 'crypto';
import * as path from 'path';
import { SYMBOL_KIND_PREFIX } from '../models/types';
import type { SymbolKindType } from '../models/types';
import { CACHE } from '../models/constants';

/**
 * Reverse map: kind prefix string → SymbolKindType.
 * Built from SYMBOL_KIND_PREFIX at module load time.
 */
const PREFIX_TO_KIND: Record<string, SymbolKindType> = {};
for (const [kind, prefix] of Object.entries(SYMBOL_KIND_PREFIX)) {
  PREFIX_TO_KIND[prefix] = kind as SymbolKindType;
}

/**
 * Build a symbol address string from components.
 *
 * @param filePath Relative path from workspace root to the source file.
 * @param scopeChain Ancestor scope names, root to parent (e.g., ['app', 'UserService']).
 * @param kind Symbol kind.
 * @param name Symbol identifier name.
 * @param overloadDiscriminator Optional 4-char hex suffix for overloaded symbols.
 * @returns The full symbol address string.
 *
 * @example
 * buildAddress('src/main.cpp', ['app', 'UserService'], 'function', 'createUser')
 * // => 'src/main.cpp#app::UserService::fn.createUser'
 *
 * buildAddress('include/Logger.h', ['app', 'Logger'], 'method', 'log', 'a3f2')
 * // => 'include/Logger.h#app::Logger::method.log~a3f2'
 */
export function buildAddress(
  filePath: string,
  scopeChain: string[],
  kind: SymbolKindType,
  name: string,
  overloadDiscriminator?: string
): string {
  const prefix = SYMBOL_KIND_PREFIX[kind] || 'sym';
  const scopePart = scopeChain.length > 0 ? scopeChain.join('::') + '::' : '';
  const discriminatorPart = overloadDiscriminator ? `~${overloadDiscriminator}` : '';
  return `${filePath}#${scopePart}${prefix}.${name}${discriminatorPart}`;
}

/**
 * Parsed components of a symbol address.
 */
export interface ParsedAddress {
  /** Relative file path from workspace root */
  filePath: string;
  /** Scope chain (ancestor names, root to parent) */
  scopeChain: string[];
  /** Symbol kind */
  kind: SymbolKindType;
  /** Symbol identifier name */
  name: string;
  /** Overload discriminator (4-char hex), or null if not overloaded */
  overloadDiscriminator: string | null;
}

/**
 * Parse a symbol address into its components.
 *
 * @param address The full symbol address string.
 * @returns Parsed components.
 * @throws Error if the address format is invalid.
 *
 * @example
 * parseAddress('src/main.cpp#app::UserService::fn.createUser')
 * // => { filePath: 'src/main.cpp', scopeChain: ['app', 'UserService'],
 * //      kind: 'function', name: 'createUser', overloadDiscriminator: null }
 */
export function parseAddress(address: string): ParsedAddress {
  const hashIdx = address.indexOf('#');
  if (hashIdx < 0) {
    throw new Error(`Invalid symbol address (missing #): "${address}"`);
  }

  const filePath = address.slice(0, hashIdx);
  let symbolPart = address.slice(hashIdx + 1);

  // Extract overload discriminator if present
  let overloadDiscriminator: string | null = null;
  const tildeIdx = symbolPart.lastIndexOf('~');
  if (tildeIdx >= 0) {
    overloadDiscriminator = symbolPart.slice(tildeIdx + 1);
    symbolPart = symbolPart.slice(0, tildeIdx);
  }

  // Find the kind.name segment (last segment containing a dot after the last ::)
  // The format is: scope1::scope2::kindPrefix.symbolName
  const dotIdx = symbolPart.lastIndexOf('.');
  if (dotIdx < 0) {
    throw new Error(`Invalid symbol address (missing kind.name): "${address}"`);
  }

  // Everything before the dot's segment separator (::) is scope chain + kind prefix
  const lastSepIdx = symbolPart.lastIndexOf('::', dotIdx);
  let scopeAndPrefix: string;
  let name: string;

  if (lastSepIdx >= 0) {
    scopeAndPrefix = symbolPart.slice(0, dotIdx);
    name = symbolPart.slice(dotIdx + 1);
  } else {
    scopeAndPrefix = symbolPart.slice(0, dotIdx);
    name = symbolPart.slice(dotIdx + 1);
  }

  // Split scopeAndPrefix into scope chain + kind prefix
  // The kind prefix is the last segment after the final ::
  const parts = scopeAndPrefix.split('::');
  const kindPrefix = parts[parts.length - 1];
  const scopeChain = parts.slice(0, parts.length - 1);

  const kind = PREFIX_TO_KIND[kindPrefix] || 'unknown';

  return { filePath, scopeChain, kind, name, overloadDiscriminator };
}

/**
 * Compute the overload discriminator from a normalized parameter signature.
 * Returns a 4-character hex string derived from SHA-256 of the signature.
 *
 * @param paramSignature Normalized parameter type list, comma-separated.
 * @returns 4-character hex string.
 *
 * @example
 * computeDiscriminator("const std::string&")       // e.g., "a3f2"
 * computeDiscriminator("int,const std::string&")    // e.g., "b7e1"
 * computeDiscriminator("")                          // hash of empty string
 */
export function computeDiscriminator(paramSignature: string): string {
  const hash = crypto.createHash('sha256').update(paramSignature).digest('hex');
  return hash.slice(0, 4);
}

/**
 * Split a symbol address into the source file path and cache file name.
 * This is the single source of truth for the address → file name mapping.
 *
 * @param address Full symbol address (e.g., 'src/main.cpp#fn.printBanner')
 * @returns `{ filePath, fileName }` where filePath is the source file part
 *          and fileName is the cache file name (e.g., 'fn.printBanner.md').
 * @throws Error if the address format is invalid.
 */
export function addressToCacheComponents(address: string): { filePath: string; fileName: string } {
  const hashIdx = address.indexOf('#');
  if (hashIdx < 0) {
    throw new Error(`Invalid symbol address (missing #): "${address}"`);
  }

  const filePath = address.slice(0, hashIdx);
  const symbolPart = address.slice(hashIdx + 1);

  // Replace :: with . for the file name portion
  const fileName = symbolPart.replace(/::/g, '.') + '.md';

  return { filePath, fileName };
}

/**
 * Derive the cache file path from a symbol address.
 * The path is relative to the workspace root.
 *
 * @param address Full symbol address.
 * @returns Cache file path (e.g., '.vscode/code-explorer/src/main.cpp/fn.printBanner.md').
 *
 * @example
 * addressToCachePath('src/main.cpp#app::fn.UserService::createUser')
 * // => '.vscode/code-explorer/src/main.cpp/app.fn.UserService.createUser.md'
 *
 * addressToCachePath('include/Logger.h#app::Logger::method.log~a3f2')
 * // => '.vscode/code-explorer/include/Logger.h/app.Logger.method.log~a3f2.md'
 */
export function addressToCachePath(address: string): string {
  const { filePath, fileName } = addressToCacheComponents(address);
  return path.join('.vscode', CACHE.DIR_NAME, filePath, fileName);
}
