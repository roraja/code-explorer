/**
 * Code Explorer — Response Parser
 *
 * Parses LLM markdown responses into structured AnalysisResult fields.
 * Handles inconsistent formatting gracefully.
 */
import type { AnalysisResult, SymbolInfo, CallStackEntry, UsageEntry, RelatedSymbolAnalysis, FunctionStep, SubFunctionInfo, FunctionInputParam, FunctionOutputInfo } from '../models/types';
import { logger } from '../utils/logger';

/** Shape of a single caller entry in the LLM's json:callers block. */
interface LLMCallerEntry {
  name: string;
  filePath: string;
  line: number;
  kind?: string;
  context?: string;
}

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

    // Parse structured callers from json:callers fenced block
    const { callStacks, usages } = this._parseCallers(raw);
    logger.info(
      `ResponseParser: parsed ${callStacks.length} callers, ${usages.length} usage entries from structured JSON`
    );

    // Parse related symbol analyses from json:related_symbols block
    const relatedSymbols = this._parseRelatedSymbols(raw);
    logger.info(`ResponseParser: parsed ${relatedSymbols.length} related symbol analyses`);

    // Parse function steps from json:steps block
    const functionSteps = this._parseSteps(raw);
    logger.info(`ResponseParser: parsed ${functionSteps.length} function steps`);

    // Parse sub-functions from json:subfunctions block
    const subFunctions = this._parseSubFunctions(raw);
    logger.info(`ResponseParser: parsed ${subFunctions.length} sub-functions`);

    // Parse function inputs from json:function_inputs block
    const functionInputs = this._parseFunctionInputs(raw);
    logger.info(`ResponseParser: parsed ${functionInputs.length} function inputs`);

    // Parse function output from json:function_output block
    const functionOutput = this._parseFunctionOutput(raw);
    logger.info(`ResponseParser: parsed function output: ${functionOutput ? functionOutput.typeName : 'none'}`);

    return {
      overview: sections['overview'] || sections['purpose'] || sections['summary'] || '',
      keyMethods: this._parseList(sections['key methods'] || sections['key points']),
      callStacks,
      usages,
      relatedSymbols,
      functionSteps: functionSteps.length > 0 ? functionSteps : undefined,
      subFunctions: subFunctions.length > 0 ? subFunctions : undefined,
      functionInputs: functionInputs.length > 0 ? functionInputs : undefined,
      functionOutput: functionOutput || undefined,
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
   * Extract the ```json:callers ... ``` fenced block and parse into
   * CallStackEntry[] and UsageEntry[].
   */
  private static _parseCallers(
    raw: string
  ): { callStacks: CallStackEntry[]; usages: UsageEntry[] } {
    const callStacks: CallStackEntry[] = [];
    const usages: UsageEntry[] = [];

    // Match ```json:callers ... ``` block
    const match = raw.match(/```json:callers\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseCallers: no json:callers block found');
      return { callStacks, usages };
    }

    try {
      const entries: LLMCallerEntry[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser._parseCallers: json:callers is not an array');
        return { callStacks, usages };
      }

      for (const entry of entries) {
        if (!entry.name || !entry.filePath) {
          continue;
        }

        callStacks.push({
          caller: {
            name: entry.name,
            filePath: entry.filePath,
            line: entry.line || 0,
            kind: (entry.kind as CallStackEntry['caller']['kind']) || 'function',
          },
          callSites: [{ line: entry.line || 0, character: 0 }],
          depth: 0,
          chain: entry.context || `${entry.name} → calls this symbol`,
        });

        usages.push({
          filePath: entry.filePath,
          line: entry.line || 0,
          character: 0,
          contextLine: entry.context || '',
          isDefinition: false,
        });
      }
    } catch (err) {
      logger.warn(`ResponseParser._parseCallers: JSON parse error: ${err}`);
    }

    return { callStacks, usages };
  }

  /**
   * Extract the ```json:steps ... ``` fenced block and parse into FunctionStep[].
   */
  private static _parseSteps(raw: string): FunctionStep[] {
    const match = raw.match(/```json:steps\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseSteps: no json:steps block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser._parseSteps: json:steps is not an array');
        return [];
      }

      return entries
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .filter((e) => typeof e['step'] === 'number' && typeof e['description'] === 'string')
        .map((e) => ({
          step: e['step'] as number,
          description: e['description'] as string,
        }));
    } catch (err) {
      logger.warn(`ResponseParser._parseSteps: JSON parse error: ${err}`);
      return [];
    }
  }

  /**
   * Extract the ```json:subfunctions ... ``` fenced block and parse into SubFunctionInfo[].
   */
  private static _parseSubFunctions(raw: string): SubFunctionInfo[] {
    const match = raw.match(/```json:subfunctions\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseSubFunctions: no json:subfunctions block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser._parseSubFunctions: json:subfunctions is not an array');
        return [];
      }

      return entries
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .filter((e) => typeof e['name'] === 'string')
        .map((e) => ({
          name: e['name'] as string,
          description: typeof e['description'] === 'string' ? e['description'] as string : '',
          input: typeof e['input'] === 'string' ? e['input'] as string : '',
          output: typeof e['output'] === 'string' ? e['output'] as string : '',
          filePath: typeof e['filePath'] === 'string' ? e['filePath'] as string : undefined,
          line: typeof e['line'] === 'number' ? e['line'] as number : undefined,
          kind: typeof e['kind'] === 'string' ? e['kind'] as string : undefined,
        }));
    } catch (err) {
      logger.warn(`ResponseParser._parseSubFunctions: JSON parse error: ${err}`);
      return [];
    }
  }

  /**
   * Extract the ```json:function_inputs ... ``` fenced block and parse into FunctionInputParam[].
   */
  private static _parseFunctionInputs(raw: string): FunctionInputParam[] {
    const match = raw.match(/```json:function_inputs\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseFunctionInputs: no json:function_inputs block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser._parseFunctionInputs: json:function_inputs is not an array');
        return [];
      }

      return entries
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .filter((e) => typeof e['name'] === 'string' && typeof e['typeName'] === 'string')
        .map((e) => ({
          name: String(e['name']),
          typeName: String(e['typeName']),
          description: typeof e['description'] === 'string' ? e['description'] : '',
          mutated: e['mutated'] === true,
          mutationDetail: typeof e['mutationDetail'] === 'string' ? e['mutationDetail'] : undefined,
          typeFilePath: typeof e['typeFilePath'] === 'string' ? e['typeFilePath'] : undefined,
          typeLine: typeof e['typeLine'] === 'number' ? e['typeLine'] : undefined,
          typeKind: typeof e['typeKind'] === 'string' ? e['typeKind'] : undefined,
          typeOverview: typeof e['typeOverview'] === 'string' ? e['typeOverview'] : undefined,
        }));
    } catch (err) {
      logger.warn(`ResponseParser._parseFunctionInputs: JSON parse error: ${err}`);
      return [];
    }
  }

  /**
   * Extract the ```json:function_output ... ``` fenced block and parse into FunctionOutputInfo.
   */
  private static _parseFunctionOutput(raw: string): FunctionOutputInfo | null {
    const match = raw.match(/```json:function_output\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseFunctionOutput: no json:function_output block found');
      return null;
    }

    try {
      const entry: unknown = JSON.parse(match[1]);
      if (typeof entry !== 'object' || entry === null) {
        logger.warn('ResponseParser._parseFunctionOutput: json:function_output is not an object');
        return null;
      }
      const e = entry as Record<string, unknown>;
      if (typeof e['typeName'] !== 'string') {
        return null;
      }
      return {
        typeName: String(e['typeName']),
        description: typeof e['description'] === 'string' ? e['description'] : '',
        typeFilePath: typeof e['typeFilePath'] === 'string' ? e['typeFilePath'] : undefined,
        typeLine: typeof e['typeLine'] === 'number' ? e['typeLine'] : undefined,
        typeKind: typeof e['typeKind'] === 'string' ? e['typeKind'] : undefined,
        typeOverview: typeof e['typeOverview'] === 'string' ? e['typeOverview'] : undefined,
      };
    } catch (err) {
      logger.warn(`ResponseParser._parseFunctionOutput: JSON parse error: ${err}`);
      return null;
    }
  }

  /**
   * Extract the ```json:related_symbols ... ``` fenced block and parse into
   * RelatedSymbolAnalysis[].
   */
  private static _parseRelatedSymbols(raw: string): RelatedSymbolAnalysis[] {
    const match = raw.match(/```json:related_symbols\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseRelatedSymbols: no json:related_symbols block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser._parseRelatedSymbols: json:related_symbols is not an array');
        return [];
      }

      const results: RelatedSymbolAnalysis[] = [];
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) {
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (!e['name'] || !e['filePath'] || !e['overview']) {
          continue;
        }
        results.push({
          name: String(e['name']),
          kind: (e['kind'] as RelatedSymbolAnalysis['kind']) || 'unknown',
          filePath: String(e['filePath']),
          line: typeof e['line'] === 'number' ? e['line'] : 0,
          overview: String(e['overview']),
          keyPoints: Array.isArray(e['keyPoints']) ? e['keyPoints'].map(String) : undefined,
          dependencies: Array.isArray(e['dependencies']) ? e['dependencies'].map(String) : undefined,
          potentialIssues: Array.isArray(e['potentialIssues']) ? e['potentialIssues'].map(String) : undefined,
        });
      }

      return results;
    } catch (err) {
      logger.warn(`ResponseParser._parseRelatedSymbols: JSON parse error: ${err}`);
      return [];
    }
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
