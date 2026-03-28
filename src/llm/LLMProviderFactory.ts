/**
 * Code Explorer — LLM Provider Factory
 *
 * Creates the appropriate LLM provider based on configuration.
 */
import type { LLMProvider } from './LLMProvider';
import { MaiClaudeProvider } from './MaiClaudeProvider';
import { CopilotCLIProvider } from './CopilotCLIProvider';
import { NullProvider } from './NullProvider';
import { logger } from '../utils/logger';

export class LLMProviderFactory {
  static create(providerName: string): LLMProvider {
    switch (providerName) {
      case 'copilot-cli':
        logger.info('Using copilot-cli LLM provider');
        return new CopilotCLIProvider();
      case 'mai-claude':
        logger.info('Using mai-claude LLM provider');
        return new MaiClaudeProvider();
      case 'none':
        logger.info('LLM provider disabled (none)');
        return new NullProvider();
      default:
        logger.warn(`Unknown LLM provider "${providerName}", falling back to copilot-cli`);
        return new CopilotCLIProvider();
    }
  }
}
