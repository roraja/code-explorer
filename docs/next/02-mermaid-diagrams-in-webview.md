# Mermaid Diagrams in the Webview Sidebar

## Goal

Render Mermaid diagrams (flowcharts, sequence diagrams, class diagrams, etc.) inside the Code Explorer sidebar webview as part of the LLM analysis results. The LLM would generate Mermaid markup describing call flows, data flows, class relationships, or state machines, and the webview would render them as interactive SVG diagrams.

## Why This Matters

The current analysis view is entirely text-based: lists, badges, collapsible sections. Visual diagrams would dramatically improve comprehension for:
- **Call flows**: how a function orchestrates its sub-functions (sequence diagram)
- **Data flow**: how a variable travels through the pipeline (flowchart)
- **Class relationships**: inheritance, composition, dependency (class diagram)
- **State machines**: lifecycle of a variable or object (state diagram)

Mermaid is the natural choice because LLMs already produce it fluently, it's text-based (easy to cache as markdown), and it's widely adopted.

## Architectural Constraints

Before evaluating options, here are the hard constraints from the current codebase:

1. **CSP (Content Security Policy)**: The webview has a strict CSP (`CodeExplorerViewProvider.ts:486-490`):
   ```
   default-src 'none';
   style-src ${webview.cspSource} 'nonce-${nonce}';
   script-src 'nonce-${nonce}';
   img-src ${webview.cspSource};
   font-src ${webview.cspSource};
   ```
   No `unsafe-eval`, no `unsafe-inline`, no external URLs. Any solution must work within this or justify a minimal, safe relaxation.

2. **Single bundle**: The webview is a single IIFE bundle (`webview/esbuild.config.mjs`) built by esbuild. Any library must be bundleable or loadable within CSP rules.

3. **No framework**: The webview is vanilla TypeScript with innerHTML rendering (`webview/src/main.ts`). No React, no virtual DOM. New rendering logic must follow this pattern.

4. **State flow**: All data comes from the extension host via `postMessage` → `setState`. The webview never fetches data — it only renders what it receives. Mermaid source must flow through this channel.

5. **LLM response pipeline**: Content flows through `LLMProvider.analyze()` → `ResponseParser.parse()` → `CacheStore.write()` → webview. A new `json:mermaid_diagrams` block (or similar) must be added to the prompt template and parsed by `ResponseParser`.

6. **Cache format**: Results are serialized as markdown with YAML frontmatter (`CacheStore.ts`). Mermaid source text must be serializable/deserializable in this format.

---

## Option 1: Bundle Mermaid.js into the Webview (Client-Side Rendering)

### Approach

Include the `mermaid` npm package as a dependency, import it in `webview/src/main.ts`, and call `mermaid.render()` to convert Mermaid markup into SVG at render time inside the webview.

### Pipeline Changes

| Layer | Change |
|-------|--------|
| **Prompt** (`PromptBuilder.ts`) | Add a `### Diagrams` section to the unified prompt requesting Mermaid blocks inside a `json:diagrams` fenced block |
| **Parser** (`ResponseParser.ts`) | Add `_parseDiagrams(raw)` to extract `json:diagrams` block → `DiagramEntry[]` |
| **Types** (`types.ts`) | Add `DiagramEntry { title: string; type: string; mermaidSource: string }` and `diagrams?: DiagramEntry[]` to `AnalysisResult` |
| **Cache** (`CacheStore.ts`) | Serialize/deserialize `diagrams` field (already handles arrays of objects in YAML frontmatter) |
| **Webview** (`main.ts`) | Import `mermaid`, call `mermaid.initialize()` on init, render `<div class="mermaid">` elements, call `mermaid.run()` after innerHTML update |
| **CSP** (`CodeExplorerViewProvider.ts`) | **No change needed** if mermaid is bundled (same nonce script). However, mermaid internally creates `<style>` elements — may need `style-src 'unsafe-inline'` or use mermaid's `securityLevel: 'strict'` + nonce passthrough |
| **CSS** (`main.css`) | Add `.diagram-section`, `.diagram-container` styles using VS Code theme variables |

