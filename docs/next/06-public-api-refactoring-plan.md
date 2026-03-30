# Public API Layer: Refactoring Plan for VS-Code-Free Core

**Date**: 2026-03-30
**Status**: Implemented
**Depends on**: None (refactoring only, no breaking changes to existing flows)

---

## 1. Problem Statement

All core functionality (explore symbol, explore file, enhance analysis, clear cache, build dependency graph) is invoked exclusively through VS Code command handlers in `extension.ts` and the `CodeExplorerViewProvider`. This means:

1. **Testing requires VS Code runtime** — unit tests cannot exercise the full analysis pipeline without mocking the entire `vscode` module.
2. **No standalone invocation** — there is no way to run symbol analysis from a plain Node.js script, a CLI tool, or an MCP server without pulling in VS Code APIs.
3. **Tight coupling** — `AnalysisOrchestrator` imports `vscode` solely for `EventEmitter`; `StaticAnalyzer` is deeply coupled to VS Code's document symbol provider; `logger` depends on `vscode.OutputChannel`.

### What's Actually VS-Code-Free Today

A careful audit shows most core modules have **zero** `import * as vscode` dependencies:

| Module | VS Code Import? | Notes |
|--------|-----------------|-------|
| `CacheStore` | **No** | Pure `fs` + `path`. Fully testable today. |
| `PromptBuilder` | **No** | Pure string construction. Fully testable today. |
| `ResponseParser` | **No** | Pure regex parsing. Fully testable today. |
| `GraphBuilder` | **No** | Reads cache files via `fs`. Fully testable today. |
| `LLMProvider` (interface) | **No** | Pure interface. |
| `CopilotCLIProvider` | **No** | Uses `child_process` only. |
| `MaiClaudeProvider` | **No** | Uses `child_process` only. |
| `BuildServiceProvider` | **No** | Uses `http` only. |
| `NullProvider` | **No** | Pure no-op. |
| `LLMProviderFactory` | **No** | Pure factory. |
| `cli.ts` | **No** | Uses `child_process.spawn`. |
| `SymbolAddress` | **No** | Pure string/crypto utils. |
| `models/types.ts` | **No** | Pure type definitions. |
| `models/errors.ts` | **No** | Pure error classes. |
| `models/constants.ts` | **No** | Pure constants. |
| `AnalysisOrchestrator` | **Yes** | Only uses `vscode.EventEmitter` (2 lines). Easy to remove. |
| `StaticAnalyzer` | **Yes** | Deeply coupled — all methods use `vscode.commands`, `vscode.workspace`. |
| `logger.ts` | **Yes** | Uses `vscode.OutputChannel`. Needs abstraction. |
| `CodeExplorerViewProvider` | **Yes** | UI layer — stays VS-Code-coupled. |
| `extension.ts` | **Yes** | Entry point — stays VS-Code-coupled. |

**Key insight**: The analysis pipeline is 90% VS-Code-free already. The only real blockers are:
- `AnalysisOrchestrator` uses `vscode.EventEmitter` (trivially replaceable)
- `AnalysisOrchestrator` depends on `StaticAnalyzer` (already injected via constructor)
- `logger` uses `vscode.OutputChannel` (needs a transport abstraction)

---

## 2. Goals

1. **Create `src/api/CodeExplorerAPI.ts`** — a single public API class that exposes every core operation, constructed with plain Node.js dependencies (no `vscode` import).
2. **Make `extension.ts` a thin adapter** — it constructs the API with VS-Code-specific implementations and delegates all command handlers to it.
3. **Define interfaces for all VS-Code-coupled services** — `ISourceReader`, `ILogger` — so the API accepts either real VS Code implementations or test mocks.
4. **Provide a CLI tool** (`src/cli/code-explorer-cli.ts`) that constructs the API with file-system-based implementations and exposes commands via `yargs` or simple arg parsing.
5. **Write 5 core integration tests** that exercise the full pipeline with mock LLM + real cache on disk, no VS Code runtime required.

---

## 3. Architecture

### 3.1 New Interface: `ISourceReader`

`StaticAnalyzer` is the only module that deeply uses VS Code APIs. Its methods serve two purposes in the pipeline:

