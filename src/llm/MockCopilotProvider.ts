/**
 * Code Explorer — Mock Copilot LLM Provider
 *
 * A mock LLM provider for testing the Code Explorer analysis pipeline.
 * Spawns `tools/mock-copilot.js` (a Node.js script) which simulates an
 * AI agent: given a prompt via stdin, it returns a structured document
 * echoing the input prompt, timestamp, and CLI arguments.
 *
 * The mock responds after a configurable delay (default: 3000ms) set via
 * the `codeExplorer.mockCopilotDelayMs` setting.
 *
 * Invocation: node tools/mock-copilot.js --delay <ms> --output-format text
 *   (stdin: prompt)
 */
import * as path from 'path';
import type { LLMAnalysisRequest, ProviderCapabilities } from '../models/types';
import type { LLMProvider } from './LLMProvider';
import { LLMError, ErrorCode } from '../models/errors';
import { logger } from '../utils/logger';
import { runCLI } from '../utils/cli';

export interface MockCopilotOptions {
  /** Delay in milliseconds before mock responds (default: 3000). */
  delayMs?: number;
  /** Absolute path to the extension root (where tools/ lives). */
  extensionRoot?: string;
}

export class MockCopilotProvider implements LLMProvider {
  readonly name = 'mock-copilot';

  /** Workspace root directory — when set, mock-copilot runs with workspace cwd. */
  private _workspaceRoot?: string;

  /** Delay in ms before the mock agent responds. */
  private _delayMs: number;

  /** Path to the extension root (for locating tools/mock-copilot.js). */
  private _extensionRoot?: string;

  constructor(options?: MockCopilotOptions) {
    this._delayMs = options?.delayMs ?? 3000;
    this._extensionRoot = options?.extensionRoot;
  }

  /** Set the workspace root so the mock runs with workspace context. */
  setWorkspaceRoot(root: string): void {
    this._workspaceRoot = root;
  }

  /** Set the extension root (where tools/mock-copilot.js is located). */
  setExtensionRoot(root: string): void {
    this._extensionRoot = root;
  }

  /** Update the response delay. */
  setDelayMs(delayMs: number): void {
    this._delayMs = delayMs;
  }

  async isAvailable(): Promise<boolean> {
    // The mock-copilot script is always available as long as Node.js is present.
    // We check that the script file exists by attempting to resolve its path.
    try {
      const scriptPath = this._getScriptPath();
      const fs = await import('fs');
      const exists = fs.existsSync(scriptPath);
      if (exists) {
        logger.debug(`mock-copilot: script available at ${scriptPath}`);
      } else {
        logger.warn(`mock-copilot: script not found at ${scriptPath}`);
      }
      return exists;
    } catch {
      logger.warn('mock-copilot: could not verify script availability');
      return false;
    }
  }

  async analyze(request: LLMAnalysisRequest): Promise<string> {
    const scriptPath = this._getScriptPath();

    const args = [scriptPath, '--delay', String(this._delayMs), '--output-format', 'text'];

    // Prepend system instructions into the prompt text (same as copilot-cli).
    let fullPrompt = request.prompt;
    if (request.systemPrompt) {
      fullPrompt = `[System instructions: ${request.systemPrompt}]\n\n${request.prompt}`;
    }

    logger.info(
      `mock-copilot: sending prompt via stdin (${fullPrompt.length} chars, delay=${this._delayMs}ms)`
    );
    logger.debug(`mock-copilot: script=${scriptPath}`);
    const startTime = Date.now();

    try {
      const stdout = await runCLI({
        command: 'node',
        args,
        stdinData: fullPrompt,
        cwd: this._workspaceRoot,
        label: 'mock-copilot',
        onStdoutChunk: (chunk) => logger.logLLMChunk(chunk),
        onStderrChunk: (chunk) => logger.logLLMChunk(`[stderr] ${chunk}`),
      });

      const elapsed = Date.now() - startTime;
      logger.info(`mock-copilot: response received in ${elapsed}ms (${stdout.length} chars)`);

      if (!stdout.trim()) {
        throw new LLMError(
          'mock-copilot returned empty response',
          ErrorCode.LLM_PARSE_ERROR,
          'Mock AI analysis returned empty. Check tools/mock-copilot.js.'
        );
      }

      return stdout;
    } catch (err: unknown) {
      if (err instanceof LLMError) {
        throw err;
      }

      const elapsed = Date.now() - startTime;
      const error = err as Error & { killed?: boolean; signal?: string };

      if (error.killed || error.signal === 'SIGTERM') {
        logger.error(`mock-copilot: timed out after ${elapsed}ms`);
        throw new LLMError(
          `mock-copilot timed out after ${elapsed}ms`,
          ErrorCode.LLM_TIMEOUT,
          'Mock AI analysis timed out.'
        );
      }

      logger.error(`mock-copilot: failed after ${elapsed}ms: ${error.message}`);
      throw new LLMError(
        `mock-copilot failed: ${error.message}`,
        ErrorCode.LLM_UNAVAILABLE,
        'Mock AI analysis failed. Check tools/mock-copilot.js exists and is executable.'
      );
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 128_000,
      supportsStreaming: false,
      costPerMTokenInput: 0,
      costPerMTokenOutput: 0,
    };
  }

  /**
   * Resolve the path to tools/mock-copilot.js.
   * Searches in order:
   *   1. extensionRoot/tools/mock-copilot.js (if extensionRoot set)
   *   2. workspaceRoot/tools/mock-copilot.js (if workspaceRoot set)
   *   3. Relative from __dirname (for development)
   */
  private _getScriptPath(): string {
    if (this._extensionRoot) {
      return path.join(this._extensionRoot, 'tools', 'mock-copilot.js');
    }
    if (this._workspaceRoot) {
      return path.join(this._workspaceRoot, 'tools', 'mock-copilot.js');
    }
    // Fallback: relative to this file's compiled location (dist/)
    return path.join(__dirname, '..', 'tools', 'mock-copilot.js');
  }
}