### Detailed Implementation Plan

#### 1. Install mermaid
```bash
npm install mermaid --save
```

#### 2. Add types (`src/models/types.ts`)
```typescript
export interface DiagramEntry {
  /** Diagram title (e.g., "Call Flow", "Data Flow") */
  title: string;
  /** Mermaid diagram type (flowchart, sequenceDiagram, classDiagram, stateDiagram) */
  type: 'flowchart' | 'sequenceDiagram' | 'classDiagram' | 'stateDiagram' | string;
  /** Raw Mermaid source markup */
  mermaidSource: string;
}
```

Add to `AnalysisResult`:
```typescript
diagrams?: DiagramEntry[];
```

#### 3. Update prompt (`PromptBuilder.ts` — `buildUnified()`)
Add after the "Potential Issues" section:
```
### Diagrams
Generate 1-2 Mermaid diagrams that best visualize this symbol's behavior.

For functions/methods: a flowchart or sequence diagram showing the call flow.
For classes/structs: a class diagram showing relationships.
For variables: a flowchart showing the data flow lifecycle.

Output a machine-readable JSON block:
\`\`\`json:diagrams
[
  {
    "title": "Call Flow",
    "type": "flowchart",
    "mermaidSource": "flowchart TD\n  A[Start] --> B{Check input}\n  B -->|valid| C[Process]\n  B -->|invalid| D[Return error]"
  }
]
\`\`\`
```

#### 4. Parse diagrams (`ResponseParser.ts`)
Add `_parseDiagrams()` static method following the exact same pattern as `_parseDataFlow()`:
```typescript
private static _parseDiagrams(raw: string): DiagramEntry[] {
  const match = raw.match(/```json:diagrams\s*\n([\s\S]*?)\n\s*```/);
  if (!match) return [];
  try {
    const entries = JSON.parse(match[1]);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(e => typeof e === 'object' && e !== null)
      .filter(e => typeof e.title === 'string' && typeof e.mermaidSource === 'string')
      .map(e => ({
        title: e.title,
        type: typeof e.type === 'string' ? e.type : 'flowchart',
        mermaidSource: e.mermaidSource,
      }));
  } catch { return []; }
}
```

Wire into `parse()` method:
```typescript
const diagrams = this._parseDiagrams(raw);
// ...
return { ..., diagrams: diagrams.length > 0 ? diagrams : undefined };
```

#### 5. Render in webview (`webview/src/main.ts`)
```typescript
import mermaid from 'mermaid';

// In init():
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark', // or detect from VS Code theme
  securityLevel: 'strict',
  fontFamily: 'var(--vscode-font-family)',
});

// In renderAnalysis():
if (a.diagrams && a.diagrams.length > 0) {
  for (const d of a.diagrams) {
    const containerId = `mermaid-${tabId}-${Math.random().toString(36).slice(2, 8)}`;
    sections.push(renderSection(d.title,
      `<div class="diagram-container" id="${containerId}">${esc(d.mermaidSource)}</div>`
    ));
  }
}

// After innerHTML update in render():
await mermaid.run({ querySelector: '.diagram-container' });
```

#### 6. CSP considerations
Mermaid.js renders SVG inline. With `securityLevel: 'strict'`, it avoids `eval()`. However, it injects `<style>` tags for styling the SVG. Options:
- **Option A**: Add `style-src 'unsafe-inline'` to the CSP (minimal security risk for a local-only webview)
- **Option B**: Use mermaid's `suppressErrorRendering` + extract SVG and inline styles via a post-processing step
- **Option C**: Use mermaid's newer API that accepts a nonce for style elements (mermaid v10.6+ supports `{ securityLevel: 'strict', suppressErrorRendering: true }`)

