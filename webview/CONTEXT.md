# webview/

Browser-side code for the Code Explorer sidebar panel. This is a **separate TypeScript project** from the extension host — it cannot import from `src/`.

## Build

- **Entry**: `webview/src/main.ts`
- **tsconfig**: `webview/tsconfig.json` (module: ES2022)
- **esbuild**: `webview/esbuild.config.mjs` -> `webview/dist/main.js` + `main.css`
- **Platform**: Browser only (DOM, `acquireVsCodeApi()`)

## Architecture

The webview is a **pure renderer**. It never owns state. All state is pushed from the extension via `postMessage`:

```
Extension ──setState──> Webview (re-renders)
Webview ──tabClicked/tabClosed/enhanceAnalysis/...──> Extension (processes, pushes new state)
```

### State Persistence

Uses `vscode.setState()` / `vscode.getState()` to persist tabs across webview re-creation (e.g., when the sidebar is hidden and shown again).

## Files

| File | Role |
|------|------|
| `src/main.ts` | All rendering logic, event listeners, state management, mermaid initialization, auto-linking, enhance dialog. Vanilla TypeScript, no framework. |
| `src/styles/main.css` | All CSS using VS Code theme variables. No hardcoded colors. Includes diagram, enhance dialog, and Q&A styles. |

## Key Libraries

- **mermaid** (^11.13.0) — Renders LLM-generated diagrams as interactive SVGs. Initialized with VS Code theme-aware dark/light mode detection.

## Rendering Pipeline

`render()` is called on every `setState` message:

1. **Empty state**: Shows "Click on a symbol..." instructions
2. **Has tabs**: Renders tab bar + active tab content
3. **Loading tab**: Spinner with granular stage label (cache-check, reading-source, llm-analyzing, writing-cache)
4. **Error tab**: Error message + retry button
5. **Ready tab**: Full analysis content with collapsible `<details>` sections
6. **Post-render**: `renderMermaidDiagrams()` renders any diagram placeholder divs asynchronously

### Analysis Sections Rendered

| Section | Data Source | Interactive |
|---------|-----------|-------------|
| Symbol header + LLM badge | `metadata.llmProvider` | Breadcrumb clickable (navigate to source) |
| ✨ Enhance button | — | Opens Q&A dialog |
| Overview | `analysis.overview` | Auto-linked symbols, mermaid rendering |
| Data Kind | `analysis.dataKind` | Auto-linked text |
| Step-by-Step Breakdown | `analysis.functionSteps` | Auto-linked descriptions |
| Sub-Functions | `analysis.subFunctions` | Click to explore, file links, auto-linked text |
| Function Input | `analysis.functionInputs` | Type links, auto-linked descriptions |
| Function Output | `analysis.functionOutput` | Type links, auto-linked text |
| Class Members | `analysis.classMembers` | Member names clickable (navigate to line), auto-linked types |
| Member Access Patterns | `analysis.memberAccess` | Member and method names are explore links |
| Variable Lifecycle | `analysis.variableLifecycle` | Auto-linked text |
| Data Flow | `analysis.dataFlow` | File links clickable, auto-linked descriptions |
| Key Points | `analysis.keyMethods` | Auto-linked text |
| Call Stacks | `analysis.callStacks` | Click to explore callers, file links |
| Relationships | `analysis.relationships` | Target names are explore links, file links |
| Dependencies | `analysis.dependencies` | Auto-linked text |
| Usage Pattern | `analysis.usagePattern` | Auto-linked text |
| Potential Issues | `analysis.potentialIssues` | Auto-linked text |
| Diagrams | `analysis.diagrams` | Rendered as interactive SVGs via mermaid |
| Q&A History | `analysis.qaHistory` | Mermaid + code blocks rendered, auto-linked text |
| Timestamp | `metadata.analyzedAt` | No |

### Auto-Linking Infrastructure

Symbol names found in free-text analysis content are automatically converted to clickable `<a class="symbol-link">` links:

- **`_buildKnownSymbols(analysis)`** — Builds a dictionary of known symbols from sub-functions, callers, class members, relationships, function input/output types, related symbols
- **`_autoLinkSymbols(escapedText, knownSymbols)`** — Scans escaped text for known symbol names and wraps them in explore links. Uses word-boundary matching to avoid partial matches. Sorts by name length descending for longest-first matching.
- **`_escAndLink(text, knownSymbols)`** — Convenience: escape then auto-link.
- **`_symbolExploreLink(name, filePath?, line?, kind?)`** — Creates a single clickable symbol link from known data.

### Mermaid Rendering

- **`_isDarkTheme()`** — Detects VS Code dark theme via body class
- **`_renderMarkdownWithMermaid(text, knownSymbols)`** — Splits text on ```` ```mermaid ```` and ```` ``` ```` fences, renders mermaid blocks as diagram placeholders, code blocks as `<pre><code>`, and plain text with auto-linking
- **`renderMermaidDiagrams()`** — Called after DOM update, finds all `.diagram-container[data-mermaid-source]` elements and renders them via `mermaid.render()`. Falls back to raw source on error.

### Enhance Dialog

- **`_showEnhanceDialog(tabId)`** — Creates a modal overlay with textarea, Send/Cancel buttons
- **Keyboard shortcuts**: Ctrl+Enter to submit, Escape to close
- **On submit**: Posts `enhanceAnalysis` message to extension with `tabId` and `userPrompt`

## Do NOT

- Import anything from `src/` (separate TypeScript project, different runtime)
- Use Node.js APIs (`fs`, `path`, `child_process`)
- Use `require()` — this is an ES module
- Use hardcoded CSS colors — use `var(--vscode-*)` theme variables
- Use React/Vue/any framework — keep bundle small, vanilla TS only
