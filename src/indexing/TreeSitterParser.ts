/**
 * Code Explorer — Tree-Sitter Parser Manager
 *
 * Manages tree-sitter parser instances per language. Parsers are lazily
 * initialized on first use and cached for reuse. Uses the native
 * tree-sitter Node.js binding for performance.
 *
 * Supported languages: C++, C, TypeScript, TSX.
 */
import Parser from 'tree-sitter';
// eslint-disable-next-line @typescript-eslint/naming-convention
import Cpp from 'tree-sitter-cpp';
// eslint-disable-next-line @typescript-eslint/naming-convention
import TypeScriptGrammar from 'tree-sitter-typescript';
import * as path from 'path';
import { logger } from '../utils/logger';

/** Supported language identifiers for tree-sitter parsing. */
export type TreeSitterLanguage = 'cpp' | 'c' | 'typescript' | 'tsx';

/** Map file extensions to tree-sitter language identifiers. */
const EXTENSION_TO_LANGUAGE: Record<string, TreeSitterLanguage> = {
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.c': 'c',
  '.h': 'cpp', // Treat .h as C++ (superset of C)
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'typescript', // tree-sitter-typescript can parse JS
  '.jsx': 'tsx',
};

/**
 * Manages tree-sitter parser instances per language.
 * Lazy initialization — parsers are created on first use.
 */
export class TreeSitterParser {
  /** Cached parser instances per language. */
  private readonly _parsers = new Map<TreeSitterLanguage, Parser>();

  /**
   * Parse source code and return the tree-sitter AST tree.
   *
   * @param filePath File path (used to determine the language from extension).
   * @param content Source code content to parse.
   * @returns The parsed tree-sitter Tree, or null if the language is not supported.
   */
  parse(filePath: string, content: string): Parser.Tree | null {
    const lang = TreeSitterParser.languageForFile(filePath);
    if (!lang) {
      logger.debug(`TreeSitterParser: unsupported file extension for ${filePath}`);
      return null;
    }

    const parser = this._getOrCreateParser(lang);
    if (!parser) {
      return null;
    }

    try {
      return parser.parse(content);
    } catch (err) {
      logger.warn(`TreeSitterParser: failed to parse ${filePath}: ${err}`);
      return null;
    }
  }

  /**
   * Determine the tree-sitter language for a file based on its extension.
   * Returns null if the file extension is not supported.
   */
  static languageForFile(filePath: string): TreeSitterLanguage | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  /**
   * Check whether a file is supported by tree-sitter.
   */
  static isSupported(filePath: string): boolean {
    return TreeSitterParser.languageForFile(filePath) !== null;
  }

  /**
   * Get the list of supported file extensions.
   */
  static supportedExtensions(): string[] {
    return Object.keys(EXTENSION_TO_LANGUAGE);
  }

  /**
   * Get or create a parser for the given language.
   */
  private _getOrCreateParser(lang: TreeSitterLanguage): Parser | null {
    const cached = this._parsers.get(lang);
    if (cached) {
      return cached;
    }

    try {
      const parser = new Parser();
      const grammar = this._loadGrammar(lang);
      if (!grammar) {
        return null;
      }
      parser.setLanguage(grammar);
      this._parsers.set(lang, parser);
      logger.debug(`TreeSitterParser: initialized parser for ${lang}`);
      return parser;
    } catch (err) {
      logger.warn(`TreeSitterParser: failed to initialize parser for ${lang}: ${err}`);
      return null;
    }
  }

  /**
   * Load the grammar for a language.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _loadGrammar(lang: TreeSitterLanguage): any {
    switch (lang) {
      case 'cpp':
      case 'c':
        // tree-sitter-cpp handles both C and C++
        return Cpp;
      case 'typescript':
        return TypeScriptGrammar.typescript;
      case 'tsx':
        return TypeScriptGrammar.tsx;
      default:
        logger.warn(`TreeSitterParser: no grammar for language "${lang}"`);
        return null;
    }
  }
}