1. **`readSymbolSource(symbol)`** — reads source code from a file (used by `analyzeSymbol`)
2. **`readContainingScopeSource(symbol)`** — reads enclosing scope source (used for variable analysis)
3. **`resolveSymbolAtPosition(...)`** — resolves cursor to SymbolInfo (used by `analyzeFromCursor`)
4. **`listFileSymbols(filePath)`** — lists symbols in a file (used by `analyzeFile`)

We extract an interface that the API depends on:

```typescript
// src/api/ISourceReader.ts
export interface ISourceReader {
  /** Read source code for a symbol's definition. */
  readSymbolSource(symbol: SymbolInfo): Promise<string>;

  /** Read the enclosing scope's source (for variable/property context). */
  readContainingScopeSource(symbol: SymbolInfo): Promise<string>;

  /**
   * Resolve the symbol at a cursor position.
   * Returns null if resolution is not possible (e.g., no language server).
   */
  resolveSymbolAtPosition(
    filePath: string,
    line: number,
    character: number,
    word: string
  ): Promise<SymbolInfo | null>;

  /**
   * List all important symbols in a file.
   * Returns empty array if not supported.
   */
  listFileSymbols(filePath: string): Promise<FileSymbolDescriptor[]>;
}
```

Two implementations:

| Implementation | Location | Used by |
|---|---|---|
| `VscodeSourceReader` | `src/providers/VscodeSourceReader.ts` | `extension.ts` (wraps existing `StaticAnalyzer`) |
| `FileSystemSourceReader` | `src/api/FileSystemSourceReader.ts` | CLI, tests (reads files via `fs`, returns source code, returns `null` for resolution) |

### 3.2 New Interface: `ILogger`

```typescript
// src/api/ILogger.ts
export interface ILogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  // LLM-specific logging (no-op in simple implementations)
  startLLMCallLog(symbolName: string, providerName: string): void;
  logLLMStep(msg: string): void;
  logLLMInput(prompt: string): void;
  logLLMOutput(response: string): void;
  logLLMChunk(chunk: string): void;
  startCommandLog(commandName: string): void;
  endCommandLog(): void;
}
```

Two implementations:

| Implementation | Location | Used by |
|---|---|---|
| `VscodeLogger` | Existing `src/utils/logger.ts` (refactored to implement `ILogger`) | `extension.ts` |
| `ConsoleLogger` | `src/api/ConsoleLogger.ts` | CLI, tests |
| `NullLogger` | `src/api/NullLogger.ts` | Silent tests |

### 3.3 Refactor `AnalysisOrchestrator`

Remove the `vscode.EventEmitter` dependency. Replace with a simple callback or Node.js `EventEmitter`:

```typescript
// Before
import * as vscode from 'vscode';
private readonly _onAnalysisComplete = new vscode.EventEmitter<AnalysisResult>();
readonly onAnalysisComplete = this._onAnalysisComplete.event;

// After — use a simple callback list (no vscode import)
private _onAnalysisCompleteCallbacks: ((result: AnalysisResult) => void)[] = [];

onAnalysisComplete(callback: (result: AnalysisResult) => void): { dispose: () => void } {
  this._onAnalysisCompleteCallbacks.push(callback);
  return { dispose: () => { /* remove from list */ } };
}

private _fireAnalysisComplete(result: AnalysisResult): void {
  for (const cb of this._onAnalysisCompleteCallbacks) cb(result);
}
```

Also: change constructor to accept `ISourceReader` instead of `StaticAnalyzer`, and accept `ILogger` (or use a global setter).

### 3.4 The Public API Class

