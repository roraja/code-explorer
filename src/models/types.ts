/**
 * Code Explorer — Core Type Definitions
 *
 * This module defines all TypeScript interfaces used across the extension.
 * It is the single source of truth for data shapes flowing through the
 * analysis pipeline, cache layer, UI state, and LLM integration.
 */

// =====================
// Core Symbol Types
// =====================

/**
 * All analyzable symbol kinds.
 * Maps to VS Code's SymbolKind but with string identifiers for readability.
 */
export type SymbolKindType =
  | 'class'
  | 'function'
  | 'method'
  | 'variable'
  | 'interface'
  | 'type'
  | 'enum'
  | 'property'
  | 'parameter'
  | 'unknown';

/**
 * Prefix used in cache file names for each symbol kind.
 */
export const SYMBOL_KIND_PREFIX: Record<SymbolKindType, string> = {
  class: 'class',
  function: 'fn',
  method: 'method',
  variable: 'var',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  property: 'prop',
  parameter: 'param',
  unknown: 'sym',
};

/** Position in a source file (0-based). */
export interface Position {
  line: number;
  character: number;
}

/** Range in a source file. */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Represents a code symbol that can be analyzed.
 * This is the primary input to the analysis pipeline.
 */
export interface SymbolInfo {
  /** Symbol name, e.g. "UserController" */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /**
   * Relative path from workspace root to the source file.
   * Example: "src/controllers/UserController.ts"
   */
  filePath: string;
  /** Position of the symbol's name/identifier */
  position: Position;
  /** Full range of the symbol's declaration (optional) */
  range?: Range;
  /**
   * Parent container name for nested symbols.
   * Example: "UserController" for method "getUser" inside that class.
   */
  containerName?: string;
}

// =====================
// Analysis Results
// =====================

/**
 * Complete analysis result for a symbol.
 * This is what gets serialized to the cache markdown file.
 */
export interface AnalysisResult {
  /** The symbol that was analyzed */
  symbol: SymbolInfo;
  /** AI-generated overview/summary of the symbol */
  overview: string;
  /** Incoming call stacks (who calls this?) */
  callStacks: CallStackEntry[];
  /** All references/usages across the workspace */
  usages: UsageEntry[];
  /** Data flow tracking (for variables) */
  dataFlow: DataFlowEntry[];
  /** Type/dependency relationships */
  relationships: RelationshipEntry[];
  /** Key methods (for classes) */
  keyMethods?: string[];
  /** Dependencies (for classes) */
  dependencies?: string[];
  /** AI-suggested usage pattern */
  usagePattern?: string;
  /** AI-detected potential issues */
  potentialIssues?: string[];
  /** Variable lifecycle (for variables) */
  variableLifecycle?: VariableLifecycle;
  /** Metadata for cache management */
  metadata: AnalysisMetadata;
}

/**
 * A single call stack entry showing who calls the analyzed symbol.
 */
export interface CallStackEntry {
  /** The calling function/method */
  caller: {
    name: string;
    filePath: string;
    line: number;
    kind: SymbolKindType;
  };
  /** Exact positions where the call happens */
  callSites: Position[];
  /** Depth in the call tree (0 = direct caller) */
  depth?: number;
  /**
   * Human-readable call chain.
   * Example: "app.ts:42 → router.get() → UserController.getUser()"
   */
  chain?: string;
}

/**
 * A reference/usage of the analyzed symbol.
 */
export interface UsageEntry {
  /** File where the reference occurs */
  filePath: string;
  /** Line number (1-based for display) */
  line: number;
  /** Column number */
  character: number;
  /** The line of source code containing the reference */
  contextLine: string;
  /** Whether this is the symbol's definition (vs. a usage) */
  isDefinition: boolean;
}

/**
 * A step in a variable's data flow lifecycle.
 */
export interface DataFlowEntry {
  /** What happens to the data at this point */
  type: 'created' | 'assigned' | 'read' | 'modified' | 'consumed' | 'returned' | 'passed';
  /** File where this occurs */
  filePath: string;
  /** Line number */
  line: number;
  /** Human-readable description of this data flow step */
  description: string;
}

/**
 * A relationship between the analyzed symbol and another symbol.
 */
export interface RelationshipEntry {
  /** Kind of relationship */
  type:
    | 'extends'
    | 'implements'
    | 'uses'
    | 'used-by'
    | 'extended-by'
    | 'implemented-by'
    | 'imports'
    | 'imported-by';
  /** The related symbol's name */
  targetName: string;
  /** The related symbol's file */
  targetFilePath: string;
  /** The related symbol's line */
  targetLine: number;
}

/**
 * Variable lifecycle analysis (AI-generated).
 */
export interface VariableLifecycle {
  /** How and where the variable is declared */
  declaration: string;
  /** How the variable gets its initial value */
  initialization: string;
  /** List of mutation points */
  mutations: string[];
  /** List of consumption points */
  consumption: string[];
  /** Scope and garbage collection eligibility */
  scopeAndLifetime: string;
}

// =====================
// Metadata
// =====================

/**
 * Metadata attached to every analysis result.
 * Stored in YAML frontmatter of the cache markdown file.
 */
