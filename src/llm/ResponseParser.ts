/**
 * Code Explorer — Response Parser
 *
 * Parses LLM markdown responses into structured AnalysisResult fields.
 * Handles inconsistent formatting gracefully.
 */
import type { AnalysisResult, SymbolInfo, SymbolKindType, CallStackEntry, UsageEntry, RelatedSymbolAnalysis, FunctionStep, SubFunctionInfo, FunctionInputParam, FunctionOutputInfo, DataFlowEntry, DataKindInfo, VariableLifecycle, ClassMemberInfo, MemberAccessInfo } from '../models/types';
import { logger } from '../utils/logger';

/** Shape of a single caller entry in the LLM's json:callers block. */
interface LLMCallerEntry {
  name: string;
  filePath: string;
  line: number;
  kind?: string;
  context?: string;
}

/**
 * The LLM-resolved identity of a symbol at the cursor position.
 * Extracted from the `json:symbol_identity` block in the LLM response.
 */
export interface ResolvedSymbolIdentity {
  /** Canonical symbol name */
  name: string;
  /** Symbol kind determined by the LLM */
  kind: SymbolKindType;
  /** Enclosing container name (class/struct/namespace), if any */
  container: string | null;
  /** Scope chain from outermost to innermost (excluding the symbol itself) */
  scopeChain: string[];
}

/**
 * A related symbol analysis entry with cache file path,
 * produced by the LLM's `json:related_symbol_analyses` block.
 * These can be written directly to the cache.
 */
export interface RelatedSymbolCacheEntry {
  /** Relative cache file path (e.g. "src/utils/foo.ts/fn.bar.md") */
  cacheFilePath: string;
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** Source file path (relative to workspace root) */
  filePath: string;
  /** Line number of the symbol definition */
  line: number;
  /** Container name, if any */
  container: string | null;
  /** Scope chain */
  scopeChain: string[];
  /** LLM-generated overview */
  overview: string;
  /** Key points about the symbol */
  keyPoints: string[];
  /** Dependencies */
  dependencies: string[];
  /** Potential issues */
  potentialIssues: string[];
}

/**
 * A full symbol analysis entry from the file-level analysis prompt.
 * Produced by the LLM's `json:file_symbol_analyses` block.
 * Each entry contains enough data to write a complete cache file.
 */
export interface FileSymbolAnalysisEntry {
  /** Relative cache file path (e.g. "src/utils/foo.ts/fn.bar.md") */
  cacheFilePath: string;
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKindType;
  /** Source file path (relative to workspace root) */
  filePath: string;
  /** Line number of the symbol definition (0-based) */
  line: number;
  /** Container name, if any */
  container: string | null;
  /** Scope chain */
  scopeChain: string[];
  /** LLM-generated overview */
  overview: string;
  /** Key points about the symbol */
  keyPoints: string[];
  /** Function steps */
  steps: FunctionStep[];
  /** Sub-functions called */
  subFunctions: SubFunctionInfo[];
  /** Function input parameters */
  functionInputs: FunctionInputParam[];
  /** Function output */
  functionOutput: FunctionOutputInfo | null;
  /** Class members */
  classMembers: ClassMemberInfo[];
  /** Callers */
  callers: CallStackEntry[];
  /** Dependencies */
  dependencies: string[];
  /** Usage pattern */
  usagePattern: string;
  /** Potential issues */
  potentialIssues: string[];
}

export class ResponseParser {
  /** Valid symbol kinds that the LLM can return. */
  private static readonly _validKinds = new Set<string>([
    'function', 'method', 'class', 'struct', 'variable', 'interface',
    'type', 'enum', 'property', 'parameter', 'unknown',
  ]);