```typescript
// src/api/CodeExplorerAPI.ts
import type { ISourceReader } from './ISourceReader';
import type { LLMProvider } from '../llm/LLMProvider';
import type {
  AnalysisResult, CursorContext, SymbolInfo, AnalysisProgressCallback
} from '../models/types';
import { AnalysisOrchestrator } from '../analysis/AnalysisOrchestrator';
import { CacheStore } from '../cache/CacheStore';
import { GraphBuilder, DependencyGraph } from '../graph/GraphBuilder';
import { LLMProviderFactory } from '../llm/LLMProviderFactory';

export interface CodeExplorerAPIOptions {
  workspaceRoot: string;
  llmProvider?: string;           // 'copilot-cli' | 'mai-claude' | 'build-service' | 'none'
  buildServiceUrl?: string;
  buildServiceModel?: string;
  buildServiceAgentBackend?: string;
  sourceReader?: ISourceReader;   // defaults to FileSystemSourceReader
}

export class CodeExplorerAPI {
  private readonly _orchestrator: AnalysisOrchestrator;
  private readonly _cache: CacheStore;
  private readonly _graphBuilder: GraphBuilder;
  private readonly _llmProvider: LLMProvider;

  constructor(options: CodeExplorerAPIOptions) {
    // ... construct all dependencies from plain options
  }

  // ─── Core Operations ───

  /** Analyze a symbol from a cursor context (unified LLM call). */
  async exploreSymbol(cursor: CursorContext,
    onProgress?: AnalysisProgressCallback
  ): Promise<{ symbol: SymbolInfo; result: AnalysisResult }> {
    return this._orchestrator.analyzeFromCursor(cursor, onProgress);
  }

  /** Analyze a pre-resolved symbol (legacy/programmatic). */
  async analyzeSymbol(symbol: SymbolInfo,
    force?: boolean,
    onProgress?: AnalysisProgressCallback
  ): Promise<AnalysisResult> {
    return this._orchestrator.analyzeSymbol(symbol, force, onProgress);
  }

  /** Analyze all symbols in a file. */
  async exploreFile(filePath: string, fileSource: string,
    onProgress?: (stage: string, detail?: string) => void
  ): Promise<number> {
    return this._orchestrator.analyzeFile(filePath, fileSource, onProgress);
  }

  /** Enhance an existing analysis with a follow-up question. */
  async enhance(existingResult: AnalysisResult,
    userPrompt: string
  ): Promise<AnalysisResult> {
    return this._orchestrator.enhanceAnalysis(existingResult, userPrompt);
  }

  /** Clear all cached analyses. */
  async clearCache(): Promise<void> {
    return this._cache.clear();
  }

  /** Read a cached analysis for a symbol. */
  async readCache(symbol: SymbolInfo): Promise<AnalysisResult | null> {
    return this._cache.read(symbol);
  }

  /** Build the full dependency graph from cached analyses. */
  async buildDependencyGraph(): Promise<DependencyGraph> {
    return this._graphBuilder.buildGraph();
  }

  /** Build a focused subgraph around a symbol. */
  async buildSubgraph(symbolName: string,
    filePath: string
  ): Promise<DependencyGraph> {
    return this._graphBuilder.buildSubgraph(symbolName, filePath);
  }

  /** Convert a dependency graph to Mermaid source. */
  toMermaid(graph: DependencyGraph, centerId?: string): string {
    return GraphBuilder.toMermaid(graph, centerId);
  }

  /** Get the LLM provider name. */
  get llmProviderName(): string {
    return this._llmProvider.name;
  }

  /** Dispose resources. */
  dispose(): void {
    this._orchestrator.dispose();
  }
}
```

### 3.5 Updated `extension.ts` (Thin Adapter)

```typescript
// extension.ts — becomes a thin adapter
import { CodeExplorerAPI } from './api/CodeExplorerAPI';
import { VscodeSourceReader } from './providers/VscodeSourceReader';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const api = new CodeExplorerAPI({
    workspaceRoot,
    llmProvider: config.get<string>('llmProvider', 'copilot-cli'),
    sourceReader: new VscodeSourceReader(),  // real VS Code implementation
  });

  // Register commands that delegate to api.*
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, async () => {
      const cursor = gatherCursorContext(editor, workspaceRoot);
      const { symbol, result } = await api.exploreSymbol(cursor);
      viewProvider.openTab(symbol, result);
    }),
    // ...
  );
}
```

### 3.6 CLI Tool

```
src/cli/
  code-explorer-cli.ts        # Entry point, arg parsing
  FileSystemSourceReader.ts   # Reads files via fs, no symbol resolution
  ConsoleLogger.ts            # Logs to stderr
```

