/**
 * Code Explorer — Copilot CLI LLM Provider
 *
 * Shells out to the `copilot` CLI in non-interactive mode.
 * Prompt is piped via stdin (omitting -p flag) so that large prompts
 * are not limited by OS argument length.
 *
 * Invocation: copilot --yolo -s --output-format text  (stdin: prompt)
 *   --yolo    = allow all tools/paths/urls without prompting
 *   -s        = silent mode (suppress stats, output only the response)
 *
 * Note: `copilot` does NOT support --append-system-prompt.
 * System-level instructions are baked into the prompt itself.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LLMAnalysisRequest, ProviderCapabilities } from '../models/types';
import type { LLMProvider } from './LLMProvider';
import { LLMError, ErrorCode } from '../models/errors';
import { logger } from '../utils/logger';
import { runCLI } from '../utils/cli';

const execFileAsync = promisify(execFile);

export class CopilotCLIProvider implements LLMProvider {
  readonly name = 'copilot-cli';

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', ['copilot']);
      logger.debug('copilot CLI is available');
      return true;
    } catch {
      logger.warn('copilot CLI not found on PATH');
      return false;
    }
  }

  async analyze(request: LLMAnalysisRequest): Promise<string> {
    const args = [
      '--yolo', // allow all tools/paths without prompting
      '-s', // silent — suppress stats, only output the response
      '--output-format',
      'text',
    ];

    // Copilot doesn't have --append-system-prompt.
    // Prepend system instructions directly into the prompt text.
    let fullPrompt = request.prompt;
    if (request.systemPrompt) {
      fullPrompt = `[System instructions: ${request.systemPrompt}]\n\n${request.prompt}`;
    }

    logger.info(`copilot-cli: sending prompt via stdin (${fullPrompt.length} chars)`);
    logger.debug(`copilot-cli: args = ${JSON.stringify(args)}`);
    const startTime = Date.now();

    try {
      const stdout = await runCLI({
        command: 'copilot',
        args,
        stdinData: fullPrompt,
        label: 'copilot-cli',
      });

      const elapsed = Date.now() - startTime;
      logger.info(`copilot-cli: response received in ${elapsed}ms (${stdout.length} chars)`);

      if (!stdout.trim()) {
        throw new LLMError(
          'copilot-cli returned empty response',
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
        logger.error(`copilot-cli: timed out after ${elapsed}ms`);
        throw new LLMError(
          `copilot-cli timed out after ${elapsed}ms`,
          ErrorCode.LLM_TIMEOUT,
          'AI analysis timed out. Try again or use a simpler symbol.'
        );
      }

      logger.error(`copilot-cli: failed after ${elapsed}ms: ${error.message}`);
      throw new LLMError(
        `copilot-cli failed: ${error.message}`,
        ErrorCode.LLM_UNAVAILABLE,
        'AI analysis failed. Static analysis shown instead.'
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
}