### Pros
- **Full fidelity**: All Mermaid features available (themes, interactions, tooltips)
- **Offline**: No network dependency — everything bundled
- **Ecosystem**: Mermaid is battle-tested, 70k+ GitHub stars, actively maintained
- **Theme integration**: Mermaid supports custom themes, can match VS Code dark/light
- **Interactive**: Pan, zoom, click-on-node could be wired to symbol exploration

### Cons
- **Bundle size**: Mermaid is ~2.5 MB minified (includes D3, dagre, DOMPurify). The current webview bundle is likely <50 KB. This is a 50x increase.
- **CSP friction**: Mermaid injects inline styles — requires CSP relaxation or workaround
- **Render performance**: Mermaid parsing is CPU-intensive; complex diagrams in a sidebar panel could cause jank
- **Maintenance**: Mermaid major version upgrades sometimes break APIs

### Risk Assessment
| Risk | Severity | Mitigation |
|------|----------|------------|
| Bundle size bloat | Medium | Tree-shake, lazy-load mermaid only when diagrams exist |
| CSP violation | High | Test with `securityLevel: 'strict'`; if style injection still blocked, use Option A (add `'unsafe-inline'` for style-src only) |
| Render jank | Low | Render diagrams async after main content; use `requestIdleCallback` |
| LLM produces invalid Mermaid | Medium | Wrap in try/catch, show raw source as fallback code block |

### Estimated Effort
- **Types + Parser + Prompt**: 2-3 hours
- **Webview mermaid integration + CSP**: 4-6 hours (CSP debugging is unpredictable)
- **CSS theming**: 1-2 hours
- **Testing + edge cases**: 2-3 hours
- **Total**: ~1.5-2 days

---

## Option 2: Extension-Side SVG Pre-Rendering (Server-Side Rendering)

### Approach

Render Mermaid → SVG on the **extension host side** (Node.js) using `mermaid-cli` (`@mermaid-js/mermaid-cli`) or the `mermaid` package with `jsdom`/`puppeteer`. Send the resulting SVG string to the webview as a pre-rendered `<svg>` element. The webview simply injects the SVG into the DOM — no Mermaid library in the webview bundle at all.

### Pipeline Changes

| Layer | Change |
|-------|--------|
| **Prompt** (`PromptBuilder.ts`) | Same as Option 1 — request `json:diagrams` block |
| **Parser** (`ResponseParser.ts`) | Same as Option 1 — extract `DiagramEntry[]` |
| **Types** (`types.ts`) | Add `DiagramEntry` with `mermaidSource` and `renderedSvg?: string` |
| **New service** (`src/diagrams/MermaidRenderer.ts`) | New module: takes Mermaid source → returns SVG string. Uses `@mermaid-js/mermaid-cli` or headless Chromium |
| **Orchestrator** (`AnalysisOrchestrator.ts`) | After parsing, call `MermaidRenderer.render()` for each diagram, attach SVG to result |
| **Cache** (`CacheStore.ts`) | Store both `mermaidSource` (for re-rendering) and `renderedSvg` (for instant display) |
| **Webview** (`main.ts`) | Inject pre-rendered SVG via innerHTML. Zero JS library needed. |
| **CSP** | **No change** — SVG is inline markup, no scripts, no styles beyond what's already allowed |

### Detailed Implementation Plan

#### 1. Install dependencies
```bash
npm install @mermaid-js/mermaid-cli --save-dev  # or as a runtime dep
# OR use the mermaid package + jsdom for in-process rendering:
npm install mermaid jsdom --save
```

#### 2. Create MermaidRenderer service (`src/diagrams/MermaidRenderer.ts`)

**Option A — CLI-based** (spawn `mmdc`):
```typescript
import { runCLI } from '../utils/cli';

export class MermaidRenderer {
  async render(mermaidSource: string, theme: 'dark' | 'light' = 'dark'): Promise<string> {
    // Write mermaid source to temp file, run mmdc, read SVG output
    const tmpInput = path.join(os.tmpdir(), `ce-mermaid-${Date.now()}.mmd`);
    const tmpOutput = tmpInput.replace('.mmd', '.svg');
    await fs.writeFile(tmpInput, mermaidSource);
    await runCLI('mmdc', ['-i', tmpInput, '-o', tmpOutput, '-t', theme], {});
    const svg = await fs.readFile(tmpOutput, 'utf-8');
    await fs.unlink(tmpInput).catch(() => {});
    await fs.unlink(tmpOutput).catch(() => {});
    return svg;
  }
}
```