**Usage**:

```bash
# Analyze a symbol at a cursor position
npx ts-node src/cli/code-explorer-cli.ts explore-symbol \
  --workspace /path/to/project \
  --file src/main.ts \
  --line 42 \
  --word "processUser" \
  --llm copilot-cli

# Analyze all symbols in a file
npx ts-node src/cli/code-explorer-cli.ts explore-file \
  --workspace /path/to/project \
  --file src/main.ts \
  --llm copilot-cli

# Read cached analysis
npx ts-node src/cli/code-explorer-cli.ts read-cache \
  --workspace /path/to/project \
  --file src/main.ts \
  --symbol processUser \
  --kind function

# Clear cache
npx ts-node src/cli/code-explorer-cli.ts clear-cache \
  --workspace /path/to/project

# Build dependency graph
npx ts-node src/cli/code-explorer-cli.ts dependency-graph \
  --workspace /path/to/project \
  --format mermaid
```

Output is JSON to stdout (machine-parseable) with progress/logs on stderr.

---

## 4. File Plan

### New Files

| File | Purpose |
|------|---------|
| `src/api/CodeExplorerAPI.ts` | Public API class — single entry point for all core operations |
| `src/api/ISourceReader.ts` | Interface abstracting VS-Code-coupled source reading |
| `src/api/ILogger.ts` | Interface abstracting VS-Code-coupled logging |
| `src/api/FileSystemSourceReader.ts` | `ISourceReader` impl that reads files via `fs`, returns `null` for resolution |
| `src/api/ConsoleLogger.ts` | `ILogger` impl that logs to stderr |
| `src/api/NullLogger.ts` | `ILogger` impl that discards all output (for silent tests) |
| `src/providers/VscodeSourceReader.ts` | `ISourceReader` impl wrapping existing `StaticAnalyzer` |
| `src/cli/code-explorer-cli.ts` | CLI entry point |
| `test/unit/api/exploreSymbol.test.ts` | Test scenario 1 |
| `test/unit/api/exploreFile.test.ts` | Test scenario 2 |
| `test/unit/api/enhanceAnalysis.test.ts` | Test scenario 3 |
| `test/unit/api/cacheRoundTrip.test.ts` | Test scenario 4 |
| `test/unit/api/dependencyGraph.test.ts` | Test scenario 5 |
| `test/unit/api/helpers/MockLLMProvider.ts` | Configurable mock LLM that returns canned responses |
| `test/unit/api/helpers/fixtures.ts` | Shared test fixtures (sample source, LLM responses) |

### Modified Files

| File | Change |
|------|--------|
| `src/analysis/AnalysisOrchestrator.ts` | Remove `import * as vscode`; replace `vscode.EventEmitter` with simple callback list; accept `ISourceReader` instead of `StaticAnalyzer`; accept `ILogger` |
| `src/utils/logger.ts` | Implement `ILogger` interface; make `vscode.OutputChannel` optional (lazy-created only when in VS Code context) |
| `src/extension.ts` | Construct `CodeExplorerAPI` + `VscodeSourceReader`; delegate command handlers to API methods |

---

## 5. Five Core Test Scenarios

All tests use Mocha TDD UI (`suite`/`test`), create a temp directory as workspace root, use a `MockLLMProvider`, and require **no VS Code runtime**.

### 5.1 Scenario 1: Explore Symbol (Cursor → Analysis → Cache)

**What it tests**: The full `exploreSymbol()` pipeline — building a `CursorContext`, sending it through the orchestrator with a mock LLM, getting back a parsed `AnalysisResult`, and verifying it was cached to disk.

