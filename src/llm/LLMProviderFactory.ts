/**
 * Code Explorer — LLM Provider Factory
 *
 * Creates the appropriate LLM provider based on configuration.
 *
 * Supported providers:
 *   - "copilot-cli"    — local CLI: `copilot --yolo -s --output-format text`
 *   - "mai-claude"     — local CLI: `claude -p --output-format text`
 *   - "build-service"  — remote HTTP: Go build service (POST /api/v1/copilot/run)
 *   - "mock-copilot"   — local mock: `node tools/mock-copilot.js` (for testing)
 *   - "none"           — no-op (LLM disabled)
 */
import type { LLMProvider } from './LLMProvider';
import { MaiClaudeProvider } from './MaiClaudeProvider';
import { CopilotCLIProvider } from './CopilotCLIProvider';
import { BuildServiceProvider } from './BuildServiceProvider';
import { MockCopilotProvider } from './MockCopilotProvider';
import { NullProvider } from './NullProvider';
import { logger } from '../utils/logger';

export interface BuildServiceFactoryOptions {
  baseUrl?: string;
  model?: string;
  agentBackend?: string;
}

export interface MockCopilotFactoryOptions {
  delayMs?: number;
  extensionRoot?: string;
}

export class LLMProviderFactory {
  static create(
    providerName: string,
    buildServiceOptions?: BuildServiceFactoryOptions,
    mockCopilotOptions?: MockCopilotFactoryOptions
  ): LLMProvider {
    switch (providerName) {
      case 'copilot-cli':
        logger.info('Using copilot-cli LLM provider');
        return new CopilotCLIProvider();
      case 'mai-claude':
        logger.info('Using mai-claude LLM provider');
        return new MaiClaudeProvider();
      case 'build-service': {
        const opts = buildServiceOptions || {};
        logger.info(
          `Using build-service LLM provider ` +
            `(url=${opts.baseUrl || 'http://localhost:8090'}, ` +
            `model=${opts.model || 'claude-opus-4.5'}, ` +
            `backend=${opts.agentBackend || 'default'})`
        );
        return new BuildServiceProvider({
          baseUrl: opts.baseUrl,
          model: opts.model,
          agentBackend: opts.agentBackend,
        });
      }
      case 'mock-copilot': {
        const mockOpts = mockCopilotOptions || {};
        logger.info(`Using mock-copilot LLM provider (delay=${mockOpts.delayMs ?? 3000}ms)`);
        return new MockCopilotProvider({
          delayMs: mockOpts.delayMs,
          extensionRoot: mockOpts.extensionRoot,
        });
      }
      case 'none':
        logger.info('LLM provider disabled (none)');
        return new NullProvider();
      default:
        logger.warn(`Unknown LLM provider "${providerName}", falling back to copilot-cli`);
        return new CopilotCLIProvider();
    }
  }
}
