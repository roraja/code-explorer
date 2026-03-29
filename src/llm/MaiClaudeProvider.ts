/**
 * Code Explorer — Mai-Claude LLM Provider
 *
 * Shells out to the `claude` CLI with `-p` (print mode) to run
 * analysis prompts. Sends prompt via stdin to avoid argument length
 * limits. Unsets CLAUDECODE env var to allow nested invocation.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LLMAnalysisRequest, ProviderCapabilities } from '../models/types';
import type { LLMProvider } from './LLMProvider';
import { LLMError, ErrorCode } from '../models/errors';
import { logger } from '../utils/logger';
import { runCLI } from '../utils/cli';

const execFileAsync = promisify(execFile);

export class MaiClaudeProvider implements LLMProvider {
  readonly name = 'mai-claude';

  /** Workspace root directory — when set, claude runs with full workspace context. */
  private _workspaceRoot?: string;

  /** Set the workspace root so claude CLI has full workspace context. */
  setWorkspaceRoot(root: string): void {
    this._workspaceRoot = root;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', ['claude']);
      logger.debug('mai-claude CLI is available');
      return true;
    } catch {
      logger.warn('mai-claude CLI not found on PATH');
      return false;
    }
  }

  async analyze(request: LLMAnalysisRequest): Promise<string> {
    const args = ['-p', '--output-format', 'text'];

    if (request.systemPrompt) {
      args.push('--append-system-prompt', request.systemPrompt);
    }

    logger.info(`mai-claude: sending prompt via stdin (${request.prompt.length} chars)`);
    logger.debug(`mai-claude: args = ${JSON.stringify(args)}`);
    const startTime = Date.now();

    try {
      const stdout = await runCLI({
        command: 'claude',
        args,
        stdinData: request.prompt,
        cwd: this._workspaceRoot,
        label: 'mai-claude',
        envOverrides: { CLAUDECODE: undefined },
        onStdoutChunk: (chunk) => logger.logLLMChunk(chunk),
        onStderrChunk: (chunk) => logger.logLLMChunk(`[stderr] ${chunk}`),
      });

      const elapsed = Date.now() - startTime;
      logger.info(`mai-claude: response received in ${elapsed}ms (${stdout.length} chars)`);

      if (!stdout.trim()) {
        throw new LLMError(
          'mai-claude returned empty response',
          ErrorCode.LLM_PARSE_ERROR,
          'AI analysis returned empty. Try again.'
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
        logger.error(`mai-claude: timed out after ${elapsed}ms`);
        throw new LLMError(
          `mai-claude timed out after ${elapsed}ms`,
          ErrorCode.LLM_TIMEOUT,
          'AI analysis timed out. Try again or use a simpler symbol.'
        );
      }

      logger.error(`mai-claude: failed after ${elapsed}ms: ${error.message}`);
      throw new LLMError(
        `mai-claude failed: ${error.message}`,
        ErrorCode.LLM_UNAVAILABLE,
        'AI analysis failed. Static analysis shown instead.'
      );
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 200_000,
      supportsStreaming: false,
      costPerMTokenInput: 3.0,
      costPerMTokenOutput: 15.0,
    };
  }
}
