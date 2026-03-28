/**
 * Code Explorer — Error Types
 *
 * Hierarchical error classes for structured error handling across the extension.
 * Each error includes a machine-readable code, recovery hint, and user-facing message.
 */

/**
 * Error codes organized by subsystem.
 */
export enum ErrorCode {
  // LLM Errors
  LLM_UNAVAILABLE = 'LLM_UNAVAILABLE',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_RATE_LIMITED = 'LLM_RATE_LIMITED',
  LLM_PARSE_ERROR = 'LLM_PARSE_ERROR',
  LLM_AUTH_ERROR = 'LLM_AUTH_ERROR',

  // Cache Errors
  CACHE_READ_ERROR = 'CACHE_READ_ERROR',
  CACHE_WRITE_ERROR = 'CACHE_WRITE_ERROR',
  CACHE_CORRUPT = 'CACHE_CORRUPT',
  INDEX_CORRUPT = 'INDEX_CORRUPT',

  // Analysis Errors
  SYMBOL_NOT_FOUND = 'SYMBOL_NOT_FOUND',
  ANALYSIS_TIMEOUT = 'ANALYSIS_TIMEOUT',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  LANGUAGE_NOT_SUPPORTED = 'LANGUAGE_NOT_SUPPORTED',

  // System Errors
  WORKSPACE_NOT_OPEN = 'WORKSPACE_NOT_OPEN',
  DISK_FULL = 'DISK_FULL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  UNKNOWN = 'UNKNOWN',
}

/**
 * Base error class for all Code Explorer errors.
 *
 * @example
 * ```ts
 * throw new CodeExplorerError(
 *   'LLM provider mai-claude is not installed',
 *   ErrorCode.LLM_UNAVAILABLE,
 *   true, // recoverable
 *   'AI analysis unavailable — showing static analysis only.'
 * );
 * ```
 */
export class CodeExplorerError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly recoverable: boolean = true,
    public readonly userMessage?: string
  ) {
    super(message);
    this.name = 'CodeExplorerError';
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, CodeExplorerError.prototype);
  }
}

/**
 * Error thrown when an LLM provider is unavailable or fails.
 */
export class LLMError extends CodeExplorerError {
  constructor(
    message: string,
    code:
      | ErrorCode.LLM_UNAVAILABLE
      | ErrorCode.LLM_TIMEOUT
      | ErrorCode.LLM_RATE_LIMITED
      | ErrorCode.LLM_PARSE_ERROR
      | ErrorCode.LLM_AUTH_ERROR = ErrorCode.LLM_UNAVAILABLE,
    userMessage?: string
  ) {
    super(message, code, true, userMessage);
    this.name = 'LLMError';
    Object.setPrototypeOf(this, LLMError.prototype);
  }
}

/**
 * Error thrown when cache operations fail.
 */
export class CacheError extends CodeExplorerError {
  constructor(
    message: string,
    code:
      | ErrorCode.CACHE_READ_ERROR
      | ErrorCode.CACHE_WRITE_ERROR
      | ErrorCode.CACHE_CORRUPT
      | ErrorCode.INDEX_CORRUPT = ErrorCode.CACHE_READ_ERROR,
    userMessage?: string
  ) {
    super(message, code, true, userMessage);
    this.name = 'CacheError';
    Object.setPrototypeOf(this, CacheError.prototype);
  }
}

/**
 * Error thrown when analysis operations fail.
 */
export class AnalysisError extends CodeExplorerError {
  constructor(
    message: string,
    code:
      | ErrorCode.SYMBOL_NOT_FOUND
      | ErrorCode.ANALYSIS_TIMEOUT
      | ErrorCode.FILE_NOT_FOUND
      | ErrorCode.LANGUAGE_NOT_SUPPORTED = ErrorCode.SYMBOL_NOT_FOUND,
    userMessage?: string
  ) {
    super(message, code, true, userMessage);
    this.name = 'AnalysisError';
    Object.setPrototypeOf(this, AnalysisError.prototype);
  }
}

/**
 * Error thrown for system-level issues (workspace, disk, permissions).
 */
export class SystemError extends CodeExplorerError {
  constructor(
    message: string,
    code:
      | ErrorCode.WORKSPACE_NOT_OPEN
      | ErrorCode.DISK_FULL
      | ErrorCode.PERMISSION_DENIED = ErrorCode.WORKSPACE_NOT_OPEN,
    userMessage?: string
  ) {
    super(message, code, false, userMessage);
    this.name = 'SystemError';
    Object.setPrototypeOf(this, SystemError.prototype);
  }
}

/**
 * Determine if an error is a known CodeExplorerError.
 */
export function isCodeExplorerError(error: unknown): error is CodeExplorerError {
  return error instanceof CodeExplorerError;
}

/**
 * Get a user-friendly message for any error.
 */
export function getUserMessage(error: unknown): string {
  if (isCodeExplorerError(error)) {
    return error.userMessage || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred.';
}