```typescript
suite('CodeExplorerAPI.exploreSymbol', () => {
  test('analyzes a function from cursor context and caches the result', async () => {
    // Setup: temp workspace with a sample .ts file
    // MockLLMProvider returns a canned response with json:symbol_identity,
    // json:steps, json:subfunctions, json:callers, etc.
    // FileSystemSourceReader reads the real file

    const api = new CodeExplorerAPI({
      workspaceRoot: tmpDir,
      llmProvider: 'none',  // overridden below
      sourceReader: new FileSystemSourceReader(tmpDir),
    });
    // Inject MockLLMProvider

    const cursor: CursorContext = {
      word: 'processUser',
      filePath: 'src/main.ts',
      position: { line: 10, character: 6 },
      surroundingSource: '...source...',
      cursorLine: 'function processUser(user: User): Result {',
    };

    const { symbol, result } = await api.exploreSymbol(cursor);

    // Assert: symbol was identified correctly
    assert.strictEqual(symbol.name, 'processUser');
    assert.strictEqual(symbol.kind, 'function');

    // Assert: analysis result has expected sections
    assert.ok(result.overview.length > 0);
    assert.ok(result.functionSteps && result.functionSteps.length > 0);

    // Assert: result was cached to disk
    const cached = await api.readCache(symbol);
    assert.ok(cached);
    assert.strictEqual(cached!.symbol.name, 'processUser');
  });
});
```

### 5.2 Scenario 2: Explore File (Full File → Multiple Cached Symbols)

**What it tests**: `exploreFile()` sends a file to the LLM, gets back a `json:file_symbol_analyses` block with multiple symbols, and each one is cached individually.

```typescript
suite('CodeExplorerAPI.exploreFile', () => {
  test('analyzes all symbols in a file and caches each one', async () => {
    // Setup: temp workspace with a multi-symbol .ts file
    // MockLLMProvider returns a canned json:file_symbol_analyses with 3 entries

    const cachedCount = await api.exploreFile('src/service.ts', fileSource);

    assert.strictEqual(cachedCount, 3);

    // Verify each symbol is individually retrievable from cache
    const classResult = await api.readCache({
      name: 'UserService', kind: 'class',
      filePath: 'src/service.ts', position: { line: 5, character: 0 },
    });
    assert.ok(classResult);
    assert.strictEqual(classResult!.symbol.kind, 'class');

    const methodResult = await api.readCache({
      name: 'getUser', kind: 'method',
      filePath: 'src/service.ts', position: { line: 15, character: 2 },
      scopeChain: ['UserService'],
    });
    assert.ok(methodResult);
  });
});
```

### 5.3 Scenario 3: Enhance Analysis (Q&A Appended + Cache Updated)

**What it tests**: `enhance()` takes an existing `AnalysisResult`, sends a follow-up question to the LLM, and the returned result has a new `qaHistory` entry appended and the cache file is updated.

```typescript
suite('CodeExplorerAPI.enhance', () => {
  test('appends Q&A entry and updates cache', async () => {
    // Setup: first run exploreSymbol to get an initial result
    const { result: initial } = await api.exploreSymbol(cursor);
    assert.strictEqual((initial.qaHistory || []).length, 0);

    // MockLLMProvider returns a canned enhance response with
    // ### Answer, json:additional_key_points, json:additional_issues

    const enhanced = await api.enhance(initial, 'What happens if user is null?');

    // Assert: Q&A was appended
    assert.strictEqual(enhanced.qaHistory!.length, 1);
    assert.strictEqual(enhanced.qaHistory![0].question, 'What happens if user is null?');
    assert.ok(enhanced.qaHistory![0].answer.length > 0);

    // Assert: additional key points merged
    assert.ok(enhanced.keyMethods!.length > (initial.keyMethods || []).length);

    // Assert: cache was updated with Q&A
    const cached = await api.readCache(enhanced.symbol);
    assert.strictEqual(cached!.qaHistory!.length, 1);
  });
});
```

### 5.4 Scenario 4: Cache Round-Trip (Write → Read → Clear → Read)

**What it tests**: The full cache serialization/deserialization lifecycle — writing an `AnalysisResult`, reading it back with all fields intact, clearing the cache, and confirming it's gone. This exercises `CacheStore` directly through the API.

