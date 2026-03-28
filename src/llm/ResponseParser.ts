/**
 * Code Explorer — Response Parser
 *
 * Parses LLM markdown responses into structured AnalysisResult fields.
 * Handles inconsistent formatting gracefully.
 */
import type { AnalysisResult, SymbolInfo } from '../models/types';
import { logger } from '../utils/logger';

export class ResponseParser {
  /**
   * Parse an LLM markdown response into partial AnalysisResult fields.
   */
  static parse(raw: string, _symbol: SymbolInfo): Partial<AnalysisResult> {
    logger.debug(`ResponseParser.parse: input length ${raw.length} chars`);
    const sections = this._extractSections(raw);

    const sectionNames = Object.keys(sections);
    logger.info(
      `ResponseParser: extracted ${sectionNames.length} sections: [${sectionNames.join(', ')}]`
    );

    return {
      overview: sections['overview'] || sections['purpose'] || sections['summary'] || '',
      keyMethods: this._parseList(sections['key methods'] || sections['key points']),
      dependencies: this._parseList(sections['dependencies']),
      usagePattern: sections['usage pattern'] || sections['usage'] || '',
      potentialIssues: this._parseList(sections['potential issues'] || sections['issues']),
      variableLifecycle: {
        declaration: sections['declaration'] || '',
        initialization: sections['initialization'] || '',
        mutations: this._parseList(sections['mutations']),
        consumption: this._parseList(sections['consumption']),
        scopeAndLifetime: sections['scope & lifetime'] || sections['scope'] || '',
      },
    };
  }

  /**
   * Extract markdown sections keyed by their heading text (lowercased).
   */
  private static _extractSections(markdown: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const regex = /^#{1,3}\s+(.+)$/gm;
    let lastKey: string | null = null;
    let lastIndex = 0;

    let match;
    while ((match = regex.exec(markdown)) !== null) {
      if (lastKey !== null) {
        sections[lastKey] = markdown.substring(lastIndex, match.index).trim();
      }
      lastKey = match[1].toLowerCase().trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastKey !== null) {
      sections[lastKey] = markdown.substring(lastIndex).trim();
    }

    return sections;
  }

  /**
   * Parse a markdown list (- or * prefixed lines) into string array.
   */
  private static _parseList(text: string | undefined): string[] {
    if (!text) {
      return [];
    }
    return text
      .split('\n')
      .map((line) =>
        line
          .replace(/^[-*•]\s*/, '')
          .replace(/^\d+\.\s*/, '')
          .trim()
      )
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }
}
