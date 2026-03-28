/**
 * Code Explorer — Prompt Builder
 *
 * Builds structured prompts for different symbol kinds.
 * Each prompt asks the LLM to return analysis in a specific markdown format
 * that the ResponseParser can reliably extract.
 */
import type { SymbolInfo, UsageEntry } from '../models/types';
import { logger } from '../utils/logger';

export class PromptBuilder {
  /** System prompt shared across all analysis types. */
  static readonly SYSTEM_PROMPT = `You are a code analysis assistant. Analyze the given code and provide a structured response using the exact markdown section headers requested. Be concise and specific. Use the exact heading names provided — do not rename or skip them.`;

  /**
   * Build an analysis prompt for any symbol kind.
   */
  static build(symbol: SymbolInfo, sourceCode: string, usages: UsageEntry[]): string {
    const lang = this._guessLanguage(symbol.filePath);
    logger.debug(
      `PromptBuilder.build: ${symbol.kind} "${symbol.name}" — ` +
        `source: ${sourceCode.length} chars, usages: ${usages.length}, lang: ${lang || 'unknown'}`
    );

    const usageLines = usages
      .slice(0, 20) // Limit to avoid huge prompts
      .map(
        (u, i) =>
          `${i + 1}. ${u.filePath}:${u.line} — \`${u.contextLine.trim()}\`${u.isDefinition ? ' (definition)' : ''}`
      )
      .join('\n');

    return `Analyze the following ${symbol.kind} "${symbol.name}" from file "${symbol.filePath}".

## Source Code
\`\`\`${lang}
${sourceCode}
\`\`\`

## Known References (${usages.length} total)
${usageLines || '(none found)'}

## Instructions
Provide your analysis using these exact section headers:

### Overview
A 2-3 sentence description of what this ${symbol.kind} does, its purpose, and role.

### Key Points
For classes: list key methods with one-line descriptions.
For functions/methods: describe parameters, return value, and side effects.
For variables: describe type, mutability, and purpose.

### Dependencies
List other symbols this depends on (imports, base classes, used services), one per line.

### Usage Pattern
Describe how and where this ${symbol.kind} is typically used in the codebase.

### Potential Issues
List up to 3 code smells, bugs, or improvement suggestions. If none, say "None detected."`;
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