```typescript
suite('CodeExplorerAPI cache round-trip', () => {
  test('write, read, clear, read-again cycle preserves all fields', async () => {
    // Run analysis to populate cache
    const { symbol, result } = await api.exploreSymbol(cursor);

    // Read back and verify field-by-field
    const cached = await api.readCache(symbol);
    assert.deepStrictEqual(cached!.symbol.name, result.symbol.name);
    assert.deepStrictEqual(cached!.overview, result.overview);
    assert.deepStrictEqual(cached!.functionSteps, result.functionSteps);
    assert.deepStrictEqual(cached!.subFunctions, result.subFunctions);
    assert.deepStrictEqual(cached!.classMembers, result.classMembers);
    assert.deepStrictEqual(cached!.metadata.llmProvider, result.metadata.llmProvider);

    // Clear cache
    await api.clearCache();

    // Verify cache is empty
    const afterClear = await api.readCache(symbol);
    assert.strictEqual(afterClear, null);
  });
});
```

### 5.5 Scenario 5: Dependency Graph (Multiple Cached Symbols → Graph)

**What it tests**: After caching several symbols with sub-function and caller relationships, `buildDependencyGraph()` correctly builds nodes and edges, and `toMermaid()` produces valid Mermaid output.

```typescript
suite('CodeExplorerAPI.buildDependencyGraph', () => {
  test('builds graph with correct nodes and edges from cached analyses', async () => {
    // Setup: cache 3 symbols where:
    //   - processUser calls validateInput and saveUser
    //   - saveUser has a caller entry pointing back to processUser
    await api.exploreSymbol(processUserCursor);
    await api.exploreSymbol(validateInputCursor);
    await api.exploreSymbol(saveUserCursor);

    const graph = await api.buildDependencyGraph();

    // Assert: 3 nodes
    assert.strictEqual(graph.nodes.length, 3);
    assert.ok(graph.nodes.find(n => n.name === 'processUser'));
    assert.ok(graph.nodes.find(n => n.name === 'validateInput'));
    assert.ok(graph.nodes.find(n => n.name === 'saveUser'));

    // Assert: edges exist (processUser → validateInput, processUser → saveUser)
    assert.ok(graph.edges.length >= 2);
    const callsEdges = graph.edges.filter(e => e.type === 'calls');
    assert.ok(callsEdges.length >= 2);

    // Assert: Mermaid output is valid
    const mermaid = api.toMermaid(graph);
    assert.ok(mermaid.startsWith('flowchart TD'));
    assert.ok(mermaid.includes('processUser'));

    // Assert: subgraph works
    const sub = await api.buildSubgraph('processUser', 'src/main.ts');
    assert.ok(sub.nodes.length >= 1);
  });
});
```

### Test Infrastructure: `MockLLMProvider`

```typescript
// test/unit/api/helpers/MockLLMProvider.ts
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

  async isAvailable(): Promise<boolean> { return true; }

  async analyze(request: LLMAnalysisRequest): Promise<string> {
    this.callCount++;
    this.lastPrompt = request.prompt;
    for (const [keyword, response] of this._responses) {
      if (request.prompt.includes(keyword)) return response;
    }
    return this._defaultResponse;
  }

  getCapabilities(): ProviderCapabilities {
    return { maxContextTokens: 128_000, supportsStreaming: false,
             costPerMTokenInput: 0, costPerMTokenOutput: 0 };
  }
}
```

---

## 6. Implementation Order

### Phase 1: Interfaces & Refactoring (No behavior change)

1. Create `src/api/ISourceReader.ts` with the interface.
2. Create `src/api/ILogger.ts` with the interface.
3. Refactor `AnalysisOrchestrator`:
   - Remove `import * as vscode`.
   - Replace `vscode.EventEmitter` with a simple callback pattern.
   - Change constructor: accept `ISourceReader` instead of `StaticAnalyzer`.
   - Accept an optional `ILogger` parameter (defaults to the existing global logger).
4. Refactor `logger.ts` to implement `ILogger`; make `vscode.OutputChannel` lazy/optional so it doesn't crash outside VS Code.
5. Create `src/providers/VscodeSourceReader.ts` — wraps existing `StaticAnalyzer` methods.
6. Update `extension.ts` to construct `VscodeSourceReader` and pass it to the orchestrator.
7. **Verify**: `npm run build` passes, F5 extension debug works identically.

### Phase 2: Public API Class