**Option B — In-process with jsdom** (avoids CLI spawn):
```typescript
import mermaid from 'mermaid';
import { JSDOM } from 'jsdom';

export class MermaidRenderer {
  async render(mermaidSource: string): Promise<string> {
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    // Use mermaid's renderString API with virtual DOM
    const { svg } = await mermaid.render('diagram', mermaidSource);
    return svg;
  }
}
```

#### 3. Wire into orchestrator (`AnalysisOrchestrator.ts`)
After `ResponseParser.parse()`, before `CacheStore.write()`:
```typescript
if (result.diagrams && result.diagrams.length > 0) {
  for (const diagram of result.diagrams) {
    try {
      diagram.renderedSvg = await this._mermaidRenderer.render(diagram.mermaidSource);
    } catch (err) {
      logger.warn(`Failed to render diagram "${diagram.title}": ${err}`);
      // Leave renderedSvg undefined — webview will show fallback
    }
  }
}
```

#### 4. Render in webview (`webview/src/main.ts`)
```typescript
if (a.diagrams && a.diagrams.length > 0) {
  for (const d of a.diagrams) {
    const content = d.renderedSvg
      ? `<div class="diagram-container diagram-container--svg">${d.renderedSvg}</div>`
      : `<pre class="diagram-container diagram-container--source"><code>${esc(d.mermaidSource)}</code></pre>`;
    sections.push(renderSection(d.title, content));
  }
}
```

No mermaid import, no async rendering, no CSP issues.

### Pros
- **Zero webview bundle impact**: No mermaid library in the browser bundle — stays lightweight
- **No CSP changes**: SVG is just markup; fits current CSP perfectly
- **Instant render**: SVG is pre-computed — no render delay when switching tabs
- **Cache-friendly**: SVG stored alongside source in cache — subsequent loads are instant
- **Theme control**: Can re-render with different theme on theme change (extension-side)

### Cons
- **Heavy extension-side dependency**: `@mermaid-js/mermaid-cli` bundles Chromium (~300 MB). In-process mermaid+jsdom is lighter but still ~10 MB and fragile.
- **Render latency**: SVG rendering adds 1-5 seconds to the analysis pipeline (Chromium cold start for CLI approach, or jsdom setup)
- **Node.js compatibility**: Mermaid was designed for browsers. Running it in Node.js requires jsdom or puppeteer hacks — this is notoriously brittle and breaks across mermaid versions.
- **Extension size**: The `.vsix` package would balloon from ~1 MB to potentially 300+ MB with mermaid-cli, or ~15 MB with mermaid+jsdom
- **SVG staleness**: If the user changes VS Code theme, cached SVGs have wrong colors. Need re-render or CSS-variable-based SVG theming.

### Risk Assessment
| Risk | Severity | Mitigation |
|------|----------|------------|
| Chromium dependency size | Critical | Use mermaid+jsdom instead of mermaid-cli |
| jsdom+mermaid breakage | High | Pin exact versions; integration tests; fallback to raw source on failure |
| Render latency | Medium | Render async after initial result display; show placeholder then swap in SVG |
| Extension size | High | Make mermaid rendering optional (`codeExplorer.diagrams.enabled` setting) |
| Theme mismatch | Low | Use CSS variables in SVG; or re-render on theme change event |

### Estimated Effort
- **MermaidRenderer service**: 4-6 hours (jsdom approach; CLI approach simpler but heavier)
- **Types + Parser + Prompt**: 2-3 hours (same as Option 1)
- **Orchestrator wiring**: 1-2 hours
- **Webview SVG injection**: 1-2 hours
- **Cache serialization for SVG**: 1-2 hours
- **Testing + jsdom debugging**: 4-6 hours (jsdom compatibility is painful)
- **Total**: ~2.5-3 days

