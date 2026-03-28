/**
 * Code Explorer — LLM Provider Interface
 */
import type { LLMAnalysisRequest, ProviderCapabilities } from '../models/types';

export interface LLMProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  analyze(request: LLMAnalysisRequest): Promise<string>;
  getCapabilities(): ProviderCapabilities;
}
