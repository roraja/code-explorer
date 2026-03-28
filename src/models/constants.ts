/**
 * Code Explorer — Constants
 *
 * Centralized constants used across the extension.
 */

/** Extension identifier used in VS Code registrations. */
export const EXTENSION_ID = 'code-explorer';

/** Display name shown in UI. */
export const EXTENSION_DISPLAY_NAME = 'Code Explorer';

/** View identifiers. */
export const VIEW_ID = 'codeExplorer.sidebar';

/** Command identifiers. */
export const COMMANDS = {
  EXPLORE_SYMBOL: 'codeExplorer.exploreSymbol',
  REFRESH_ANALYSIS: 'codeExplorer.refreshAnalysis',
  CLEAR_CACHE: 'codeExplorer.clearCache',
  ANALYZE_WORKSPACE: 'codeExplorer.analyzeWorkspace',
} as const;

/** Configuration setting keys (under "codeExplorer." namespace). */
export const CONFIG = {
  LLM_PROVIDER: 'codeExplorer.llmProvider',
  AUTO_ANALYZE_ON_SAVE: 'codeExplorer.autoAnalyzeOnSave',
  CACHE_TTL_HOURS: 'codeExplorer.cacheTTLHours',
  MAX_CONCURRENT_ANALYSES: 'codeExplorer.maxConcurrentAnalyses',
  EXCLUDE_PATTERNS: 'codeExplorer.excludePatterns',
  ANALYSIS_DEPTH: 'codeExplorer.analysisDepth',
  PERIODIC_ANALYSIS_INTERVAL: 'codeExplorer.periodicAnalysisIntervalMinutes',
  OPEN_ON_CLICK: 'codeExplorer.openOnClick',
  MAX_CALL_STACK_DEPTH: 'codeExplorer.maxCallStackDepth',
  SHOW_HOVER_CARDS: 'codeExplorer.showHoverCards',
} as const;

/** Cache directory and file constants. */
export const CACHE = {
  /** Root directory name (under .vscode/) */
  DIR_NAME: 'code-explorer',
  /** Master index file name */
  INDEX_FILE: '_index.json',
  /** Per-directory manifest file name */
  MANIFEST_FILE: '_manifest.json',
  /** Cache config file name */
  CONFIG_FILE: '_config.json',
  /** Cache stats file name */
  STATS_FILE: '_stats.json',
  /** Default cache format version */
  VERSION: '1.0.0',
  /** Default TTL in hours */
  DEFAULT_TTL_HOURS: 168,
} as const;

/** Supported language identifiers for analysis. */
export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
] as const;

/** File extensions watched for cache invalidation. */
export const WATCHED_EXTENSIONS = '**/*.{ts,tsx,js,jsx}';

/** Analysis queue defaults. */
export const QUEUE = {
  /** Default max concurrent LLM requests */
  DEFAULT_MAX_CONCURRENT: 3,
  /** Default rate limit between requests (ms) */
  DEFAULT_RATE_LIMIT_MS: 2000,
  /** Priority for user-triggered analysis */
  PRIORITY_USER: 10,
  /** Priority for background analysis */
  PRIORITY_BACKGROUND: 1,
  /** Default max retries on failure */
  DEFAULT_MAX_RETRIES: 2,
} as const;

/** Timeout for individual static analysis operations (ms). */
export const STATIC_ANALYSIS_TIMEOUT_MS = 15_000;

/** Analysis version identifier. */
export const ANALYSIS_VERSION = '1.0.0';
