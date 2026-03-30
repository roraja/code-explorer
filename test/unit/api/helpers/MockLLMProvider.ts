/**
 * Code Explorer — Mock LLM Provider
 *
 * Configurable mock that returns canned responses for tests.
 * No VS Code dependency — works in plain Node.js.
 */
import type { LLMProvider } from '../../../../src/llm/LLMProvider';
import type { LLMAnalysisRequest, ProviderCapabilities } from '../../../../src/models/types';

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  private _responses: Map<string, string> = new Map();
  private _defaultResponse: string;
  public callCount = 0;
  public lastPrompt = '';

  constructor(defaultResponse: string) {
    this._defaultResponse = defaultResponse;
  }

  /** Register a canned response for prompts containing a keyword. */
  whenPromptContains(keyword: string, response: string): void {
    this._responses.set(keyword, response);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyze(request: LLMAnalysisRequest): Promise<string> {
    this.callCount++;
    this.lastPrompt = request.prompt;
    for (const [keyword, response] of this._responses) {
      if (request.prompt.includes(keyword)) {
        return response;
      }
    }
    return this._defaultResponse;
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