---

## Option 3: Hybrid — Lazy-Load Mermaid via a Separate Webview Script

### Approach

Keep the main webview bundle lightweight. When the analysis result contains diagrams, dynamically load a separate `mermaid-renderer.js` bundle (pre-built from the mermaid package) as an additional `<script>` tag. This combines the benefits of client-side rendering (full fidelity, interactive) with minimal impact on the base bundle.

### Pipeline Changes

| Layer | Change |
|-------|--------|
| **Prompt** (`PromptBuilder.ts`) | Same as Options 1 and 2 — request `json:diagrams` block |
| **Parser** (`ResponseParser.ts`) | Same — extract `DiagramEntry[]` |
| **Types** (`types.ts`) | Same `DiagramEntry` type |
| **Build** (`webview/esbuild.config.mjs`) | Add second entry point: `webview/src/mermaid-renderer.ts` → `webview/dist/mermaid-renderer.js` |
| **New file** (`webview/src/mermaid-renderer.ts`) | Imports mermaid, exposes `renderDiagram(id, source)` on `window`, initializes mermaid with VS Code theme detection |
| **Webview** (`main.ts`) | When diagrams exist: (1) inject placeholder `<div>` elements, (2) post `loadMermaid` message to extension |
| **ViewProvider** (`CodeExplorerViewProvider.ts`) | On `loadMermaid` message: inject `<script nonce="${nonce}" src="${mermaidRendererUri}">` into webview HTML (or pre-include it with `defer`) |
| **CSP** | Add `style-src 'unsafe-inline'` (same as Option 1) OR use mermaid's nonce support |
| **CSS** | Same diagram container styles |

### Detailed Implementation Plan

#### 1. Create mermaid renderer entry point (`webview/src/mermaid-renderer.ts`)
```typescript
import mermaid from 'mermaid';

// Detect VS Code theme
const isDark = document.body.classList.contains('vscode-dark') ||
  getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#0') ||
  getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#1') ||
  getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim().startsWith('#2');

mermaid.initialize({
  startOnLoad: false,
  theme: isDark ? 'dark' : 'default',
  securityLevel: 'strict',
});

// Expose render function globally for main.ts to call
(window as any).__ceMermaidRender = async (containerId: string, source: string) => {
  try {
    const { svg } = await mermaid.render(`mermaid-${containerId}`, source);
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = svg;
  } catch (err) {
    const el = document.getElementById(containerId);
    if (el) {
      el.innerHTML = `<pre class="diagram-error"><code>${source}</code></pre>`;
      el.classList.add('diagram-container--error');
    }
  }
};

// Signal that mermaid is loaded
window.dispatchEvent(new CustomEvent('ce-mermaid-ready'));
```

#### 2. Add esbuild entry point (`webview/esbuild.config.mjs`)
```javascript
const config = {
  entryPoints: [
    'webview/src/main.ts',
    'webview/src/mermaid-renderer.ts',  // <-- new
  ],
  // ... rest unchanged
};
```

#### 3. Include script in HTML (`CodeExplorerViewProvider.ts`)
```typescript
const mermaidScriptUri = webview.asWebviewUri(
  vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist', 'mermaid-renderer.js')
);

// Add to HTML template (with defer so it loads after main.js):
// <script defer nonce="${nonce}" src="${mermaidScriptUri}"></script>
```