  /**
   * Extract the LLM-resolved symbol identity from the response.
   * Parses the ```json:symbol_identity``` block.
   *
   * @param raw         The full LLM response text
   * @param fallbackName  The word at the cursor, used as fallback if LLM doesn't return a name
   * @returns Resolved identity, or a fallback with kind='unknown' if parsing fails
   */
  static parseSymbolIdentity(raw: string, fallbackName: string): ResolvedSymbolIdentity {
    const match = raw.match(/```json:symbol_identity\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.warn('ResponseParser.parseSymbolIdentity: no json:symbol_identity block found');
      return { name: fallbackName, kind: 'unknown', container: null, scopeChain: [] };
    }

    try {
      const entry: unknown = JSON.parse(match[1]);
      if (typeof entry !== 'object' || entry === null) {
        logger.warn('ResponseParser.parseSymbolIdentity: json:symbol_identity is not an object');
        return { name: fallbackName, kind: 'unknown', container: null, scopeChain: [] };
      }
      const e = entry as Record<string, unknown>;

      const name = typeof e['name'] === 'string' && e['name'].length > 0
        ? e['name']
        : fallbackName;

      const rawKind = typeof e['kind'] === 'string' ? e['kind'].toLowerCase() : 'unknown';
      const kind = (this._validKinds.has(rawKind) ? rawKind : 'unknown') as SymbolKindType;

      const container = typeof e['container'] === 'string' && e['container'].length > 0
        ? e['container']
        : null;

      const scopeChain = Array.isArray(e['scope_chain'])
        ? e['scope_chain'].filter((s): s is string => typeof s === 'string')
        : (container ? [container] : []);

      logger.info(
        `ResponseParser.parseSymbolIdentity: resolved "${name}" as ${kind}` +
          (container ? ` in ${container}` : '') +
          (scopeChain.length > 0 ? ` scope=[${scopeChain.join('.')}]` : '')
      );

      return { name, kind, container, scopeChain };
    } catch (err) {
      logger.warn(`ResponseParser.parseSymbolIdentity: JSON parse error: ${err}`);
      return { name: fallbackName, kind: 'unknown', container: null, scopeChain: [] };
    }
  }

  /**
   * Parse the ```json:related_symbol_analyses``` block from the unified response.
   * Returns cache entries for related symbols that the LLM discovered and analyzed.
   *
   * @param raw The full LLM response text
   */
  static parseRelatedSymbolCacheEntries(raw: string): RelatedSymbolCacheEntry[] {
    const match = raw.match(/```json:related_symbol_analyses\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser.parseRelatedSymbolCacheEntries: no json:related_symbol_analyses block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser.parseRelatedSymbolCacheEntries: json:related_symbol_analyses is not an array');
        return [];
      }

      const results: RelatedSymbolCacheEntry[] = [];
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) {
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (!e['name'] || !e['filePath'] || !e['overview']) {
          continue;
        }

        const rawKind = typeof e['kind'] === 'string' ? e['kind'].toLowerCase() : 'unknown';
        const kind = (this._validKinds.has(rawKind) ? rawKind : 'unknown') as SymbolKindType;

        results.push({
          cacheFilePath: typeof e['cache_file_path'] === 'string' ? e['cache_file_path'] : '',
          name: String(e['name']),
          kind,
          filePath: String(e['filePath']),
          line: typeof e['line'] === 'number' ? e['line'] : 0,
          container: typeof e['container'] === 'string' && e['container'].length > 0 ? e['container'] : null,
          scopeChain: Array.isArray(e['scope_chain'])
            ? e['scope_chain'].filter((s): s is string => typeof s === 'string')
            : [],
          overview: String(e['overview']),
          keyPoints: Array.isArray(e['key_points']) ? e['key_points'].map(String) : [],
          dependencies: Array.isArray(e['dependencies']) ? e['dependencies'].map(String) : [],
          potentialIssues: Array.isArray(e['potential_issues']) ? e['potential_issues'].map(String) : [],
        });
      }

