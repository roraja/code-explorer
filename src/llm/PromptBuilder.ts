/**
 * Code Explorer — Prompt Builder
 *
 * Builds structured prompts for different symbol kinds using
 * the strategy pattern. Each symbol kind gets a tailored prompt
 * that asks the LLM for the most relevant analysis.
 */
import type { SymbolInfo } from '../models/types';
import type { PromptStrategy, PromptContext } from './prompts/PromptStrategy';
import { FunctionPromptStrategy } from './prompts/FunctionPromptStrategy';
import { VariablePromptStrategy } from './prompts/VariablePromptStrategy';
import { ClassPromptStrategy } from './prompts/ClassPromptStrategy';
import { PropertyPromptStrategy } from './prompts/PropertyPromptStrategy';
import { logger } from '../utils/logger';

/** Registry mapping symbol kinds to their prompt strategies. */
const STRATEGY_MAP: Record<string, PromptStrategy> = {
  function: new FunctionPromptStrategy(),
  method: new FunctionPromptStrategy(),
  variable: new VariablePromptStrategy(),
  class: new ClassPromptStrategy(),
  interface: new ClassPromptStrategy(),
  enum: new ClassPromptStrategy(),
  property: new PropertyPromptStrategy(),
};

/** Default strategy for unknown symbol kinds. */
const DEFAULT_STRATEGY = new FunctionPromptStrategy();

export class PromptBuilder {
  /** System prompt shared across all analysis types. */
  static readonly SYSTEM_PROMPT = `You are a code analysis assistant. Analyze the given code and provide a structured response using the exact markdown section headers requested. Be concise and specific. Use the exact heading names provided — do not rename or skip them. When outputting structured data blocks, follow the exact JSON format specified.`;

  /**
   * Build an analysis prompt for any symbol kind.
   * Delegates to the appropriate strategy based on symbol kind.
   *
   * @param symbol      The symbol to analyze
   * @param sourceCode  Source code of the symbol itself
   * @param containingScopeSource  Optional source of the containing scope (for variables/properties)
   */
  static build(
    symbol: SymbolInfo,
    sourceCode: string,
    containingScopeSource?: string
  ): string {
    const lang = this._guessLanguage(symbol.filePath);
    const strategy = STRATEGY_MAP[symbol.kind] || DEFAULT_STRATEGY;

    logger.debug(
      `PromptBuilder.build: ${symbol.kind} "${symbol.name}" — ` +
        `strategy: ${strategy.constructor.name}, ` +
        `source: ${sourceCode.length} chars, ` +
        `containingScope: ${containingScopeSource ? containingScopeSource.length : 0} chars, ` +
        `lang: ${lang || 'unknown'}`
    );

    const context: PromptContext = {
      sourceCode,
      containingScopeSource,
      containingClassName: symbol.scopeChain && symbol.scopeChain.length > 0
        ? symbol.scopeChain[symbol.scopeChain.length - 1]
        : undefined,
    };

    return strategy.buildPrompt(symbol, context, lang);
  }

  /**
   * Get the strategy used for a given symbol kind (for testing).
   */
  static getStrategy(kind: string): PromptStrategy {
    return STRATEGY_MAP[kind] || DEFAULT_STRATEGY;
  }

  private static _guessLanguage(filePath: string): string {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      return 'typescript';
    }
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
      return 'javascript';
    }
    if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.cxx')) {
      return 'cpp';
    }
    if (filePath.endsWith('.c')) {
      return 'c';
    }
    if (filePath.endsWith('.h') || filePath.endsWith('.hpp')) {
      return 'cpp';
    }
    if (filePath.endsWith('.py')) {
      return 'python';
    }
    if (filePath.endsWith('.java')) {
      return 'java';
    }
    if (filePath.endsWith('.cs')) {
      return 'csharp';
    }
    return '';
  }
}