#### 4. Render diagrams in main.ts
```typescript
// In renderAnalysis():
if (a.diagrams && a.diagrams.length > 0) {
  for (const d of a.diagrams) {
    const cid = `diagram-${Math.random().toString(36).slice(2, 8)}`;
    sections.push(renderSection(d.title,
      `<div class="diagram-container diagram-container--loading" id="${cid}" data-mermaid-source="${esc(d.mermaidSource)}">
        <div class="diagram-loading">Rendering diagram...</div>
      </div>`
    ));
  }
}

// After render():
function renderDiagrams(): void {
  const containers = document.querySelectorAll('.diagram-container[data-mermaid-source]');
  if (containers.length === 0) return;

  const render = (window as any).__ceMermaidRender;
  if (typeof render === 'function') {
    containers.forEach(el => {
      const source = el.getAttribute('data-mermaid-source');
      if (source) render(el.id, source);
    });
  } else {
    // Mermaid not loaded yet — wait for it
    window.addEventListener('ce-mermaid-ready', () => {
      const r = (window as any).__ceMermaidRender;
      containers.forEach(el => {
        const source = el.getAttribute('data-mermaid-source');
        if (source && r) r(el.id, source);
      });
    }, { once: true });
  }
}
```

### Pros
- **Small base bundle**: `main.js` stays lightweight (~50 KB). Mermaid renderer only loads if diagrams exist.
- **Full fidelity**: Same rendering quality as Option 1
- **Progressive enhancement**: Analysis content renders instantly; diagrams appear moments later
- **No extension-side complexity**: No jsdom, no Chromium, no temp files
- **CSP-compatible with nonce**: Both scripts share the same nonce — no `unsafe-eval` needed

### Cons
- **Two bundles to maintain**: Separate entry point, separate build artifact, versioning concerns
- **CSP style-src issue**: Same as Option 1 — mermaid injects `<style>` tags
- **Bundle still ships**: Even with lazy loading, `mermaid-renderer.js` (~2.5 MB) is part of the `.vsix` package
- **Global function coupling**: `window.__ceMermaidRender` is an awkward bridge between two bundles
- **Theme detection fragility**: Detecting dark/light theme from CSS variables is heuristic-based

### Risk Assessment
| Risk | Severity | Mitigation |
|------|----------|------------|
| CSP style injection | High | Same as Option 1: test `securityLevel: 'strict'`, fallback to `'unsafe-inline'` for style-src |
| Two-bundle coordination | Medium | Integration test that verifies diagram rendering end-to-end |
| Extension package size | Medium | Mermaid is ~2.5 MB; acceptable for a rich extension. Could gzip or use CDN (but CDN breaks offline). |
| Theme detection | Low | Use `window.matchMedia('(prefers-color-scheme: dark)')` + VS Code body class |

### Estimated Effort
- **Types + Parser + Prompt**: 2-3 hours (same as all options)
- **Mermaid renderer entry point**: 2-3 hours
- **Esbuild config + CSP updates**: 2-3 hours
- **Main.ts lazy rendering**: 2-3 hours
- **CSS + theming**: 1-2 hours
- **Testing + CSP debugging**: 3-4 hours
- **Total**: ~2-2.5 days

---

## Comparison Matrix

| Criterion | Option 1: Bundle Mermaid | Option 2: Server-Side SVG | Option 3: Lazy-Load Split |
|-----------|-------------------------|---------------------------|---------------------------|
| **Webview bundle size** | +2.5 MB (large) | +0 (no change) | +0 base, +2.5 MB lazy |
| **Extension package size** | +2.5 MB | +10-300 MB | +2.5 MB |
| **CSP changes needed** | `style-src 'unsafe-inline'` | None | `style-src 'unsafe-inline'` |
| **Render quality** | Full (interactive SVG) | Full (static SVG) | Full (interactive SVG) |
| **Render latency** | ~100ms client-side | 1-5s server-side | ~100ms client-side (after load) |
| **Initial load impact** | Slower (parse 2.5 MB) | None | None (deferred) |
| **Offline support** | Yes | Yes | Yes |
| **Theme reactivity** | Instant (re-render) | Requires re-render from extension | Instant (re-render) |
| **Node.js compat risk** | None (browser-only) | High (jsdom fragility) | None (browser-only) |
| **Implementation complexity** | Low | High | Medium |
| **Maintenance burden** | Low | High (jsdom breakage) | Medium (two bundles) |
| **Estimated effort** | 1.5-2 days | 2.5-3 days | 2-2.5 days |