      logger.info(`ResponseParser.parseRelatedSymbolCacheEntries: parsed ${results.length} related symbol cache entries`);
      return results;
    } catch (err) {
      logger.warn(`ResponseParser.parseRelatedSymbolCacheEntries: JSON parse error: ${err}`);
      return [];
    }
  }

  /**
   * Parse the ```json:file_symbol_analyses``` block from a file-level
   * analysis response. Returns an array of FileSymbolAnalysisEntry,
   * each representing one symbol in the file ready for cache writing.
   *
   * @param raw The full LLM response text
   */
  static parseFileSymbolAnalyses(raw: string): FileSymbolAnalysisEntry[] {
    const match = raw.match(/```json:file_symbol_analyses\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.warn('ResponseParser.parseFileSymbolAnalyses: no json:file_symbol_analyses block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        logger.warn('ResponseParser.parseFileSymbolAnalyses: json:file_symbol_analyses is not an array');
        return [];
      }

      const results: FileSymbolAnalysisEntry[] = [];
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) {
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (!e['name'] || !e['filePath'] || !e['overview']) {
          logger.debug(
            `ResponseParser.parseFileSymbolAnalyses: skipping entry — missing name/filePath/overview`
          );
          continue;
        }

        const rawKind = typeof e['kind'] === 'string' ? e['kind'].toLowerCase() : 'unknown';
        const kind = (this._validKinds.has(rawKind) ? rawKind : 'unknown') as SymbolKindType;

        // Parse callers into CallStackEntry[]
        const callers: CallStackEntry[] = [];
        if (Array.isArray(e['callers'])) {
          for (const c of e['callers']) {
            if (typeof c === 'object' && c !== null) {
              const ce = c as Record<string, unknown>;
              if (typeof ce['name'] === 'string' && typeof ce['filePath'] === 'string') {
                callers.push({
                  caller: {
                    name: String(ce['name']),
                    filePath: String(ce['filePath']),
                    line: typeof ce['line'] === 'number' ? ce['line'] : 0,
                    kind: (typeof ce['kind'] === 'string' && this._validKinds.has(ce['kind'])
                      ? ce['kind'] : 'function') as SymbolKindType,
                  },
                  callSites: [{ line: typeof ce['line'] === 'number' ? ce['line'] : 0, character: 0 }],
                  depth: 0,
                  chain: typeof ce['context'] === 'string'
                    ? ce['context']
                    : `${ce['name']} → calls this symbol`,
                });
              }
            }
          }
        }

        // Parse sub-functions
        const subFunctions: SubFunctionInfo[] = [];
        if (Array.isArray(e['sub_functions'])) {
          for (const sf of e['sub_functions']) {
            if (typeof sf === 'object' && sf !== null) {
              const s = sf as Record<string, unknown>;
              if (typeof s['name'] === 'string') {
                subFunctions.push({
                  name: String(s['name']),
                  description: typeof s['description'] === 'string' ? s['description'] : '',
                  input: typeof s['input'] === 'string' ? s['input'] : '',
                  output: typeof s['output'] === 'string' ? s['output'] : '',
                  filePath: typeof s['filePath'] === 'string' ? s['filePath'] : undefined,
                  line: typeof s['line'] === 'number' ? s['line'] : undefined,
                  kind: typeof s['kind'] === 'string' ? s['kind'] : undefined,
                });
              }
            }
          }
        }

        // Parse function inputs
        const functionInputs: FunctionInputParam[] = [];
        if (Array.isArray(e['function_inputs'])) {
          for (const fi of e['function_inputs']) {
            if (typeof fi === 'object' && fi !== null) {
              const f = fi as Record<string, unknown>;
              if (typeof f['name'] === 'string' && typeof f['typeName'] === 'string') {
                functionInputs.push({
                  name: String(f['name']),
                  typeName: String(f['typeName']),
                  description: typeof f['description'] === 'string' ? f['description'] : '',
                  mutated: f['mutated'] === true,
                  mutationDetail: typeof f['mutationDetail'] === 'string' ? f['mutationDetail'] : undefined,
                });
              }
            }
          }
        }

        // Parse function output
        let functionOutput: FunctionOutputInfo | null = null;
        if (typeof e['function_output'] === 'object' && e['function_output'] !== null) {
          const fo = e['function_output'] as Record<string, unknown>;
          if (typeof fo['typeName'] === 'string') {
            functionOutput = {
              typeName: String(fo['typeName']),
              description: typeof fo['description'] === 'string' ? fo['description'] : '',
              typeFilePath: typeof fo['typeFilePath'] === 'string' ? fo['typeFilePath'] : undefined,
              typeLine: typeof fo['typeLine'] === 'number' ? fo['typeLine'] : undefined,
              typeKind: typeof fo['typeKind'] === 'string' ? fo['typeKind'] : undefined,
              typeOverview: typeof fo['typeOverview'] === 'string' ? fo['typeOverview'] : undefined,
            };
          }
        }

        // Parse class members
        const classMembers: ClassMemberInfo[] = [];
        const validMemberKinds = new Set(['field', 'method', 'property', 'constructor', 'getter', 'setter']);
        const validVisibility = new Set(['public', 'private', 'protected', 'internal']);
        if (Array.isArray(e['class_members'])) {
          for (const cm of e['class_members']) {
            if (typeof cm === 'object' && cm !== null) {
              const m = cm as Record<string, unknown>;
              if (typeof m['name'] === 'string') {
                classMembers.push({
                  name: String(m['name']),
                  memberKind: (validMemberKinds.has(m['memberKind'] as string)
                    ? m['memberKind'] : 'field') as ClassMemberInfo['memberKind'],
                  typeName: typeof m['typeName'] === 'string' ? m['typeName'] : 'unknown',
                  visibility: (validVisibility.has(m['visibility'] as string)
                    ? m['visibility'] : 'public') as ClassMemberInfo['visibility'],
                  isStatic: m['isStatic'] === true,
                  description: typeof m['description'] === 'string' ? m['description'] : '',
                  line: typeof m['line'] === 'number' ? m['line'] : undefined,
                });
              }
            }
          }
        }

        // Parse steps
        const steps: FunctionStep[] = [];
        if (Array.isArray(e['steps'])) {
          for (const st of e['steps']) {
            if (typeof st === 'object' && st !== null) {
              const s = st as Record<string, unknown>;
              if (typeof s['step'] === 'number' && typeof s['description'] === 'string') {
                steps.push({ step: s['step'], description: s['description'] });
              }
            }
          }
        }

        results.push({
          cacheFilePath: typeof e['cache_file_path'] === 'string' ? e['cache_file_path'] : '',
          name: String(e['name']),
          kind,
          filePath: String(e['filePath']),
          line: typeof e['line'] === 'number' ? e['line'] : 0,
          container: typeof e['container'] === 'string' && e['container'].length > 0 ? e['container'] : null,
          scopeChain: Array.isArray(e['scope_chain'])
            ? e['scope_chain'].filter((s): s is string => typeof s === 'string')
            : [],
          overview: String(e['overview']),
          keyPoints: Array.isArray(e['key_points']) ? e['key_points'].map(String) : [],
          steps,
          subFunctions,
          functionInputs,
          functionOutput,
          classMembers,
          callers,
          dependencies: Array.isArray(e['dependencies']) ? e['dependencies'].map(String) : [],
          usagePattern: typeof e['usage_pattern'] === 'string' ? e['usage_pattern'] : '',
          potentialIssues: Array.isArray(e['potential_issues']) ? e['potential_issues'].map(String) : [],
        });
      }

      logger.info(`ResponseParser.parseFileSymbolAnalyses: parsed ${results.length} file symbol analyses`);
      return results;
    } catch (err) {
      logger.warn(`ResponseParser.parseFileSymbolAnalyses: JSON parse error: ${err}`);
      return [];
    }
  }

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

    // Parse data flow from json:data_flow block
    const dataFlow = this._parseDataFlow(raw);
    logger.info(`ResponseParser: parsed ${dataFlow.length} data flow entries`);

    // Parse variable lifecycle from json:variable_lifecycle block
    const variableLifecycle = this._parseVariableLifecycle(raw, sections);
    logger.info(`ResponseParser: parsed variable lifecycle: ${variableLifecycle ? 'yes' : 'no'}`);

    // Parse data kind from json:data_kind block
    const dataKind = this._parseDataKind(raw);
    logger.info(`ResponseParser: parsed data kind: ${dataKind ? dataKind.label : 'none'}`);

    // Parse class members from json:class_members block
    const classMembers = this._parseClassMembers(raw);
    logger.info(`ResponseParser: parsed ${classMembers.length} class members`);

    // Parse member access patterns from json:member_access block
    const memberAccess = this._parseMemberAccess(raw);
    logger.info(`ResponseParser: parsed ${memberAccess.length} member access patterns`);

    return {
      overview: sections['overview'] || sections['purpose'] || sections['summary'] || '',
      keyMethods: this._parseList(sections['key methods'] || sections['key points']),
      callStacks,
      usages,
      dataFlow: dataFlow.length > 0 ? dataFlow : [],
      relatedSymbols,
      functionSteps: functionSteps.length > 0 ? functionSteps : undefined,
      subFunctions: subFunctions.length > 0 ? subFunctions : undefined,
      functionInputs: functionInputs.length > 0 ? functionInputs : undefined,
      functionOutput: functionOutput || undefined,
      classMembers: classMembers.length > 0 ? classMembers : undefined,
      memberAccess: memberAccess.length > 0 ? memberAccess : undefined,
      dependencies: this._parseList(sections['dependencies']),
      usagePattern: sections['usage pattern'] || sections['usage'] || '',
      potentialIssues: this._parseList(sections['potential issues'] || sections['issues']),
      variableLifecycle: variableLifecycle || undefined,
      dataKind: dataKind || undefined,
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
   * Extract the ```json:data_flow ... ``` fenced block and parse into DataFlowEntry[].
   */
  private static _parseDataFlow(raw: string): DataFlowEntry[] {
    const match = raw.match(/```json:data_flow\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseDataFlow: no json:data_flow block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        return [];
      }

      const validTypes = new Set(['created', 'assigned', 'read', 'modified', 'consumed', 'returned', 'passed']);
      return entries
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .filter((e) => typeof e['type'] === 'string' && typeof e['description'] === 'string')
        .map((e) => ({
          type: (validTypes.has(e['type'] as string) ? e['type'] : 'read') as DataFlowEntry['type'],
          filePath: typeof e['filePath'] === 'string' ? e['filePath'] : '',
          line: typeof e['line'] === 'number' ? e['line'] : 0,
          description: e['description'] as string,
        }));
    } catch (err) {
      logger.warn(`ResponseParser._parseDataFlow: JSON parse error: ${err}`);
      return [];
    }
  }

  /**
   * Extract the ```json:variable_lifecycle ... ``` fenced block and parse into VariableLifecycle.
   * Falls back to extracting from markdown sections if no JSON block is found.
   */
  private static _parseVariableLifecycle(
    raw: string,
    sections: Record<string, string>
  ): VariableLifecycle | null {
    const match = raw.match(/```json:variable_lifecycle\s*\n([\s\S]*?)\n\s*```/);
    if (match) {
      try {
        const entry: unknown = JSON.parse(match[1]);
        if (typeof entry !== 'object' || entry === null) {
          return null;
        }
        const e = entry as Record<string, unknown>;
        return {
          declaration: typeof e['declaration'] === 'string' ? e['declaration'] : '',
          initialization: typeof e['initialization'] === 'string' ? e['initialization'] : '',
          mutations: Array.isArray(e['mutations']) ? e['mutations'].map(String) : [],
          consumption: Array.isArray(e['consumption']) ? e['consumption'].map(String) : [],
          scopeAndLifetime: typeof e['scopeAndLifetime'] === 'string' ? e['scopeAndLifetime'] : '',
        };
      } catch (err) {
        logger.warn(`ResponseParser._parseVariableLifecycle: JSON parse error: ${err}`);
      }
    }

    // Fallback: try section-based extraction
    const hasLifecycleData = sections['declaration'] || sections['variable lifecycle'];
    if (!hasLifecycleData) {
      return null;
    }

    return {
      declaration: sections['declaration'] || '',
      initialization: sections['initialization'] || '',
      mutations: this._parseList(sections['mutations']),
      consumption: this._parseList(sections['consumption']),
      scopeAndLifetime: sections['scope & lifetime'] || sections['scope'] || '',
    };
  }

  /**
   * Extract the ```json:data_kind ... ``` fenced block and parse into DataKindInfo.
   * Returns null if no block is found or parsing fails.
   */
  private static _parseDataKind(raw: string): DataKindInfo | null {
    const match = raw.match(/```json:data_kind\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseDataKind: no json:data_kind block found');
      return null;
    }

    try {
      const entry: unknown = JSON.parse(match[1]);
      if (typeof entry !== 'object' || entry === null) {
        logger.warn('ResponseParser._parseDataKind: json:data_kind is not an object');
        return null;
      }
      const e = entry as Record<string, unknown>;

      const label = typeof e['label'] === 'string' && e['label'].length > 0
        ? e['label']
        : null;
      if (!label) {
        logger.warn('ResponseParser._parseDataKind: missing required "label" field');
        return null;
      }

      return {
        label,
        description: typeof e['description'] === 'string' ? e['description'] : '',
        examples: Array.isArray(e['examples']) ? e['examples'].map(String) : [],
        references: Array.isArray(e['references']) ? e['references'].map(String) : [],
      };
    } catch (err) {
      logger.warn(`ResponseParser._parseDataKind: JSON parse error: ${err}`);
      return null;
    }
  }

  /**
   * Extract the ```json:class_members ... ``` fenced block and parse into ClassMemberInfo[].
   */
  private static _parseClassMembers(raw: string): ClassMemberInfo[] {
    const match = raw.match(/```json:class_members\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseClassMembers: no json:class_members block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        return [];
      }

      const validKinds = new Set(['field', 'method', 'property', 'constructor', 'getter', 'setter']);
      const validVisibility = new Set(['public', 'private', 'protected', 'internal']);

      return entries
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .filter((e) => typeof e['name'] === 'string')
        .map((e) => ({
          name: e['name'] as string,
          memberKind: (validKinds.has(e['memberKind'] as string) ? e['memberKind'] : 'field') as ClassMemberInfo['memberKind'],
          typeName: typeof e['typeName'] === 'string' ? e['typeName'] : 'unknown',
          visibility: (validVisibility.has(e['visibility'] as string) ? e['visibility'] : 'public') as ClassMemberInfo['visibility'],
          isStatic: e['isStatic'] === true,
          description: typeof e['description'] === 'string' ? e['description'] : '',
          line: typeof e['line'] === 'number' ? e['line'] : undefined,
        }));
    } catch (err) {
      logger.warn(`ResponseParser._parseClassMembers: JSON parse error: ${err}`);
      return [];
    }
  }

  /**
   * Extract the ```json:member_access ... ``` fenced block and parse into MemberAccessInfo[].
   */
  private static _parseMemberAccess(raw: string): MemberAccessInfo[] {
    const match = raw.match(/```json:member_access\s*\n([\s\S]*?)\n\s*```/);
    if (!match) {
      logger.debug('ResponseParser._parseMemberAccess: no json:member_access block found');
      return [];
    }

    try {
      const entries: unknown[] = JSON.parse(match[1]);
      if (!Array.isArray(entries)) {
        return [];
      }

      return entries
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .filter((e) => typeof e['memberName'] === 'string')
        .map((e) => ({
          memberName: e['memberName'] as string,
          readBy: Array.isArray(e['readBy']) ? e['readBy'].map(String) : [],
          writtenBy: Array.isArray(e['writtenBy']) ? e['writtenBy'].map(String) : [],
          externalAccess: e['externalAccess'] === true,
        }));
    } catch (err) {
      logger.warn(`ResponseParser._parseMemberAccess: JSON parse error: ${err}`);
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
