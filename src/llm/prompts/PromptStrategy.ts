/**
 * Code Explorer — Prompt Strategy Interface
 *
 * Defines the contract for symbol-kind-specific prompt strategies.
 * Each strategy builds a prompt tailored to the analysis needs of
 * its symbol kind (function, class, variable, property).
 */
import type { SymbolInfo } from '../../models/types';

/**
 * Additional context gathered before prompt building.
 * Different strategies use different fields.
 */
export interface PromptContext {
  /** Source code of the symbol itself */
  sourceCode: string;
  /** For variables/properties: source of the containing scope (function/class body) */
  containingScopeSource?: string;
  /** For class members: the class name that contains this member */
  containingClassName?: string;
}

/**
 * Strategy interface for building symbol-kind-specific prompts.
 */
export interface PromptStrategy {
  /**
   * Build the analysis prompt for a symbol.
   * @param symbol  The symbol to analyze
   * @param context Source code and surrounding context
   * @param lang    Language identifier (e.g. "typescript", "cpp")
   */
  buildPrompt(symbol: SymbolInfo, context: PromptContext, lang: string): string;
}