---

## Recommendation

**Option 1 (Bundle Mermaid) is the recommended approach**, with Option 3 as the upgrade path if bundle size becomes a concern.

### Rationale

1. **Simplicity**: Option 1 is the simplest to implement and maintain. One bundle, one build, one codebase. The webview already bundles all its dependencies as an IIFE — adding mermaid follows the established pattern.

2. **CSP is manageable**: The `style-src 'unsafe-inline'` addition is the only CSP change. This is a local-only webview with no external content — the security risk is negligible. Mermaid v10.6+ also supports nonce-based style injection which may eliminate the need entirely.

3. **Bundle size is acceptable**: 2.5 MB for mermaid is meaningful but not disqualifying. VS Code extensions like GitLens, GitHub Copilot, and Jupyter all ship multi-MB webview bundles. Users don't directly experience the bundle size — only the parse/init time, which is <200ms on modern hardware.

4. **Server-side (Option 2) is too risky**: The jsdom + mermaid combination is notoriously fragile. Mermaid relies heavily on browser APIs (getBBox, getComputedStyle, etc.) that jsdom doesn't fully implement. This creates a constant maintenance burden and version-pinning treadmill. The Chromium-based CLI approach is simpler but adds 300 MB to the extension — unacceptable.

5. **Option 3 is premature optimization**: The split-bundle approach adds complexity (global function bridge, two build outputs, lazy-load coordination) to save ~200ms of initial parse time. If profiling later shows the mermaid bundle is a bottleneck, migrating from Option 1 → Option 3 is straightforward (extract mermaid code to a new entry point).

### Implementation Order

1. **Phase 1 — Plumbing** (no mermaid yet): Add `DiagramEntry` type, `_parseDiagrams()` parser, prompt section, cache serialization. Render raw mermaid source as a `<pre><code>` block in the webview. This validates the full pipeline without any library dependency.

2. **Phase 2 — Mermaid rendering**: Install mermaid, integrate into webview init, replace `<pre>` fallback with rendered SVG. Debug CSP issues.

3. **Phase 3 — Polish**: Theme integration (dark/light auto-detection), error handling for invalid mermaid, collapsible diagram sections, optional zoom/pan, `codeExplorer.diagrams.enabled` setting.

### Files to Touch

| File | Change |
|------|--------|
| `src/models/types.ts` | Add `DiagramEntry` interface, add `diagrams?` to `AnalysisResult` |
| `src/llm/PromptBuilder.ts` | Add `### Diagrams` section to `buildUnified()` and kind-specific strategies |
| `src/llm/ResponseParser.ts` | Add `_parseDiagrams()`, wire into `parse()` |
| `src/cache/CacheStore.ts` | Serialize/deserialize `diagrams` field |
| `webview/src/main.ts` | Import mermaid, initialize, render diagram sections, call `mermaid.run()` |
| `webview/src/styles/main.css` | Add `.diagram-container`, `.diagram-loading`, `.diagram-error` styles |
| `src/ui/CodeExplorerViewProvider.ts` | Update CSP if needed (`style-src` change) |
| `package.json` | Add `mermaid` dependency |
| `webview/esbuild.config.mjs` | No change (mermaid bundles fine with esbuild) |

### Open Questions

1. **Which diagram types to request?** Start with flowcharts and sequence diagrams — LLMs produce these most reliably. Class diagrams and state diagrams can be added later.
2. **How many diagrams per symbol?** Cap at 2 in the prompt to avoid LLM token waste and sidebar clutter.
3. **Should diagrams be optional?** Yes — add `codeExplorer.diagrams.enabled` (default: `true`) so users can disable if they prefer text-only or want faster analysis.
4. **Interactive diagrams?** Mermaid supports click handlers. Could wire node clicks to `exploreSymbol` messages for click-to-navigate. This is a Phase 3 enhancement.
