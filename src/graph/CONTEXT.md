# src/graph/

Dependency graph builder — scans cached analyses and constructs a graph of symbol relationships. Renders as Mermaid flowcharts in the webview sidebar.

## Modules

| File | Role |
|------|------|
| `GraphBuilder.ts` | Scans all `.md` cache files, parses YAML frontmatter + JSON blocks, builds `GraphNode[]` + `GraphEdge[]`, converts to Mermaid source. |

## How It Works

The `GraphBuilder` reads **only cached data** — no LLM calls. It recursively scans `.vscode/code-explorer/` for markdown files and extracts:
- Symbol identity from YAML frontmatter (`symbol`, `kind`, `file`, `line`, `scope_chain`)
- Callers from `json:callers` blocks
- Sub-functions from `json:subfunctions` blocks
- Dependencies from `## Dependencies` section (bullet list)
- Relationships from analysis (extends, implements, uses)

### Data Flow

```
GraphBuilder.buildGraph()
  → _scanAllCacheFiles()
    → _scanDirectory() (recursive)
      → _parseAnalysisFile() per .md file
        → _parseFrontmatter() → symbol identity
        → _parseJsonBlock('callers') → caller data
        → _parseJsonBlock('subfunctions') → sub-function data
  → Phase 1: Build nodes (one per cached symbol, deduped by ID)
  → Phase 2: Build edges from relationships
    → Sub-functions → 'calls' edges
    → Callers → 'calls' edges (reverse)
    → Dependencies → 'dependsOn' edges (name matching)
    → Relationships → 'extends' / 'implements' / 'uses' edges
  → Deduplicate edges by key
  → Return DependencyGraph { nodes, edges, builtAt }
```

## Key Types

```typescript
interface GraphNode {
  id: string;              // "filePath::scope.kind.name"
  name: string;
  kind: SymbolKindType;
  filePath: string;
  line: number;
  overview: string;        // First sentence of overview
  callerCount: number;
  subFunctionCount: number;
}

interface GraphEdge {
  from: string;            // Source node ID
  to: string;              // Target node ID
  type: 'calls' | 'dependsOn' | 'extends' | 'implements' | 'uses';
  label?: string;
}

interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  builtAt: string;
}
```

## Key Methods

| Method | Description |
|--------|-------------|
| `buildGraph()` | Build full dependency graph from all cached analyses |
| `buildSubgraph(symbolName, filePath)` | Build focused subgraph centered on a symbol (1 hop out, plus edges between neighbors) |
| `static toMermaid(graph, centerId?)` | Convert graph to Mermaid flowchart source with kind-based styling and center node highlighting |

## Mermaid Rendering

`toMermaid()` generates a `flowchart TD` with:
- **Node shapes**: Classes/structs/interfaces use `["label"]`, others use `("label")`
- **Style classes**: `classNode` (blue), `fnNode`/`methodNode` (green), `varNode` (brown), `ifaceNode` (purple), `centerNode` (orange, thick border)
- **Edge styles**: `-->` (calls), `-.->` (dependsOn), `===>` (extends), `-..->` (implements)
- **Labels**: Edge type shown as `|type|` label (except for `calls` which is unlabeled)

## Usage

```typescript
// In extension.ts
const graphBuilder = new GraphBuilder(workspaceRoot);

// Full graph
const graph = await graphBuilder.buildGraph();
const mermaid = GraphBuilder.toMermaid(graph);

// Focused subgraph centered on a symbol
const subgraph = await graphBuilder.buildSubgraph('analyzeSymbol', 'src/analysis/Orchestrator.ts');
const mermaid = GraphBuilder.toMermaid(subgraph, centerId);

// Via CodeExplorerAPI
const graph = await api.buildDependencyGraph();
const mermaid = api.toMermaid(graph, centerId);
```

## VS Code Integration

Registered as `codeExplorer.showDependencyGraph` command. The command:
1. Gets the cursor symbol (if any) to center the graph
2. Builds subgraph (or full graph as fallback)
3. Converts to Mermaid
4. Sends to webview via `viewProvider.showDependencyGraph()`
