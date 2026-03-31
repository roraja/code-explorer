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
  | 'struct'
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
  struct: 'struct',
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
  /**
   * Full scope chain from root to this symbol (excludes the symbol itself).
   * Each entry is the name of an enclosing scope.
   * Example: ["UserService", "getUser"] for a local variable inside getUser()
   * Used as the primary axis for cache key resolution and tab deduplication.
   */
  scopeChain?: string[];
}

/**
 * Lightweight cursor context gathered cheaply from the editor.
 * Used as input when the user triggers "Explore Symbol" — avoids
 * the expensive VS Code symbol resolution stage by deferring
 * symbol identification to the LLM.
 */
export interface CursorContext {
  /** The word/token at the cursor position */
  word: string;
  /** Relative path from workspace root to the source file */
  filePath: string;
  /** Cursor position (0-based line and character) */
  position: Position;
  /**
   * Source code surrounding the cursor (typically ±50 lines).
   * Gives the LLM enough context to identify the symbol kind.
   */
  surroundingSource: string;
  /** The line of source code where the cursor is */
  cursorLine: string;
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
  /** Kind of data this variable holds, with examples and references (for variables) */
  dataKind?: DataKindInfo;
  /** Numbered steps describing what this function does */
  functionSteps?: FunctionStep[];
  /** Sub-functions called by this symbol, with details */
  subFunctions?: SubFunctionInfo[];
  /** Function/method input parameters with type details and mutation info */
  functionInputs?: FunctionInputParam[];
  /** Function/method return type with structural details */
  functionOutput?: FunctionOutputInfo;
  /** Brief LLM analyses of related symbols for pre-caching */
  relatedSymbols?: RelatedSymbolAnalysis[];
  /** Class members (for class/struct analysis) */
  classMembers?: ClassMemberInfo[];
  /** Member access patterns (for class/struct analysis) */
  memberAccess?: MemberAccessInfo[];
  /** Mermaid diagrams visualizing this symbol's behavior */
  diagrams?: DiagramEntry[];
  /** Q&A history from user "Enhance" interactions */
  qaHistory?: QAEntry[];
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
 * A single step in a function's numbered breakdown.
 */
export interface FunctionStep {
  /** Step number (1-based) */
  step: number;
  /** Description of what this step does */
  description: string;
}

/**
 * Details about a sub-function called by the analyzed symbol.
 */
export interface SubFunctionInfo {
  /** Name of the sub-function */
  name: string;
  /** What the sub-function does */
  description: string;
  /** Input parameters description */
  input: string;
  /** Return value description */
  output: string;
  /** File path where the sub-function is defined */
  filePath?: string;
  /** Line number of the sub-function's definition */
  line?: number;
  /** Kind of the sub-function symbol */
  kind?: string;
}

/**
 * A single input parameter of a function/method, with structural details.
 */
export interface FunctionInputParam {
  /** Parameter name */
  name: string;
  /** Type annotation (e.g., "SymbolInfo", "string[]") */
  typeName: string;
  /** Brief explanation of what this parameter represents */
  description: string;
  /** Whether the function mutates this parameter (calls non-const methods, reassigns properties) */
  mutated: boolean;
  /** If mutated, describe how (e.g., "calls .push()", "sets .status property") */
  mutationDetail?: string;
  /** File path where the type is defined (for linking to its analysis) */
  typeFilePath?: string;
  /** Line number of the type definition */
  typeLine?: number;
  /** Kind of the type symbol */
  typeKind?: string;
  /** Brief overview of the type structure */
  typeOverview?: string;
}

/**
 * Return type details of a function/method.
 */
export interface FunctionOutputInfo {
  /** Type annotation (e.g., "Promise<AnalysisResult>", "void") */
  typeName: string;
  /** Brief explanation of what is returned */
  description: string;
  /** File path where the return type is defined (for linking) */
  typeFilePath?: string;
  /** Line number of the type definition */
  typeLine?: number;
  /** Kind of the type symbol */
  typeKind?: string;
  /** Brief overview of the return type structure */
  typeOverview?: string;
}

/**
 * Describes the kind of data a variable holds, with examples and references.
 * For instance, whether a variable holds a configuration object, a cache map,
 * a database connection, an event handler, etc.
 */
export interface DataKindInfo {
  /** Human-readable label for the data kind (e.g., "Configuration Object", "Cache Map", "Event Handler") */
  label: string;
  /** Detailed description of what kind of data this variable holds and why */
  description: string;
  /**
   * Concrete examples of the data this variable might hold at runtime.
   * Each example shows a realistic value or shape.
   * Example: ["{ host: 'localhost', port: 3000 }", "{ host: 'prod.api.com', port: 443 }"]
   */
  examples: string[];
  /**
   * References to related types, docs, or patterns that define this data kind.
   * Example: ["AnalysisResult (src/models/types.ts:121)", "See docs/06-data_model_and_cache.md"]
   */
  references: string[];
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

/**
 * A member of a class or data structure (for class-level analysis).
 */
export interface ClassMemberInfo {
  /** Member name */
  name: string;
  /** Member kind (field, method, property, constructor) */
  memberKind: 'field' | 'method' | 'property' | 'constructor' | 'getter' | 'setter';
  /** Type annotation */
  typeName: string;
  /** Visibility */
  visibility: 'public' | 'private' | 'protected' | 'internal';
  /** Whether this member is static */
  isStatic: boolean;
  /** Brief description */
  description: string;
  /** Line number in the source file */
  line?: number;
}

/**
 * A Mermaid diagram generated by the LLM to visualize symbol behavior.
 * Rendered as interactive SVG in the webview sidebar.
 */
export interface DiagramEntry {
  /** Diagram title displayed as section header (e.g., "Call Flow", "Data Flow") */
  title: string;
  /** Mermaid diagram type hint (e.g., "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram") */
  type: string;
  /** Raw Mermaid markup source text */
  mermaidSource: string;
}

/**
 * A question-and-answer entry from the user's "Enhance" interaction.
 * Stored as part of the analysis and persisted in the cache file.
 */
export interface QAEntry {
  /** The user's question or enhancement request */
  question: string;
  /** The LLM-generated answer */
  answer: string;
  /** ISO 8601 timestamp of when this Q&A was created */
  timestamp: string;
}

/**
 * Tracks which methods read/write a specific class member.
 */
export interface MemberAccessInfo {
  /** Name of the member being tracked */
  memberName: string;
  /** Methods that read this member */
  readBy: string[];
  /** Methods that write/mutate this member */
  writtenBy: string[];
  /** Whether this member is accessed from outside the class */
  externalAccess: boolean;
}

/**
 * A brief analysis of a related symbol encountered during LLM analysis.
 * Used to pre-cache analyses for symbols the LLM discovers while
 * analyzing the primary symbol, saving future LLM calls.
 */
export interface RelatedSymbolAnalysis {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** File where the symbol is defined */
  filePath: string;
  /** Line number of the symbol definition */
  line: number;
  /** Brief overview of the symbol */
  overview: string;
  /** Key points about the symbol */
  keyPoints?: string[];
  /** Dependencies of the symbol */
  dependencies?: string[];
  /** Potential issues with the symbol */
  potentialIssues?: string[];
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
  /**
   * Relative path from workspace root to the cache markdown file.
   * Set when the result is read from or written to the cache.
   * Example: ".vscode/code-explorer/src/main.cpp/fn.printBanner.md"
   */
  cacheFilePath?: string;
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
// Navigation History
// =====================

/**
 * Trigger that caused a navigation from one tab to another.
 * Helps the breadcrumb trail show context about *why* a navigation happened.
 */
export type NavigationTrigger =
  | 'explore-command'
  | 'symbol-link'
  | 'sub-function'
  | 'caller'
  | 'relationship'
  | 'type-link'
  | 'breadcrumb'
  | 'history-back'
  | 'history-forward'
  | 'tab-click'
  | 'session-restore';

/**
 * A single entry in the exploration navigation history.
 * Records a navigation from one tab to another, forming a breadcrumb trail.
 */
export interface NavigationEntry {
  /** Tab ID that was navigated FROM (null for the first exploration) */
  fromTabId: string | null;
  /** Tab ID that was navigated TO */
  toTabId: string;
  /** What triggered this navigation */
  trigger: NavigationTrigger;
  /** ISO 8601 timestamp of when the navigation happened */
  timestamp: string;
  /** Symbol name of the destination (for display in breadcrumbs) */
  symbolName: string;
  /** Symbol kind of the destination (for icon display) */
  symbolKind: string;
}

/**
 * A named investigation that the user has pinned for later reference.
 * Captures a breadcrumb trail under a human-readable name.
 */
export interface PinnedInvestigation {
  /** Unique ID for this investigation */
  id: string;
  /** User-provided name (e.g., "Tracing the cache miss bug") */
  name: string;
  /** The breadcrumb trail (sequence of tab IDs in exploration order) */
  trail: string[];
  /** Symbol names corresponding to each tab ID (for display after tabs are closed) */
  trailSymbols: {
    tabId: string;
    symbolName: string;
    symbolKind: string;
    /** Full symbol info for re-creating tabs from cache when the original tab is closed */
    symbol?: SymbolInfo;
  }[];
  /** ISO 8601 timestamp of when this investigation was pinned */
  pinnedAt: string;
  /** Tab group tree structure saved with this investigation */
  tabGroups?: TabGroup[];
}

/**
 * Full navigation history state, pushed to the webview alongside tab state.
 */
export interface NavigationHistoryState {
  /** The ordered list of navigation entries forming the history */
  entries: NavigationEntry[];
  /** Current position in the history stack (index into entries). -1 means empty. */
  currentIndex: number;
  /** Pinned investigations saved by the user */
  pinnedInvestigations: PinnedInvestigation[];
  /** Name of the current investigation (unsaved or matches a pinned one) */
  currentInvestigationName: string;
  /** ID of the pinned investigation this matches (null if unsaved/modified) */
  currentInvestigationId: string | null;
  /** Whether the current state differs from the saved investigation */
  currentInvestigationDirty: boolean;
}

// =====================
// UI State
// =====================

/** Granular loading stage for progress display. */
export type LoadingStage =
  | 'resolving-symbol'
  | 'cache-check'
  | 'reading-source'
  | 'llm-analyzing'
  | 'writing-cache';

/** Human-readable labels for each loading stage. */
export const LOADING_STAGE_LABELS: Record<LoadingStage, string> = {
  'resolving-symbol': 'Identifying symbol…',
  'cache-check': 'Checking cache…',
  'reading-source': 'Reading source code…',
  'llm-analyzing': 'Running LLM analysis…',
  'writing-cache': 'Saving to cache…',
};

/** Progress callback for analysis stages. */
export type AnalysisProgressCallback = (stage: LoadingStage) => void;

/** State for a single tab in the sidebar. */
export interface TabState {
  id: string;
  symbol: SymbolInfo;
  status: 'loading' | 'ready' | 'error' | 'stale';
  analysis: AnalysisResult | null;
  error?: string;
  /** Current loading stage for granular progress display */
  loadingStage?: LoadingStage;
  /** True while an enhance (Q&A) request is in progress — keeps existing content visible */
  enhancing?: boolean;
  /** User-added notes for this tab (shown at top of analysis) */
  notes?: string;
}

/** Root state for the explorer sidebar. */
export interface ExplorerState {
  tabs: TabState[];
  activeTabId: string | null;
}

// =====================
// Tab Groups (Tree-wise grouping)
// =====================

/**
 * A node in the tab group tree. Can be either a tab reference or a named group
 * containing other nodes (tabs or nested groups).
 */
export type TabTreeNode = { type: 'tab'; tabId: string } | { type: 'group'; group: TabGroup };

/**
 * A named group of tabs that can be nested.
 * Groups form a tree structure for organizing symbol explorations.
 */
export interface TabGroup {
  /** Unique group identifier */
  id: string;
  /** User-given name for this group */
  name: string;
  /** Child nodes — tabs or nested groups, in display order */
  children: TabTreeNode[];
  /** Whether the group is collapsed in the UI */
  collapsed: boolean;
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
export type ExtensionToWebviewMessage =
  | {
      type: 'setState';
      tabs: TabState[];
      activeTabId: string | null;
      /** Navigation history for breadcrumb trail display */
      navigationHistory?: NavigationHistoryState;
      /** Tree-wise tab grouping structure (tabs not in any group are ungrouped) */
      tabGroups?: TabGroup[];
    }
  | {
      type: 'showDependencyGraph';
      mermaidSource: string;
      nodeCount: number;
      edgeCount: number;
    };

/** Messages sent from the webview to the extension. */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'tabClicked'; tabId: string }
  | { type: 'tabClosed'; tabId: string }
  | { type: 'refreshRequested'; tabId: string }
  | { type: 'navigateToSource'; filePath: string; line: number; character: number }
  | { type: 'retryAnalysis'; tabId: string }
  | { type: 'exploreSymbol'; symbolName: string; filePath?: string; line?: number; kind?: string }
  | { type: 'navigateToSymbol'; symbolName: string }
  | { type: 'enhanceAnalysis'; tabId: string; userPrompt: string }
  | { type: 'reAnalyze'; tabId: string }
  | { type: 'requestDependencyGraph' }
  | { type: 'requestSymbolGraph'; symbolName: string; filePath: string }
  | { type: 'closeDependencyGraph' }
  | { type: 'historyBack' }
  | { type: 'historyForward' }
  | { type: 'pinInvestigation'; name: string }
  | { type: 'unpinInvestigation'; investigationId: string }
  | { type: 'restoreInvestigation'; investigationId: string }
  | { type: 'reorderTabs'; tabIds: string[] }
  | { type: 'updateNotes'; tabId: string; notes: string }
  | { type: 'saveInvestigation' }
  | { type: 'saveInvestigationAs'; name: string }
  | { type: 'renameInvestigation'; name: string }
  | { type: 'createGroup'; name: string; tabIds: string[] }
  | { type: 'renameGroup'; groupId: string; name: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'toggleGroupCollapse'; groupId: string }
  | { type: 'moveToGroup'; tabIds: string[]; groupId: string | null; insertIndex?: number }
  | {
      type: 'moveGroupToGroup';
      sourceGroupId: string;
      targetGroupId: string | null;
      insertIndex?: number;
    }
  | { type: 'ungroupTabs'; tabIds: string[] };

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
