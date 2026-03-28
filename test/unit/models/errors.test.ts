/**
 * Code Explorer — Unit Tests for Error Types (errors.ts)
 */
import * as assert from 'assert';
import {
  CodeExplorerError,
  LLMError,
  CacheError,
  AnalysisError,
  SystemError,
  ErrorCode,
  isCodeExplorerError,
  getUserMessage,
} from '../../../src/models/errors';

suite('Error Types', () => {
  suite('CodeExplorerError', () => {
    test('creates error with all fields', () => {
      const err = new CodeExplorerError(
        'Test error',
        ErrorCode.UNKNOWN,
        true,
        'Something went wrong'
      );
      assert.strictEqual(err.message, 'Test error');
      assert.strictEqual(err.code, ErrorCode.UNKNOWN);
      assert.strictEqual(err.recoverable, true);
      assert.strictEqual(err.userMessage, 'Something went wrong');
      assert.strictEqual(err.name, 'CodeExplorerError');
    });

    test('is instanceof Error', () => {
      const err = new CodeExplorerError('test', ErrorCode.UNKNOWN);
      assert.ok(err instanceof Error);
      assert.ok(err instanceof CodeExplorerError);
    });

    test('defaults to recoverable', () => {
      const err = new CodeExplorerError('test', ErrorCode.UNKNOWN);
      assert.strictEqual(err.recoverable, true);
    });
  });

  suite('LLMError', () => {
    test('creates error with correct name', () => {
      const err = new LLMError('LLM not found', ErrorCode.LLM_UNAVAILABLE);
      assert.strictEqual(err.name, 'LLMError');
      assert.strictEqual(err.code, ErrorCode.LLM_UNAVAILABLE);
      assert.ok(err instanceof CodeExplorerError);
      assert.ok(err instanceof LLMError);
    });

    test('supports all LLM error codes', () => {
      const codes = [
        ErrorCode.LLM_UNAVAILABLE,
        ErrorCode.LLM_TIMEOUT,
        ErrorCode.LLM_RATE_LIMITED,
        ErrorCode.LLM_PARSE_ERROR,
        ErrorCode.LLM_AUTH_ERROR,
      ] as const;

      for (const code of codes) {
        const err = new LLMError(`Error: ${code}`, code);
        assert.strictEqual(err.code, code);
      }
    });
  });

  suite('CacheError', () => {
    test('creates error with correct name', () => {
      const err = new CacheError('Cache read failed', ErrorCode.CACHE_READ_ERROR);
      assert.strictEqual(err.name, 'CacheError');
      assert.ok(err instanceof CodeExplorerError);
      assert.ok(err instanceof CacheError);
    });

    test('supports all cache error codes', () => {
      const codes = [
        ErrorCode.CACHE_READ_ERROR,
        ErrorCode.CACHE_WRITE_ERROR,
        ErrorCode.CACHE_CORRUPT,
        ErrorCode.INDEX_CORRUPT,
      ] as const;

      for (const code of codes) {
        const err = new CacheError(`Error: ${code}`, code);
        assert.strictEqual(err.code, code);
      }
    });
  });

  suite('AnalysisError', () => {
    test('creates error with correct name', () => {
      const err = new AnalysisError('Symbol not found', ErrorCode.SYMBOL_NOT_FOUND);
      assert.strictEqual(err.name, 'AnalysisError');
      assert.ok(err instanceof CodeExplorerError);
    });

    test('supports all analysis error codes', () => {
      const codes = [
        ErrorCode.SYMBOL_NOT_FOUND,
        ErrorCode.ANALYSIS_TIMEOUT,
        ErrorCode.FILE_NOT_FOUND,
        ErrorCode.LANGUAGE_NOT_SUPPORTED,
      ] as const;

      for (const code of codes) {
        const err = new AnalysisError(`Error: ${code}`, code);
        assert.strictEqual(err.code, code);
      }
    });
  });

  suite('SystemError', () => {
    test('is not recoverable by default', () => {
      const err = new SystemError('No workspace', ErrorCode.WORKSPACE_NOT_OPEN);
      assert.strictEqual(err.recoverable, false);
      assert.strictEqual(err.name, 'SystemError');
    });

    test('supports all system error codes', () => {
      const codes = [
        ErrorCode.WORKSPACE_NOT_OPEN,
        ErrorCode.DISK_FULL,
        ErrorCode.PERMISSION_DENIED,
      ] as const;

      for (const code of codes) {
        const err = new SystemError(`Error: ${code}`, code);
        assert.strictEqual(err.code, code);
      }
    });
  });

  suite('isCodeExplorerError', () => {
    test('returns true for CodeExplorerError', () => {
      assert.ok(isCodeExplorerError(new CodeExplorerError('test', ErrorCode.UNKNOWN)));
    });

    test('returns true for subclasses', () => {
      assert.ok(isCodeExplorerError(new LLMError('test', ErrorCode.LLM_UNAVAILABLE)));
      assert.ok(isCodeExplorerError(new CacheError('test', ErrorCode.CACHE_READ_ERROR)));
      assert.ok(isCodeExplorerError(new AnalysisError('test', ErrorCode.SYMBOL_NOT_FOUND)));
      assert.ok(isCodeExplorerError(new SystemError('test', ErrorCode.WORKSPACE_NOT_OPEN)));
    });

    test('returns false for plain errors', () => {
      assert.ok(!isCodeExplorerError(new Error('generic')));
    });

    test('returns false for non-errors', () => {
      assert.ok(!isCodeExplorerError('string'));
      assert.ok(!isCodeExplorerError(null));
      assert.ok(!isCodeExplorerError(undefined));
      assert.ok(!isCodeExplorerError(42));
    });
  });

  suite('getUserMessage', () => {
    test('returns userMessage for CodeExplorerError', () => {
      const err = new CodeExplorerError(
        'internal detail',
        ErrorCode.UNKNOWN,
        true,
        'User-friendly message'
      );
      assert.strictEqual(getUserMessage(err), 'User-friendly message');
    });

    test('falls back to message when no userMessage', () => {
      const err = new CodeExplorerError('internal detail', ErrorCode.UNKNOWN);
      assert.strictEqual(getUserMessage(err), 'internal detail');
    });

    test('returns message for plain errors', () => {
      assert.strictEqual(getUserMessage(new Error('oops')), 'oops');
    });

    test('returns default for non-errors', () => {
      assert.strictEqual(getUserMessage('something'), 'An unknown error occurred.');
      assert.strictEqual(getUserMessage(null), 'An unknown error occurred.');
    });
  });
});
