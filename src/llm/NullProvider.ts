/**
 * Code Explorer — Null LLM Provider
 *
 * No-op provider used when LLM is disabled or unavailable.
 */
import type { LLMAnalysisRequest, ProviderCapabilities } from '../models/types';
import type { LLMProvider } from './LLMProvider';
import { LLMError, ErrorCode } from '../models/errors';

export class NullProvider implements LLMProvider {
  readonly name = 'none';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async analyze(_request: LLMAnalysisRequest): Promise<string> {
    throw new LLMError(
      'LLM provider is set to "none"',
      ErrorCode.LLM_UNAVAILABLE,
      'AI analysis is disabled. Enable an LLM provider in settings.'
    );
  }

  getCapabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 0,
      supportsStreaming: false,
      costPerMTokenInput: 0,
      costPerMTokenOutput: 0,
    };
  }
}
