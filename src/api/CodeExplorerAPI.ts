/**
 * Code Explorer — Public API
 *
 * Single entry point for all core operations, constructed with plain
 * Node.js dependencies. No `vscode` import — works outside the
 * extension host (CLI, tests, MCP server).
 *
 * Used by:
 *   - extension.ts (with VscodeSourceReader)
 *   - CLI tool (with FileSystemSourceReader)
 *   - Tests (with FileSystemSourceReader + MockLLMProvider)
 */
import type { ISourceReader } from './ISourceReader';
import type { LLMProvider } from '../llm/LLMProvider';
import type {
  AnalysisResult,
  CursorContext,
  SymbolInfo,
  AnalysisProgressCallback,
} from '../models/types';
import { AnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import { CacheStore } from '../cache/CacheStore';
import { GraphBuilder } from '../graph/GraphBuilder';
import type { DependencyGraph } from '../graph/GraphBuilder';
import { LLMProviderFactory } from '../llm/LLMProviderFactory';
import { FileSystemSourceReader } from './FileSystemSourceReader';

export interface CodeExplorerAPIOptions {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /** LLM provider name: 'copilot-cli' | 'mai-claude' | 'build-service' | 'none'. Defaults to 'none'. */
  llmProvider?: string;
  /** Build service base URL (only for 'build-service' provider). */
  buildServiceUrl?: string;
  /** Build service model name (only for 'build-service' provider). */
  buildServiceModel?: string;
  /** Build service agent backend (only for 'build-service' provider). */
  buildServiceAgentBackend?: string;
  /** Custom source reader. Defaults to FileSystemSourceReader. */
  sourceReader?: ISourceReader;
  /** Custom LLM provider instance. Overrides llmProvider string if set. */
  llmProviderInstance?: LLMProvider;
}

export class CodeExplorerAPI {
  private readonly _orchestrator: AnalysisOrchestrator;
  private readonly _cache: CacheStore;
  private readonly _graphBuilder: GraphBuilder;
  private readonly _llmProvider: LLMProvider;

  constructor(options: CodeExplorerAPIOptions) {
    const { workspaceRoot } = options;

    // Source reader: use provided or default to filesystem
    const sourceReader = options.sourceReader ?? new FileSystemSourceReader(workspaceRoot);

    // LLM provider: use provided instance or create from name
    this._llmProvider =
      options.llmProviderInstance ??
      LLMProviderFactory.create(options.llmProvider ?? 'none', {
        baseUrl: options.buildServiceUrl,
        model: options.buildServiceModel,
        agentBackend: options.buildServiceAgentBackend,
      });

    // Set workspace root on the LLM provider if supported
    if (this._llmProvider.setWorkspaceRoot) {
      this._llmProvider.setWorkspaceRoot(workspaceRoot);
    }

    // Core services
    this._cache = new CacheStore(workspaceRoot);
    this._graphBuilder = new GraphBuilder(workspaceRoot);
    this._orchestrator = new AnalysisOrchestrator(
      sourceReader,
      this._llmProvider,
      this._cache,
      workspaceRoot
    );
  }

  // ─── Core Operations ─────────────────────────────────────

  /**
   * Analyze a symbol from a cursor context (unified LLM call).
   * The LLM identifies the symbol kind and performs analysis in one call.
   */
  async exploreSymbol(
    cursor: CursorContext,
    onProgress?: AnalysisProgressCallback
  ): Promise<{ symbol: SymbolInfo; result: AnalysisResult }> {
    return this._orchestrator.analyzeFromCursor(cursor, onProgress);
  }

  /**
   * Analyze a pre-resolved symbol (legacy/programmatic).
   */
  async analyzeSymbol(
    symbol: SymbolInfo,
    force?: boolean,
    onProgress?: AnalysisProgressCallback
  ): Promise<AnalysisResult> {
    return this._orchestrator.analyzeSymbol(symbol, force, onProgress);
  }

  /**
   * Analyze all symbols in a file.
   * Returns the number of symbols cached.
   */
  async exploreFile(
    filePath: string,
    fileSource: string,
    onProgress?: (stage: string, detail?: string) => void
  ): Promise<number> {
    return this._orchestrator.analyzeFile(filePath, fileSource, onProgress);
  }

  /**
   * Enhance an existing analysis with a follow-up question.
   * Returns updated AnalysisResult with new Q&A entry.
   */
  async enhance(existingResult: AnalysisResult, userPrompt: string): Promise<AnalysisResult> {
    return this._orchestrator.enhanceAnalysis(existingResult, userPrompt);
  }

  /**
   * Clear all cached analyses.
   */
  async clearCache(): Promise<void> {
    return this._cache.clear();
  }

  /**
   * Read a cached analysis for a symbol.
   * Returns null if not cached.
   */
  async readCache(symbol: SymbolInfo): Promise<AnalysisResult | null> {
    return this._cache.read(symbol);
  }

  /**
   * Build the full dependency graph from all cached analyses.
   */
  async buildDependencyGraph(): Promise<DependencyGraph> {
    return this._graphBuilder.buildGraph();
  }

  /**
   * Build a focused subgraph centered on a specific symbol.
   */
  async buildSubgraph(symbolName: string, filePath: string): Promise<DependencyGraph> {
    return this._graphBuilder.buildSubgraph(symbolName, filePath);
  }

  /**
   * Convert a dependency graph to Mermaid flowchart source.
   */
  toMermaid(graph: DependencyGraph, centerId?: string): string {
    return GraphBuilder.toMermaid(graph, centerId);
  }

  /** Get the LLM provider name. */
  get llmProviderName(): string {
    return this._llmProvider.name;
  }

  /** Get the underlying orchestrator (for advanced usage like event subscriptions). */
  get orchestrator(): AnalysisOrchestrator {
    return this._orchestrator;
  }

  /** Get the underlying cache store (for advanced usage). */
  get cacheStore(): CacheStore {
    return this._cache;
  }

  /** Dispose resources. */
  dispose(): void {
    this._orchestrator.dispose();
  }
}
