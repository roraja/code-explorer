# Code Explorer — High-Level Design & Architecture

> **Version:** 1.0
> **Date:** 2026-03-28
> **Status:** Draft

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Component Architecture](#2-component-architecture)
3. [Data Flow Diagrams](#3-data-flow-diagrams)
4. [Directory Structure](#4-directory-structure)
5. [Technology Choices](#5-technology-choices)
6. [Scalability Considerations](#6-scalability-considerations)
7. [Security Considerations](#7-security-considerations)
8. [Integration Points](#8-integration-points)
9. [Deployment Architecture](#9-deployment-architecture)

---

## 1. Architecture Overview

### 1.1 System Context Diagram

```mermaid
graph TB
    subgraph "VS Code Editor"
        DEV[Developer]
        EDITOR[Active Editor]
        SIDEBAR[Code Explorer Sidebar]
    end

    subgraph "Code Explorer Extension"
        UI[UI Layer]
        INTERACT[Interaction Layer]
        ANALYSIS[Analysis Engine]
        CACHE[Cache Layer]
        LLM_LAYER[LLM Integration Layer]
        MCP_LAYER[MCP Server Layer]
    end

    subgraph "External"
        TS_LS[TypeScript Language Service]
        MAI_CLAUDE[mai-claude CLI]
        COPILOT_CLI[Copilot CLI]
        MCP_CLIENT[MCP Clients / AI Agents]
        FS[File System / Workspace]
    end

    DEV -->|click/hover| EDITOR
    EDITOR -->|symbol events| INTERACT
    INTERACT -->|resolved symbol| UI
    UI -->|display| SIDEBAR
    INTERACT -->|analyze request| ANALYSIS
    ANALYSIS -->|cache check| CACHE
    ANALYSIS -->|deep analysis| LLM_LAYER
    ANALYSIS -->|static analysis| TS_LS
    CACHE -->|read/write| FS
    LLM_LAYER -->|prompt| MAI_CLAUDE
    LLM_LAYER -->|prompt| COPILOT_CLI
    MCP_CLIENT -->|query| MCP_LAYER
    MCP_LAYER -->|read| CACHE

    style DEV fill:#e1f5fe
    style SIDEBAR fill:#e1f5fe
    style ANALYSIS fill:#fff3e0
    style CACHE fill:#e8f5e9
    style LLM_LAYER fill:#fce4ec
```

### 1.2 Layered Architecture

```mermaid
graph TB
    subgraph "Layer 1: Presentation"
        WV[Webview UI<br/>HTML/CSS/JS]
        HP[Hover Provider]
        CL[CodeLens Provider]
        DEC[Decoration Provider]
    end

    subgraph "Layer 2: Interaction"
        CMD[Command Handlers]
        EVT[Event Listeners]
        MSG[Message Broker]
        SYM_RES[Symbol Resolver]
    end

    subgraph "Layer 3: Business Logic"
        ORCH[Analysis Orchestrator]
        STATIC[Static Analyzer]
        LLM_A[LLM Analyzer]
        QUEUE[Analysis Queue]
        SCHED[Background Scheduler]
    end

    subgraph "Layer 4: Data Access"
        CACHE_MGR[Cache Manager]
        INDEX_MGR[Index Manager]
        HASH_SVC[Hash Service]
        SERIALIZER[MD Serializer]
    end

    subgraph "Layer 5: External Integration"
        LLM_PROV[LLM Providers]
        TS_SVC[TS Language Service]
        VSCODE_API[VS Code API]
        FILE_IO[File I/O]
    end

    WV --> MSG
    HP --> SYM_RES
    CL --> SYM_RES
    CMD --> ORCH
    EVT --> SYM_RES
    MSG --> ORCH
    SYM_RES --> VSCODE_API
    ORCH --> STATIC
    ORCH --> LLM_A
    ORCH --> CACHE_MGR
    ORCH --> QUEUE
    SCHED --> QUEUE
    STATIC --> TS_SVC
    LLM_A --> LLM_PROV
    CACHE_MGR --> INDEX_MGR
    CACHE_MGR --> HASH_SVC
    CACHE_MGR --> SERIALIZER
    SERIALIZER --> FILE_IO

    style WV fill:#bbdefb
    style ORCH fill:#fff9c4
    style CACHE_MGR fill:#c8e6c9
    style LLM_PROV fill:#f8bbd0
```

---

## 2. Component Architecture

### 2.1 UI Layer

```mermaid
classDiagram
    class CodeExplorerViewProvider {
        -_view: WebviewView
        -_tabs: Map~string, TabState~
        -_activeTabId: string
        +resolveWebviewView()
        +openTab(symbol: SymbolInfo)
        +closeTab(tabId: string)
        +focusTab(tabId: string)
        -_handleMessage(msg)
        -_postMessage(msg)
        -_getHtmlForWebview(): string
    }

    class WebviewApp {
        -tabBar: TabBar
        -detailPanel: DetailPanel
        -state: ExplorerState
        +init()
        +handleMessage(msg)
        +render()
    }

    class TabBar {
        -tabs: TabState[]
        -activeTabId: string
        +addTab(tab)
        +removeTab(tabId)
        +setActive(tabId)
        +render(): HTMLElement
    }

    class DetailPanel {
        -sections: Section[]
        +showAnalysis(data)
        +showLoading()
        +showError(msg)
        +render(): HTMLElement
    }

    class Section {
        <<abstract>>
        -title: string
        -collapsed: boolean
        +toggle()
        +render(): HTMLElement
    }

    class OverviewSection
    class CallStackSection
    class UsageSection
    class DataFlowSection
    class RelationshipSection

    CodeExplorerViewProvider --> WebviewApp : creates
    WebviewApp --> TabBar
    WebviewApp --> DetailPanel
    DetailPanel --> Section
    Section <|-- OverviewSection
    Section <|-- CallStackSection
    Section <|-- UsageSection
    Section <|-- DataFlowSection
    Section <|-- RelationshipSection
```

**Responsibilities:**

| Component | Responsibility |
|-----------|---------------|
| `CodeExplorerViewProvider` | VS Code WebviewView lifecycle, message routing between extension host and webview |
| `WebviewApp` | Webview-side application root, state management, rendering |
| `TabBar` | Tab creation, switching, closing, overflow scrolling |
| `DetailPanel` | Renders analysis content with collapsible sections |
| `Section` subclasses | Specialized rendering for each analysis section (call stacks as trees, usage as file lists, data flow as timelines) |

### 2.2 Interaction Layer

```mermaid
classDiagram
    class SymbolResolver {
        +resolveAtPosition(doc, pos): SymbolInfo
        -_findSymbolAtPosition(symbols, pos)
        -_mapSymbolKind(kind): SymbolKindType
    }

    class CodeExplorerHoverProvider {
        +provideHover(doc, pos): Hover
        -_buildHoverContent(symbol, cached)
    }

    class EditorEventHandler {
        +onSelectionChange(event)
        +onDocumentSave(event)
        +onDocumentChange(event)
    }

    class CommandHandler {
        +exploreSymbol(symbol)
        +refreshAnalysis()
        +clearCache()
        +analyzeWorkspace()
    }

    EditorEventHandler --> SymbolResolver
    CodeExplorerHoverProvider --> SymbolResolver
    CommandHandler --> AnalysisOrchestrator
```

### 2.3 Analysis Engine

```mermaid
classDiagram
    class AnalysisOrchestrator {
        -_cacheManager: CacheManager
        -_staticAnalyzer: StaticAnalyzer
        -_llmAnalyzer: LLMAnalyzer
        -_queue: AnalysisQueue
        +analyzeSymbol(symbol, opts): AnalysisResult
        +analyzeWorkspace()
        +startPeriodicAnalysis()
        +stopPeriodicAnalysis()
        -_mergeResults(static, llm): AnalysisResult
    }

    class StaticAnalyzer {
        +findReferences(symbol): UsageEntry[]
        +buildCallHierarchy(symbol): CallStackEntry[]
        +getTypeHierarchy(symbol): RelationshipEntry[]
        +getSymbolDetails(symbol): SymbolDetails
    }

    class LLMAnalyzer {
        -_provider: LLMProvider
        -_promptBuilder: PromptBuilder
        -_responseParser: ResponseParser
        +analyzeSymbolDeep(symbol, ctx): LLMResult
        -_gatherContext(symbol): CodeContext
    }

    class AnalysisQueue {
        -_queue: PriorityQueue
        -_activeCount: number
        -_maxConcurrent: number
        +enqueue(analysis): Promise
        -_processNext()
    }

    class BackgroundScheduler {
        -_interval: number
        -_timer: NodeJS.Timer
        +start()
        +stop()
        -_selectTargets(): SymbolInfo[]
    }

    AnalysisOrchestrator --> StaticAnalyzer
    AnalysisOrchestrator --> LLMAnalyzer
    AnalysisOrchestrator --> AnalysisQueue
    AnalysisOrchestrator --> BackgroundScheduler
    AnalysisOrchestrator --> CacheManager
```

**Analysis Flow Decision Tree:**

```mermaid
flowchart TD
    START[analyzeSymbol called] --> CHECK_CACHE{Cache exists?}
    CHECK_CACHE -->|No| RUN_FULL[Run Full Analysis]
    CHECK_CACHE -->|Yes| CHECK_STALE{Is stale?}
    CHECK_STALE -->|No, and not forced| RETURN_CACHED[Return Cached]
    CHECK_STALE -->|Yes, or forced| CHECK_LLM{LLM available?}

    RUN_FULL --> RUN_STATIC[Run Static Analysis]
    RUN_STATIC --> CHECK_LLM

    CHECK_LLM -->|Yes| RUN_LLM[Run LLM Analysis]
    CHECK_LLM -->|No| MERGE_STATIC[Return Static Only]
    RUN_LLM --> MERGE[Merge Static + LLM]
    MERGE --> WRITE_CACHE[Write to Cache]
    WRITE_CACHE --> RETURN_FRESH[Return Fresh Result]
    MERGE_STATIC --> WRITE_CACHE

    style RUN_LLM fill:#f8bbd0
    style RUN_STATIC fill:#e3f2fd
    style WRITE_CACHE fill:#c8e6c9
    style RETURN_CACHED fill:#c8e6c9
```

### 2.4 Cache Layer

```mermaid
classDiagram
    class CacheManager {
        -_indexManager: IndexManager
        -_hashService: HashService
        -_serializer: MarkdownSerializer
        -_workspaceRoot: string
        +get(symbol): AnalysisResult
        +set(symbol, result): void
        +invalidate(filePath): void
        +remove(filePath): void
        +isStale(symbol): boolean
        +clearAll(): void
        +getStats(): CacheStats
    }

    class IndexManager {
        -_index: MasterIndex
        -_indexPath: string
        +load(): void
        +save(): void
        +addEntry(key, entry): void
        +removeEntry(key): void
        +markStale(keys: string[]): void
        +lookup(symbolName, filePath?): IndexEntry
        +rebuild(): void
    }

    class HashService {
        +computeHash(filePath): string
        +computeHashBatch(paths): Map
        -_sha256(content): string
    }

    class MarkdownSerializer {
        +serialize(result: AnalysisResult): string
        +deserialize(markdown: string): AnalysisResult
        -_buildFrontmatter(metadata): string
        -_parseFrontmatter(text): AnalysisMetadata
        -_buildBody(result): string
        -_parseBody(text): Partial~AnalysisResult~
    }

    class CacheKeyResolver {
        +resolveKey(symbol): string
        +resolveFilePath(key): string
        +resolveSymbolFromKey(key): Partial~SymbolInfo~
    }

    CacheManager --> IndexManager
    CacheManager --> HashService
    CacheManager --> MarkdownSerializer
    CacheManager --> CacheKeyResolver
```

### 2.5 LLM Integration Layer

```mermaid
classDiagram
    class LLMProvider {
        <<interface>>
        +name: string
        +isAvailable(): boolean
        +analyze(request): string
        +getCapabilities(): Capabilities
    }

    class MaiClaudeProvider {
        +name = "mai-claude"
        +analyze(request): string
        -_execCLI(args): string
    }

    class CopilotCLIProvider {
        +name = "copilot-cli"
        +analyze(request): string
        -_execCLI(args): string
    }

    class NullProvider {
        +name = "none"
        +isAvailable() = true
        +analyze() throws
    }

    class LLMProviderFactory {
        +create(config): LLMProvider
    }

    class PromptBuilder {
        +classOverview(name, src, related): string
        +functionCallStack(name, src, sites): string
        +variableLifecycle(name, src, refs): string
    }

    class ResponseParser {
        +parse(raw, symbol): Partial~AnalysisResult~
        -_extractSections(md): Map
        -_parseList(text): string[]
    }

    LLMProvider <|.. MaiClaudeProvider
    LLMProvider <|.. CopilotCLIProvider
    LLMProvider <|.. NullProvider
    LLMProviderFactory --> LLMProvider : creates
```

### 2.6 MCP Layer (Future)

```mermaid
classDiagram
    class MCPServer {
        -_cacheManager: CacheManager
        -_transport: Transport
        +start(): void
        +stop(): void
        -_registerTools(): void
        -_registerResources(): void
    }

    class ExploreSymbolTool {
        +name = "explore_symbol"
        +execute(input): AnalysisResult
    }

    class GetCallStacksTool {
        +name = "get_call_stacks"
        +execute(input): CallStackEntry[]
    }

    class SearchSymbolsTool {
        +name = "search_symbols"
        +execute(input): SymbolInfo[]
    }

    MCPServer --> ExploreSymbolTool
    MCPServer --> GetCallStacksTool
    MCPServer --> SearchSymbolsTool
    MCPServer --> CacheManager : reads
```

---

## 3. Data Flow Diagrams

### 3.1 User Click → Analysis → Render

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Editor as VS Code Editor
    participant EVT as Event Handler
    participant SYM as Symbol Resolver
    participant VIEW as Sidebar View
    participant ORCH as Orchestrator
    participant CACHE as Cache Manager
    participant STATIC as Static Analyzer
    participant LLM as LLM Analyzer
    participant FS as File System

    Dev->>Editor: Click on "UserController"
    Editor->>EVT: onSelectionChange
    EVT->>SYM: resolveAtPosition(doc, pos)
    SYM-->>EVT: SymbolInfo{class, UserController}
    EVT->>VIEW: openTab(symbolInfo)

    VIEW->>VIEW: Create tab, show loading
    VIEW->>ORCH: analyzeSymbol(symbolInfo)

    ORCH->>CACHE: get(symbolKey)

    alt Cache Hit (fresh)
        CACHE->>FS: Read markdown file
        FS-->>CACHE: Content
        CACHE-->>ORCH: AnalysisResult
    else Cache Miss or Stale
        ORCH->>STATIC: findReferences + buildCallHierarchy
        STATIC-->>ORCH: StaticResults

        ORCH->>LLM: analyzeSymbolDeep(symbol, context)
        Note right of LLM: Builds prompt with source code<br/>and related files, calls CLI
        LLM-->>ORCH: LLMResult

        ORCH->>ORCH: mergeResults(static, llm)
        ORCH->>CACHE: set(symbolKey, merged)
        CACHE->>FS: Write markdown + update index
    end

    ORCH-->>VIEW: AnalysisResult
    VIEW->>VIEW: Render analysis in tab
    VIEW-->>Dev: Display call stacks, usages, data flow
```

### 3.2 Background Periodic Analysis

```mermaid
sequenceDiagram
    participant TIMER as Scheduler Timer
    participant SCHED as Background Scheduler
    participant INDEX as Index Manager
    participant QUEUE as Analysis Queue
    participant ORCH as Orchestrator
    participant LLM as LLM Provider

    TIMER->>SCHED: tick (every N minutes)
    SCHED->>INDEX: getStaleSymbols()
    INDEX-->>SCHED: staleSymbols[]

    SCHED->>SCHED: prioritize(staleSymbols)
    Note right of SCHED: Recently viewed > frequently accessed > alphabetical

    loop For each symbol (up to batch limit)
        SCHED->>QUEUE: enqueue(analysis, priority=1)
        QUEUE->>ORCH: analyzeSymbol(symbol, force=true)
        ORCH->>LLM: analyze(prompt)
        LLM-->>ORCH: result
        ORCH-->>QUEUE: AnalysisResult
    end

    Note right of SCHED: Respects rate limits,<br/>stops if LLM unavailable
```

### 3.3 Cache Invalidation on File Save

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant FS_WATCH as File Watcher
    participant CACHE as Cache Manager
    participant HASH as Hash Service
    participant INDEX as Index Manager
    participant VIEW as Sidebar View

    DEV->>DEV: Save file (Ctrl+S)
    FS_WATCH->>CACHE: onDidChange(filePath)
    CACHE->>HASH: computeHash(filePath)
    HASH-->>CACHE: newHash

    CACHE->>INDEX: getFileEntry(filePath)
    INDEX-->>CACHE: {oldHash, symbols[]}

    alt Hash Changed
        CACHE->>INDEX: markSymbolsStale(symbols)
        CACHE->>INDEX: updateFileHash(filePath, newHash)
        INDEX->>INDEX: save()

        opt Tab Open for Affected Symbol
            CACHE->>VIEW: stalenessWarning(tabId, changedFiles)
            VIEW->>VIEW: Show "Source changed" banner
        end
    end
```

### 3.4 MCP Query Flow (Future)

```mermaid
sequenceDiagram
    participant AGENT as AI Agent (Claude Code)
    participant MCP as MCP Server
    participant CACHE as Cache Manager
    participant INDEX as Index Manager
    participant FS as File System

    AGENT->>MCP: explore_symbol({name: "UserService"})
    MCP->>INDEX: lookup("UserService")
    INDEX-->>MCP: {cachePath: "src/services/UserService.ts/class.UserService.md"}

    MCP->>CACHE: getByKey(symbolKey)
    CACHE->>FS: Read markdown
    FS-->>CACHE: Content
    CACHE-->>MCP: AnalysisResult

    alt Fresh Data
        MCP-->>AGENT: AnalysisResult
    else Stale Data
        MCP-->>AGENT: AnalysisResult + {stale: true, warning: "..."}
    end
```

---

## 4. Directory Structure

```
code-explorer/
├── .vscode/
│   ├── launch.json             # Debug configurations
│   ├── tasks.json              # Build, test, package tasks
│   └── settings.json           # Workspace settings
│
├── src/                        # Extension source (TypeScript)
│   ├── extension.ts            # Entry point: activate / deactivate
│   │
│   ├── ui/                     # UI Layer
│   │   └── CodeExplorerViewProvider.ts
│   │
│   ├── providers/              # VS Code language feature providers
│   │   ├── CodeExplorerHoverProvider.ts
│   │   ├── CodeExplorerCodeLensProvider.ts
│   │   ├── CodeExplorerDecorationProvider.ts
│   │   └── SymbolResolver.ts
│   │
│   ├── analysis/               # Analysis engine
│   │   ├── AnalysisOrchestrator.ts
│   │   ├── StaticAnalyzer.ts
│   │   ├── LLMAnalyzer.ts
│   │   ├── AnalysisQueue.ts
│   │   └── BackgroundScheduler.ts
│   │
│   ├── cache/                  # Cache management
│   │   ├── CacheManager.ts
│   │   ├── IndexManager.ts
│   │   ├── HashService.ts
│   │   ├── MarkdownSerializer.ts
│   │   └── CacheKeyResolver.ts
│   │
│   ├── llm/                    # LLM integration
│   │   ├── LLMProvider.ts      # Interface
│   │   ├── LLMProviderFactory.ts
│   │   ├── MaiClaudeProvider.ts
│   │   ├── CopilotCLIProvider.ts
│   │   ├── PromptBuilder.ts
│   │   └── ResponseParser.ts
│   │
│   ├── mcp/                    # MCP server (future)
│   │   ├── MCPServer.ts
│   │   ├── tools/
│   │   │   ├── ExploreSymbolTool.ts
│   │   │   ├── GetCallStacksTool.ts
│   │   │   ├── GetUsagesTool.ts
│   │   │   └── SearchSymbolsTool.ts
│   │   └── resources/
│   │       ├── IndexResource.ts
│   │       └── SymbolResource.ts
│   │
│   ├── models/                 # Data models / interfaces
│   │   ├── types.ts            # All TypeScript interfaces
│   │   ├── errors.ts           # Error classes
│   │   └── constants.ts        # Constants
│   │
│   └── utils/                  # Utilities
│       ├── fileUtils.ts
│       ├── hashUtils.ts
│       └── debounce.ts
│
├── webview/                    # Webview UI source
│   ├── src/
│   │   ├── main.ts             # Webview entry point
│   │   ├── components/
│   │   │   ├── TabBar.ts
│   │   │   ├── SymbolHeader.ts
│   │   │   ├── OverviewSection.ts
│   │   │   ├── CallStackSection.ts
│   │   │   ├── UsageSection.ts
│   │   │   ├── DataFlowSection.ts
│   │   │   ├── RelationshipSection.ts
│   │   │   ├── LoadingState.ts
│   │   │   ├── EmptyState.ts
│   │   │   └── ErrorState.ts
│   │   ├── utils/
│   │   │   ├── dom.ts
│   │   │   └── icons.ts
│   │   └── styles/
│   │       └── main.css
│   ├── tsconfig.json
│   └── esbuild.config.mjs
│
├── media/                      # Static assets
│   ├── icon.svg                # Activity bar icon
│   └── icons/                  # Symbol kind icons
│
├── test/                       # Tests
│   ├── unit/
│   │   ├── cache/
│   │   ├── analysis/
│   │   └── llm/
│   ├── integration/
│   │   └── extension.test.ts
│   └── fixtures/               # Test data
│
├── docs/                       # Documentation
│
├── package.json                # Extension manifest
├── tsconfig.json               # TypeScript config
├── esbuild.config.mjs          # Extension bundler config
├── .eslintrc.json
├── .prettierrc
├── .vscodeignore               # VSIX packaging excludes
├── CHANGELOG.md
└── README.md
```

---

## 5. Technology Choices

| Category | Choice | Rationale |
|----------|--------|-----------|
| **Language** | TypeScript | Type safety, VS Code ecosystem native |
| **Extension API** | VS Code Extension API v1.85+ | WebviewView, CallHierarchy, TypeHierarchy APIs |
| **Webview UI** | Vanilla TS + CSS | Minimal bundle size (~20KB vs ~150KB for React), fast load |
| **Bundler** | esbuild | 10-100x faster than webpack, good tree-shaking |
| **Cache format** | Markdown + YAML frontmatter | Human-readable, AI-agent friendly, git-diffable |
| **Index format** | JSON | Fast parsing, O(1) lookups via object keys |
| **Hashing** | SHA-256 (Node.js crypto) | Built-in, no dependencies, collision-resistant |
| **LLM CLI** | mai-claude / copilot CLI | Available in dev environments, no API key management |
| **MCP SDK** | @modelcontextprotocol/sdk | Official MCP TypeScript SDK |
| **Testing** | Mocha + VS Code Test Runner | Standard for VS Code extensions |
| **CI/CD** | GitHub Actions / ADO Pipeline | Extension packaging + marketplace publish |

### Decision: Why Vanilla TS for Webview (Not React)?

| Factor | Vanilla TS | React |
|--------|-----------|-------|
| Bundle size | ~20KB | ~150KB+ |
| Load time | <50ms | ~200ms |
| Dependencies | 0 | react, react-dom |
| VS Code theme integration | Direct CSS variable usage | Requires styled-components or CSS modules |
| Maintenance | More boilerplate | Less boilerplate |
| **Decision** | **✅ Chosen** | Not chosen |

The sidebar must feel instant. The additional bundle size and load time of React is not justified for the relatively simple DOM structure (tab bar + collapsible sections).

### Decision: Why Markdown Cache (Not JSON)?

| Factor | Markdown + YAML FM | JSON |
|--------|-------------------|------|
| Human readability | Excellent | Good |
| AI agent consumption | Excellent (natural language) | Good (structured) |
| Git diff readability | Excellent | Poor for large objects |
| Parsing speed | Moderate | Fast |
| Schema flexibility | High | Rigid |
| **Decision** | **✅ Chosen** | Used for index only |

Markdown files serve double duty: structured data (via frontmatter) and human/AI-readable content (via body). The index.json provides fast lookups while markdown provides rich content.

---

## 6. Scalability Considerations

### 6.1 Workspace Size Tiers

| Tier | Files | Symbols | Strategy |
|------|-------|---------|----------|
| Small | <100 | <500 | Full analysis on activation, keep all in memory |
| Medium | 100-1K | 500-5K | On-demand analysis, index in memory, content lazy-loaded |
| Large | 1K-10K | 5K-50K | On-demand only, index lazy-loaded, pagination in UI |
| Monorepo | 10K+ | 50K+ | Scope to active workspace folder, ignore node_modules aggressively |

### 6.2 Performance Targets

| Operation | Target | Strategy |
|-----------|--------|----------|
| Hover popup | <100ms | Read from memory cache → index lookup → file read |
| Tab open (cached) | <200ms | Index lookup + markdown parse + render |
| Tab open (uncached) | <30s | Static analysis (<2s) + LLM analysis (<25s) + render |
| Background analysis (per symbol) | <30s | Queue with rate limiting |
| Index load | <500ms | JSON parse, lazy for large workspaces |
| File save → staleness check | <50ms | Hash comparison only |

### 6.3 Memory Management

- **Index**: Kept in memory (~1KB per 100 symbols = ~500KB for 50K symbols)
- **Analysis results**: NOT kept in memory; loaded from disk on demand
- **Open tabs**: Only active tabs' data in memory (max ~10 tabs ≈ 1MB)
- **LLM responses**: Streamed to disk, not buffered in memory

### 6.4 Incremental Analysis

```mermaid
flowchart LR
    SAVE[File Saved] --> HASH[Compute Hash]
    HASH --> COMPARE{Hash Changed?}
    COMPARE -->|No| DONE[No Action]
    COMPARE -->|Yes| MARK[Mark Symbols Stale]
    MARK --> DEP[Find Dependent Symbols]
    DEP --> MARK_DEP[Mark Dependents Stale]
    MARK_DEP --> DONE2[Done - Lazy Re-analysis]

    style SAVE fill:#e3f2fd
    style DONE fill:#c8e6c9
    style DONE2 fill:#c8e6c9
```

Only re-analyze when:
1. A stale symbol's tab is opened
2. Background scheduler picks up stale symbols
3. User explicitly clicks "Refresh"

---

## 7. Security Considerations

### 7.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Sensitive code sent to LLM | User opt-in, configurable exclude patterns, local-only providers |
| Secrets in cache files | Cache stores analysis, not raw code; .gitignore the cache directory |
| Webview XSS | Strict CSP (Content Security Policy), no inline scripts |
| Malicious workspace | CSP prevents loading external resources, sandboxed webview |
| LLM prompt injection | System prompt isolation, output sanitization |

### 7.2 Content Security Policy

```
default-src 'none';
style-src ${webview.cspSource} 'nonce-${nonce}';
script-src 'nonce-${nonce}';
img-src ${webview.cspSource};
font-src ${webview.cspSource};
```

### 7.3 .gitignore

The cache directory should be gitignored:

```gitignore
# Code Explorer cache (machine-specific analysis)
.vscode/code-explorer/
```

**Rationale:** Analysis results contain machine-specific file paths, hashes tied to local file state, and potentially sensitive code summaries. They should not be shared across developers.

---

## 8. Integration Points

### 8.1 VS Code Extension API

| API | Usage |
|-----|-------|
| `window.registerWebviewViewProvider` | Sidebar panel |
| `languages.registerHoverProvider` | Hover cards |
| `languages.registerCodeLensProvider` | Inline indicators (optional) |
| `commands.registerCommand` | User commands |
| `workspace.createFileSystemWatcher` | Cache invalidation |
| `commands.executeCommand('vscode.executeReferenceProvider')` | Find references |
| `commands.executeCommand('vscode.prepareCallHierarchy')` | Call hierarchy |
| `commands.executeCommand('vscode.prepareTypeHierarchy')` | Type hierarchy |
| `commands.executeCommand('vscode.executeDocumentSymbolProvider')` | Symbol enumeration |

### 8.2 TypeScript Language Service

Used **indirectly** through VS Code's built-in TypeScript extension, which provides:
- Document symbols (classes, functions, variables)
- References (find all usages)
- Call hierarchy (incoming/outgoing calls)
- Type hierarchy (supertypes/subtypes)
- Go-to-definition

### 8.3 LLM CLI Tools

| Tool | Command | Use Case |
|------|---------|----------|
| mai-claude | `claude --print "<prompt>"` | Deep code analysis |
| Copilot CLI | `github-copilot-cli explain "<prompt>"` | Alternative provider |

### 8.4 MCP Protocol (Future)

- **Transport:** stdio (for CLI clients) or in-process (for VS Code extensions)
- **SDK:** `@modelcontextprotocol/sdk`
- **Capability:** Tools + Resources (no prompts)

---

## 9. Deployment Architecture

### 9.1 Extension Packaging

```mermaid
flowchart LR
    SRC[TypeScript Source] --> BUILD[esbuild]
    WV_SRC[Webview Source] --> WV_BUILD[esbuild]
    BUILD --> DIST[dist/extension.js]
    WV_BUILD --> WV_DIST[webview/dist/main.js + main.css]
    DIST --> VSIX[vsce package]
    WV_DIST --> VSIX
    MEDIA[media/] --> VSIX
    PKG[package.json] --> VSIX
    VSIX --> MARKETPLACE[VS Code Marketplace]
    VSIX --> LOCAL[Local Install]
```

### 9.2 Build Configuration

```jsonc
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build Extension",
      "type": "npm",
      "script": "build",
      "group": { "kind": "build", "isDefault": true }
    },
    {
      "label": "Watch Extension",
      "type": "npm",
      "script": "watch",
      "isBackground": true
    },
    {
      "label": "Build Webview",
      "type": "npm",
      "script": "build:webview"
    },
    {
      "label": "Build All",
      "dependsOn": ["Build Extension", "Build Webview"]
    },
    {
      "label": "Run Tests",
      "type": "npm",
      "script": "test"
    },
    {
      "label": "Package VSIX",
      "type": "npm",
      "script": "package"
    }
  ]
}
```

### 9.3 Debug Configuration

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "runtimeExecutable": "${execPath}",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "Build All"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "runtimeExecutable": "${execPath}",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test"
      ],
      "outFiles": ["${workspaceFolder}/out/test/**/*.js"],
      "preLaunchTask": "Build All"
    }
  ]
}
```

---

*End of High-Level Design & Architecture Document*