export interface AnalysisMetadata {
  /** ISO 8601 timestamp of when analysis was run */
  analyzedAt: string;
  /**
   * SHA-256 hash of the source file at analysis time.
   * Format: "sha256:<hex>"
   */
  sourceHash: string;
  /**
   * SHA-256 hashes of files that the analysis depends on.
   * If any of these change, the analysis may be stale.
   * Keys are relative file paths, values are "sha256:<hex>".
   */
  dependentFileHashes: Record<string, string>;
  /** Which LLM provider generated the analysis (undefined for static-only) */
  llmProvider?: string;
  /** Cache format version (for future migration support) */
  analysisVersion: string;
  /** Whether the source file has changed since this analysis was run */
  stale: boolean;
}

// =====================
// Cache / Index Types
// =====================

/**
 * Master index file: O(1) lookups for any symbol.
 * Stored at: .vscode/code-explorer/_index.json
 */
export interface MasterIndex {
  /** Index format version */
  version: string;
  /** ISO 8601 timestamp of last index update */
  lastUpdated: string;
  /** Total number of indexed symbols */
  symbolCount: number;
  /**
   * Symbol entries keyed by cache key.
   * Key format: "relativePath::kind.Name"
   * Example: "src/controllers/UserController.ts::class.UserController"
   */
  entries: Record<string, IndexEntry>;
  /**
   * File-level index for fast invalidation.
   * Key: relative file path
   */
  fileIndex: Record<string, FileIndexEntry>;
}

/**
 * A single entry in the master index.
 */
export interface IndexEntry {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** Source file (relative path) */
  file: string;
  /**
   * Path to the cache markdown file (relative to cache root).
   * Example: "src/controllers/UserController.ts/class.UserController.md"
   */
  cachePath: string;
  /** When this symbol was last analyzed */
  analyzedAt: string;
  /** Hash of the source file at analysis time */
  sourceHash: string;
  /** Whether the analysis is stale */
  stale: boolean;
}

/**
 * File-level entry in the master index.
 * Enables fast "invalidate all symbols in this file" operations.
 */
export interface FileIndexEntry {
  /** SHA-256 hash of the source file */
  hash: string;
  /**
   * Symbol names in this file.
   * Format: "kind.Name" (e.g., "class.UserController", "fn.getUser")
   */
  symbols: string[];
  /** When this file was last analyzed */
  lastAnalyzed: string;
}

/**
 * Per-file manifest stored alongside cache files.
 * Stored at: .vscode/code-explorer/<source-path>/_manifest.json
 */
export interface FileManifest {
  /** Source file relative path */
  file: string;
  /** Source file hash at last analysis */
  hash: string;
  /** Analyzed symbols in this file */
  symbols: {
    /** Symbol name (without kind prefix) */
    name: string;
    /** Symbol kind */
    kind: SymbolKindType;
    /** Line number in source file */
    line?: number;
    /** Cache file name (e.g., "class.UserController.md") */
    cacheFile: string;
    /** When this symbol was analyzed */
    analyzedAt: string;
    /** Whether analysis is stale */
    stale: boolean;
  }[];
}

/**
 * Cache statistics for UI display and diagnostics.
 */
export interface CacheStats {
  totalSymbols: number;
  freshCount: number;
  staleCount: number;
  totalSizeBytes: number;
  oldestAnalysis: string;
  newestAnalysis: string;
}

// =====================
// UI State
// =====================

/** State for a single tab in the sidebar. */
export interface TabState {
  id: string;
  symbol: SymbolInfo;
  status: 'loading' | 'ready' | 'error' | 'stale';
  analysis: AnalysisResult | null;
  error?: string;
}

/** Root state for the explorer sidebar. */
export interface ExplorerState {
  tabs: TabState[];
  activeTabId: string | null;
}

// =====================
// LLM Types
// =====================

/** Request payload for LLM analysis. */
export interface LLMAnalysisRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Capabilities advertised by an LLM provider. */
export interface ProviderCapabilities {
  maxContextTokens: number;
  supportsStreaming: boolean;
  costPerMTokenInput: number;
  costPerMTokenOutput: number;
}

/** Context gathered for LLM analysis. */
export interface CodeContext {
  sourceCode: string;
  relatedFiles: { path: string; content: string }[];
  references: UsageEntry[];
  callHierarchy: CallStackEntry[];
}

// =====================
// Message Passing (Extension ↔ Webview)
// =====================

/** Messages sent from the extension to the webview. */
export type ExtensionToWebviewMessage = {
  type: 'setState';
  tabs: TabState[];
  activeTabId: string | null;
};

/** Messages sent from the webview to the extension. */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'tabClicked'; tabId: string }
  | { type: 'tabClosed'; tabId: string }
  | { type: 'refreshRequested'; tabId: string }
  | { type: 'navigateToSource'; filePath: string; line: number; character: number }
  | { type: 'retryAnalysis'; tabId: string };

// =====================
// Queued Analysis
// =====================

/** A queued analysis request with priority and retry support. */
export interface QueuedAnalysis {
  symbolKey: string;
  priority: number;
  executor: () => Promise<AnalysisResult>;
  retryCount: number;
  maxRetries: number;
  _resolve?: (result: AnalysisResult) => void;
  _reject?: (error: unknown) => void;
}
