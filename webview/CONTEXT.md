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
Webview ──tabClicked/tabClosed/...──> Extension (processes, pushes new state)
```

### State Persistence

Uses `vscode.setState()` / `vscode.getState()` to persist tabs across webview re-creation (e.g., when the sidebar is hidden and shown again).

## Files

| File | Role |
|------|------|
| `src/main.ts` | All rendering logic, event listeners, state management. Vanilla TypeScript, no framework. |
| `src/styles/main.css` | All CSS using VS Code theme variables. No hardcoded colors. |

## Rendering Pipeline

`render()` is called on every `setState` message:

1. **Empty state**: Shows "Click on a symbol..." instructions
2. **Has tabs**: Renders tab bar + active tab content
3. **Loading tab**: Spinner with granular stage label (cache-check, reading-source, llm-analyzing, writing-cache)
4. **Error tab**: Error message + retry button
5. **Ready tab**: Full analysis content with collapsible `<details>` sections

### Analysis Sections Rendered

| Section | Data Source | Interactive |
|---------|-----------|-------------|
| Symbol header + LLM badge | `metadata.llmProvider` | No |
| Overview | `analysis.overview` | No |
| Step-by-Step Breakdown | `analysis.functionSteps` | No |
| Sub-Functions | `analysis.subFunctions` | Yes (click to explore) |
| Function Input | `analysis.functionInputs` | Yes (type links) |
| Function Output | `analysis.functionOutput` | Yes (type links) |
| Key Points | `analysis.keyMethods` | No |
| Usages | `analysis.usages` | Yes (click to navigate) |
| Call Stacks | `analysis.callStacks` | Yes (click to explore) |
| Relationships | `analysis.relationships` | No |
| Dependencies | `analysis.dependencies` | No |
| Usage Pattern | `analysis.usagePattern` | No |
| Potential Issues | `analysis.potentialIssues` | No |

### Symbol Linking

Clickable symbol links (sub-functions, callers, types) send `exploreSymbol` messages to the extension, which resolves the symbol and opens a new tab. Uses `data-symbol-*` attributes on `<a class="symbol-link">` elements.

## Do NOT

- Import anything from `src/` (separate TypeScript project, different runtime)
- Use Node.js APIs (`fs`, `path`, `child_process`)
- Use `require()` — this is an ES module
- Use hardcoded CSS colors — use `var(--vscode-*)` theme variables
- Use inline scripts — CSP enforced
- Use React/Vue/any framework — keep bundle small, vanilla TS only