1. Create `src/api/CodeExplorerAPI.ts` with all methods from section 3.4.
2. Create `src/api/FileSystemSourceReader.ts` — reads files via `fs.readFile`, returns null for symbol resolution, reads ±50 lines for symbol source.
3. Create `src/api/ConsoleLogger.ts` and `src/api/NullLogger.ts`.
4. Update `extension.ts` to construct `CodeExplorerAPI` internally and delegate commands to it.
5. **Verify**: `npm run build` passes, F5 works.

### Phase 3: Test Suite

1. Create `test/unit/api/helpers/MockLLMProvider.ts`.
2. Create `test/unit/api/helpers/fixtures.ts` with canned LLM responses (copy from actual LLM output in `.vscode/code-explorer-logs/llms/`).
3. Implement the 5 test scenarios.
4. Add `npm run test:api` script: `TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/api/**/*.test.ts`.
5. **Verify**: `npm run test:api` passes without VS Code.

### Phase 4: CLI Tool

1. Create `src/cli/code-explorer-cli.ts` with arg parsing.
2. Add `bin` entry to `package.json` or a separate `npm run cli` script.
3. Test manually: `npx ts-node src/cli/code-explorer-cli.ts explore-symbol --workspace . --file src/extension.ts --line 24 --word activate --llm none`.
4. **Verify**: CLI works standalone.

---

## 7. Migration Path for `extension.ts`

The refactoring is backwards-compatible. The migration follows this pattern for each command:

**Before** (direct wiring):
```typescript
vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, async () => {
  const cursor = gatherCursorContext(editor, workspaceRoot);
  await vscode.commands.executeCommand('codeExplorer.sidebar.focus');
  viewProvider.openTabFromCursor(cursorContext);
});
```

**After** (API delegation):
```typescript
vscode.commands.registerCommand(COMMANDS.EXPLORE_SYMBOL, async () => {
  const cursor = gatherCursorContext(editor, workspaceRoot);
  await vscode.commands.executeCommand('codeExplorer.sidebar.focus');
  // API handles orchestration; view provider handles UI
  viewProvider.openTabFromCursor(cursorContext);
  // Under the hood, viewProvider calls api.exploreSymbol(cursor)
});
```

The view provider already delegates to the orchestrator; the API simply wraps it with a cleaner constructor that doesn't require `vscode` imports.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `StaticAnalyzer` methods are used in `analyzeFromCursor` for Tier 1 resolution — removing this breaks the fast path | `ISourceReader.resolveSymbolAtPosition()` returns `null` in the FS implementation; orchestrator already handles the null case and falls through to the LLM |
| `logger` is a module-level singleton used everywhere | Keep it as a singleton but make it implement `ILogger`; add `logger.setTransport(impl)` to swap between VS Code and console backends |
| `CacheStore.findByCursorWithLLMFallback` internally spawns a copilot CLI process for fuzzy matching | This already works without VS Code (uses `runCLI`); the `FileSystemSourceReader` doesn't affect this |
| CLI tool needs to handle the case where copilot/claude CLIs are not installed | `LLMProviderFactory.create('none')` returns `NullProvider`; CLI can also accept `--llm none` for cache-only operations |
| Breaking change to `AnalysisOrchestrator` constructor signature | The old signature `(StaticAnalyzer, LLMProvider, CacheStore, ...)` changes to `(ISourceReader, LLMProvider, CacheStore, ...)`; only one call site (`extension.ts`) needs updating |

---

## 9. Success Criteria

- [ ] `npm run test:api` runs 5 test suites (15+ test cases) with zero VS Code dependency, all passing.
- [ ] `npm run build` still produces a working `.vsix`.
- [ ] F5 debug launch works identically to today.
- [ ] `npx ts-node src/cli/code-explorer-cli.ts read-cache --workspace . --file src/extension.ts --symbol activate --kind function` prints cached analysis JSON (if cache exists) or `null`.
- [ ] `src/api/CodeExplorerAPI.ts` has zero `import * as vscode` statements.
- [ ] `src/analysis/AnalysisOrchestrator.ts` has zero `import * as vscode` statements.
