/**
 * Code Explorer — Webview Entry Point
 *
 * Pure renderer. Receives full state from the extension via a single
 * `setState` message and renders it. Never owns or mutates state —
 * all mutations go through messages to the extension, which pushes
 * back the updated state.
 */

import './styles/main.css';
import mermaid from 'mermaid';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage: (_msg: unknown) => {},
  getState: () => null,
  setState: (_state: unknown) => {},
};

interface Tab {
  id: string;
  symbol: { name: string; kind: string; filePath: string; scopeChain?: string[] };
  status: 'loading' | 'ready' | 'error' | 'stale';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis: any;
  error?: string;
  loadingStage?: string;
}

const LOADING_STAGE_LABELS: Record<string, string> = {
  'resolving-symbol': 'Identifying symbol\u2026',
  'cache-check': 'Checking cache\u2026',
  'reading-source': 'Reading source code\u2026',
  'llm-analyzing': 'Running LLM analysis\u2026',
  'writing-cache': 'Saving to cache\u2026',
};

let currentTabs: Tab[] = [];
let currentActiveTabId: string | null = null;
/** Auto-incrementing counter for unique mermaid diagram IDs */
let _mermaidIdCounter = 0;

function log(msg: string): void {
  console.log(`[CE] ${msg}`);
}

/**
 * Detect whether the current VS Code theme is dark.
 */
function _isDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  );
}

function init(): void {
  log('init');

  // Initialize mermaid with VS Code theme-aware settings
  mermaid.initialize({
    startOnLoad: false,
    theme: _isDarkTheme() ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'var(--vscode-font-family)',
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
    themeVariables: _isDarkTheme()
      ? {
          primaryColor: '#264f78',
          primaryTextColor: '#cccccc',
          primaryBorderColor: '#3c3c3c',
          lineColor: '#6a9955',
          secondaryColor: '#1e1e1e',
          tertiaryColor: '#252526',
          background: '#1e1e1e',
          mainBkg: '#264f78',
          nodeBorder: '#3c3c3c',
          clusterBkg: '#252526',
          titleColor: '#cccccc',
          edgeLabelBackground: '#1e1e1e',
        }
      : {},
  });

  // Restore persisted state if available (avoids flash of empty on re-show)
  const saved = vscode.getState() as { tabs: Tab[]; activeTabId: string | null } | null;
  if (saved && saved.tabs) {
    currentTabs = saved.tabs;
    currentActiveTabId = saved.activeTabId;
    log(`restored saved state: ${currentTabs.length} tabs`);
  }

  render();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setState') {
      currentTabs = msg.tabs || [];
      currentActiveTabId = msg.activeTabId;
      log(`setState: ${currentTabs.length} tabs, active=${currentActiveTabId}`);
      // Persist for webview re-creation
      vscode.setState({ tabs: currentTabs, activeTabId: currentActiveTabId });
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
  log('ready sent');
}

// =====================
// Rendering
// =====================

function render(): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  if (currentTabs.length === 0) {
    root.innerHTML = renderEmpty();
    return;
  }

  const activeTab = currentTabs.find((t) => t.id === currentActiveTabId) || currentTabs[0];

  root.innerHTML = renderTabBar() + renderContent(activeTab);
  attachListeners();
  renderMermaidDiagrams();
}

function renderEmpty(): string {
  return `<div class="empty-state">
    <div class="empty-state__icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
      </svg>
    </div>
    <h2 class="empty-state__title">Code Explorer</h2>
    <p class="empty-state__description">
      Place your cursor on any symbol and press<br>
      <kbd>Ctrl+Shift+H</kbd><br>
      <span class="empty-state__hint">or right-click &rarr; Explore Symbol</span>
    </p>
    <div class="empty-state__features">
      <div class="empty-state__feature">
        <span class="empty-state__feature-icon">ƒ</span>
        <span>Functions &amp; Methods</span>
      </div>
      <div class="empty-state__feature">
        <span class="empty-state__feature-icon">🅲</span>
        <span>Classes &amp; Structs</span>
      </div>
      <div class="empty-state__feature">
        <span class="empty-state__feature-icon">𝑥</span>
        <span>Variables &amp; Properties</span>
      </div>
    </div>
  </div>`;
}

function renderTabBar(): string {
  const tabs = currentTabs
    .map((tab) => {
      const active = tab.id === currentActiveTabId ? ' tab--active' : '';
      const icon = kindIcon(tab.symbol.kind);
      const statusDot =
        tab.status === 'loading'
          ? '<span class="tab__status tab__status--loading">⟳</span>'
          : tab.status === 'error'
            ? '<span class="tab__status tab__status--error">✕</span>'
            : '';
      // Show scope context in tab label for nested symbols (e.g., "getUser › result")
      const scope =
        tab.symbol.scopeChain && tab.symbol.scopeChain.length > 0
          ? tab.symbol.scopeChain[tab.symbol.scopeChain.length - 1] + ' › '
          : '';
      return `<div class="tab${active}" data-tab-id="${tab.id}">
        <span class="tab__icon">${icon}</span>
        <span class="tab__label" title="${esc((tab.symbol.scopeChain || []).concat(tab.symbol.name).join('.'))}">${esc(scope)}${esc(tab.symbol.name)}</span>
        ${statusDot}
        <span class="tab__close" data-close-id="${tab.id}">×</span>
      </div>`;
    })
    .join('');

  return `<div class="tab-bar">${tabs}</div>`;
}

function renderContent(tab: Tab): string {
  if (tab.status === 'loading') {
    const stageLabel = tab.loadingStage
      ? LOADING_STAGE_LABELS[tab.loadingStage] || tab.loadingStage
      : 'Starting\u2026';
    return `<div class="loading-state">
      <div class="loading-state__spinner"></div>
      <div class="loading-state__text">Analyzing ${esc(tab.symbol.kind)} ${esc(tab.symbol.name)}</div>
      <div class="loading-state__stage">${esc(stageLabel)}</div>
    </div>`;
  }

  if (tab.status === 'error') {
    return `<div class="error-state">
      <div class="error-state__icon">⚠</div>
      <div class="error-state__message">${esc(tab.error || 'Unknown error')}</div>
      <button class="error-state__retry" data-retry-id="${tab.id}">Retry</button>
    </div>`;
  }

  if (!tab.analysis) {
    return '<div class="loading-state"><div class="loading-state__text">No data</div></div>';
  }

  return renderAnalysis(tab);
}

// =====================
// Auto-Linking Infrastructure
// =====================

/**
 * Represents a known symbol extracted from the analysis data.
 * Used for auto-linking symbol names found in free-text content.
 */
interface KnownSymbol {
  name: string;
  filePath?: string;
  line?: number;
  kind?: string;
}

/**
 * Build a dictionary of known symbol names from the analysis data.
 * These are symbols we can auto-link when they appear in free-text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _buildKnownSymbols(analysis: any): KnownSymbol[] {
  const symbols: KnownSymbol[] = [];
  const seen = new Set<string>();

  const add = (s: KnownSymbol): void => {
    // Avoid duplicates and very short names (likely false positives like "i", "x")
    if (!s.name || s.name.length < 3 || seen.has(s.name)) {
      return;
    }
    seen.add(s.name);
    symbols.push(s);
  };

  // Sub-functions
  if (analysis.subFunctions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const sf of analysis.subFunctions as any[]) {
      add({ name: sf.name, filePath: sf.filePath, line: sf.line, kind: sf.kind || 'function' });
    }
  }

  // Function inputs — parameter type names
  if (analysis.functionInputs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of analysis.functionInputs as any[]) {
      if (p.typeFilePath) {
        add({
          name: p.typeName,
          filePath: p.typeFilePath,
          line: p.typeLine,
          kind: p.typeKind || 'type',
        });
      }
    }
  }

  // Function output — return type name
  if (analysis.functionOutput?.typeFilePath) {
    const out = analysis.functionOutput;
    add({
      name: out.typeName,
      filePath: out.typeFilePath,
      line: out.typeLine,
      kind: out.typeKind || 'type',
    });
  }

  // Call stack callers
  if (analysis.callStacks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cs of analysis.callStacks as any[]) {
      if (cs.caller) {
        add({
          name: cs.caller.name,
          filePath: cs.caller.filePath,
          line: cs.caller.line,
          kind: cs.caller.kind || 'function',
        });
      }
    }
  }

  // Relationships targets
  if (analysis.relationships) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of analysis.relationships as any[]) {
      add({ name: r.targetName, filePath: r.targetFilePath, line: r.targetLine, kind: 'unknown' });
    }
  }

  // Related symbols (pre-cached)
  if (analysis.relatedSymbols) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const rs of analysis.relatedSymbols as any[]) {
      add({ name: rs.name, filePath: rs.filePath, line: rs.line, kind: rs.kind || 'unknown' });
    }
  }

  // Class members — the member names themselves (within the current file)
  if (analysis.classMembers && analysis.symbol?.filePath) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of analysis.classMembers as any[]) {
      if (m.line) {
        add({
          name: m.name,
          filePath: analysis.symbol.filePath,
          line: m.line,
          kind: m.memberKind === 'method' ? 'method' : 'property',
        });
      }
    }
  }

  // Sort by name length descending so longer names match first (avoids partial matches)
  symbols.sort((a, b) => b.name.length - a.name.length);

  return symbols;
}

/**
 * Auto-link known symbol names found in free-text content.
 * Scans `escapedText` for occurrences of known symbol names and wraps them
 * in `<a class="symbol-link">` tags that trigger `exploreSymbol`.
 *
 * The text must already be HTML-escaped before calling this.
 */
function _autoLinkSymbols(escapedText: string, knownSymbols: KnownSymbol[]): string {
  if (!escapedText || knownSymbols.length === 0) {
    return escapedText;
  }

  // Track which ranges have been replaced to avoid overlapping matches
  const replacements: { start: number; end: number; html: string }[] = [];

  for (const sym of knownSymbols) {
    const escapedName = esc(sym.name);
    if (!escapedName) {
      continue;
    }

    // Match the escaped name surrounded by non-identifier characters (word boundary)
    const pattern = new RegExp(
      `(?<![a-zA-Z0-9_])${escapedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_(])`,
      'g'
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(escapedText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Check this range doesn't overlap with any existing replacement
      const overlaps = replacements.some(
        (r) => (start >= r.start && start < r.end) || (end > r.start && end <= r.end)
      );
      if (overlaps) {
        continue;
      }

      const linkAttrs = sym.filePath
        ? ` data-symbol-name="${esc(sym.name)}" data-symbol-file="${esc(sym.filePath)}" data-symbol-line="${sym.line || 0}" data-symbol-kind="${esc(sym.kind || 'function')}"`
        : ` data-symbol-name="${esc(sym.name)}" data-symbol-kind="${esc(sym.kind || 'function')}"`;

      const linkHtml = `<a class="symbol-link" href="#"${linkAttrs}>${escapedName}</a>`;
      replacements.push({ start, end, html: linkHtml });
    }
  }

  if (replacements.length === 0) {
    return escapedText;
  }

  // Apply replacements in reverse order so indices remain valid
  replacements.sort((a, b) => b.start - a.start);
  let result = escapedText;
  for (const r of replacements) {
    result = result.substring(0, r.start) + r.html + result.substring(r.end);
  }

  return result;
}

/**
 * Escape text and then auto-link any known symbol names found within it.
 */
function _escAndLink(text: string, knownSymbols: KnownSymbol[]): string {
  return _autoLinkSymbols(esc(text), knownSymbols);
}

/**
 * Render markdown-like text that may contain ```mermaid fenced blocks.
 *
 * Splits the text on ```mermaid ... ``` boundaries. Non-mermaid parts
 * are escaped + auto-linked as normal. Mermaid parts are emitted as
 * `<div class="diagram-container" data-mermaid-source="...">` placeholders
 * that `renderMermaidDiagrams()` will pick up after the DOM update.
 *
 * Also handles generic ``` code blocks (non-mermaid) by rendering them
 * as styled `<pre><code>` blocks.
 */
function _renderMarkdownWithMermaid(text: string, knownSymbols: KnownSymbol[]): string {
  if (!text) {
    return '';
  }

  // Regex matches ```mermaid\n...\n``` and generic ```lang\n...\n``` blocks
  const fencedBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencedBlockRegex.exec(text)) !== null) {
    // Add the text before this fenced block (escaped + auto-linked)
    if (match.index > lastIndex) {
      const before = text.substring(lastIndex, match.index);
      parts.push(_renderPlainMarkdown(_escAndLink(before, knownSymbols)));
    }

    const lang = match[1].toLowerCase();
    const content = match[2];

    if (lang === 'mermaid') {
      // Emit a mermaid diagram placeholder
      const diagramId = `mermaid-inline-${++_mermaidIdCounter}`;
      parts.push(
        `<div class="diagram-container" id="${diagramId}" data-mermaid-source="${escAttr(content.trim())}">` +
          `<div class="diagram-loading">Rendering diagram\u2026</div>` +
          `</div>`
      );
    } else {
      // Render as a styled code block
      const langLabel = lang ? ` data-lang="${esc(lang)}"` : '';
      parts.push(`<pre class="qa-code-block"${langLabel}><code>${esc(content)}</code></pre>`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text after the last fenced block
  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    parts.push(_renderPlainMarkdown(_escAndLink(remaining, knownSymbols)));
  }

  return parts.join('');
}

/**
 * Minimal markdown-to-HTML for already-escaped text.
 * Converts line breaks to <br> for readability in Q&A answers.
 */
function _renderPlainMarkdown(escapedHtml: string): string {
  return escapedHtml.replace(/\n/g, '<br>');
}

/**
 * Render a symbol name as a clickable explore link (for structured data
 * where we know the symbol info directly, not via text scanning).
 */
function _symbolExploreLink(name: string, filePath?: string, line?: number, kind?: string): string {
  const linkAttrs = filePath
    ? ` data-symbol-name="${esc(name)}" data-symbol-file="${esc(filePath)}" data-symbol-line="${line || 0}" data-symbol-kind="${esc(kind || 'function')}"`
    : ` data-symbol-name="${esc(name)}" data-symbol-kind="${esc(kind || 'function')}"`;
  return `<a class="symbol-link" href="#"${linkAttrs}>${esc(name)}</a>`;
}

function renderAnalysis(tab: Tab): string {
  const a = tab.analysis;
  const sections: string[] = [];

  // Build the known symbols dictionary for auto-linking free text
  const ks = _buildKnownSymbols(a);

  // Header with file breadcrumb (clickable — navigates to the symbol's position)
  const fileBreadcrumb = tab.symbol.filePath
    ? `<a class="symbol-header__breadcrumb file-link" href="#" data-file="${esc(tab.symbol.filePath)}" data-line="${tab.symbol.kind !== 'unknown' && tab.analysis?.symbol?.position ? tab.analysis.symbol.position.line + 1 : 1}" data-char="0" title="${esc(tab.symbol.filePath)}">${esc(shortPath(tab.symbol.filePath))}</a>`
    : '';
  sections.push(`<div class="symbol-header">
    <div class="symbol-header__main">
      <span class="symbol-header__icon">${kindIcon(tab.symbol.kind)}</span>
      <span class="symbol-header__kind">${esc(tab.symbol.kind)}</span>
      <span class="symbol-header__name">${esc(tab.symbol.name)}</span>
    </div>
    ${fileBreadcrumb}
  </div>`);

  // Enhance button
  sections.push(`<div class="enhance-bar">
    <button class="enhance-bar__button" data-tab-id="${tab.id}">
      <span class="enhance-bar__icon">✨</span>
      <span class="enhance-bar__label">Enhance</span>
    </button>
  </div>`);

  // LLM badge
  if (a.metadata?.llmProvider) {
    sections.push(
      `<div class="badge badge--llm">✨ Analyzed with ${esc(a.metadata.llmProvider)}</div>`
    );
  } else {
    sections.push('<div class="badge badge--static">📊 Static analysis only</div>');
  }

  // Overview
  if (a.overview) {
    sections.push(
      renderSection(
        'Overview',
        `<p class="overview-text">${_renderMarkdownWithMermaid(a.overview, ks)}</p>`
      )
    );
  }

  // Data Kind (for variables — what kind of data this variable holds)
  if (a.dataKind && a.dataKind.label) {
    const dk = a.dataKind;
    const parts: string[] = [];
    parts.push(`<div class="data-kind-item">`);
    parts.push(
      `<div class="data-kind-item__label"><span class="badge badge--data-kind">📦 ${esc(dk.label)}</span></div>`
    );
    if (dk.description) {
      parts.push(`<div class="data-kind-item__desc">${_escAndLink(dk.description, ks)}</div>`);
    }
    if (dk.examples && dk.examples.length > 0) {
      parts.push(`<div class="data-kind-item__section-label">Examples:</div>`);
      parts.push(`<ul class="data-kind-item__list">`);
      for (const ex of dk.examples) {
        parts.push(`<li><code>${esc(ex)}</code></li>`);
      }
      parts.push(`</ul>`);
    }
    if (dk.references && dk.references.length > 0) {
      parts.push(`<div class="data-kind-item__section-label">References:</div>`);
      parts.push(`<ul class="data-kind-item__list">`);
      for (const ref of dk.references) {
        parts.push(`<li>${_escAndLink(ref, ks)}</li>`);
      }
      parts.push(`</ul>`);
    }
    parts.push(`</div>`);
    sections.push(renderSection('Data Kind', parts.join('')));
  }

  // Step-by-Step Breakdown (numbered functionalities)
  if (a.functionSteps && a.functionSteps.length > 0) {
    const items = a.functionSteps
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) =>
          `<li class="step-item"><span class="step-item__number">${s.step}.</span> ${_escAndLink(s.description, ks)}</li>`
      )
      .join('');
    sections.push(renderSection('Step-by-Step Breakdown', `<ol class="step-list">${items}</ol>`));
  }

  // Sub-Functions
  if (a.subFunctions && a.subFunctions.length > 0) {
    const items = a.subFunctions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((sf: any) => {
        const linkAttrs = sf.filePath
          ? ` data-symbol-name="${esc(sf.name)}" data-symbol-file="${esc(sf.filePath)}" data-symbol-line="${sf.line || 0}" data-symbol-kind="${esc(sf.kind || 'function')}"`
          : '';
        const nameHtml = sf.filePath
          ? `<a class="symbol-link" href="#"${linkAttrs}>${esc(sf.name)}</a>`
          : `<strong>${esc(sf.name)}</strong>`;
        return `<div class="subfunction-item">
        <div class="subfunction-item__header">${nameHtml}</div>
        <div class="subfunction-item__desc">${_escAndLink(sf.description, ks)}</div>
        <div class="subfunction-item__io">
          <span class="subfunction-item__label">Input:</span> <span>${_escAndLink(sf.input, ks)}</span>
        </div>
        <div class="subfunction-item__io">
          <span class="subfunction-item__label">Output:</span> <span>${_escAndLink(sf.output, ks)}</span>
        </div>
        ${sf.filePath ? `<a class="subfunction-item__file file-link" href="#" data-file="${esc(sf.filePath)}" data-line="${sf.line || 1}" data-char="0">${esc(shortPath(sf.filePath))}${sf.line ? ':' + sf.line : ''}</a>` : ''}
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Sub-Functions (${a.subFunctions.length})`,
        `<div class="subfunction-list">${items}</div>`
      )
    );
  }

  // Function Input
  if (a.functionInputs && a.functionInputs.length > 0) {
    const items = a.functionInputs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => {
        const typeLinkAttrs = p.typeFilePath
          ? ` data-symbol-name="${esc(p.typeName)}" data-symbol-file="${esc(p.typeFilePath)}" data-symbol-line="${p.typeLine || 0}" data-symbol-kind="${esc(p.typeKind || 'type')}"`
          : '';
        const typeHtml = p.typeFilePath
          ? `<a class="symbol-link" href="#"${typeLinkAttrs}>${esc(p.typeName)}</a>`
          : `<code>${esc(p.typeName)}</code>`;
        const mutatedBadge = p.mutated
          ? `<span class="badge badge--mutated" title="${esc(p.mutationDetail || 'Mutates this parameter')}">⚡ mutated</span>`
          : '<span class="badge badge--readonly">readonly</span>';
        return `<div class="fn-param-item">
        <div class="fn-param-item__header">
          <span class="fn-param-item__name">${esc(p.name)}</span>
          <span class="fn-param-item__type">${typeHtml}</span>
          ${mutatedBadge}
        </div>
        <div class="fn-param-item__desc">${_escAndLink(p.description, ks)}</div>
        ${p.mutated && p.mutationDetail ? `<div class="fn-param-item__mutation">⚡ ${_escAndLink(p.mutationDetail, ks)}</div>` : ''}
        ${p.typeOverview ? `<div class="fn-param-item__type-overview">${_escAndLink(p.typeOverview, ks)}</div>` : ''}
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Function Input (${a.functionInputs.length})`,
        `<div class="fn-param-list">${items}</div>`
      )
    );
  }

  // Function Output
  if (a.functionOutput && a.functionOutput.typeName) {
    const out = a.functionOutput;
    const typeLinkAttrs = out.typeFilePath
      ? ` data-symbol-name="${esc(out.typeName)}" data-symbol-file="${esc(out.typeFilePath)}" data-symbol-line="${out.typeLine || 0}" data-symbol-kind="${esc(out.typeKind || 'type')}"`
      : '';
    const typeHtml = out.typeFilePath
      ? `<a class="symbol-link" href="#"${typeLinkAttrs}>${esc(out.typeName)}</a>`
      : `<code>${esc(out.typeName)}</code>`;
    const content = `<div class="fn-output-item">
      <div class="fn-output-item__header">
        <span class="fn-output-item__label">Returns:</span>
        <span class="fn-output-item__type">${typeHtml}</span>
      </div>
      <div class="fn-output-item__desc">${_escAndLink(out.description, ks)}</div>
      ${out.typeOverview ? `<div class="fn-output-item__type-overview">${_escAndLink(out.typeOverview, ks)}</div>` : ''}
    </div>`;
    sections.push(renderSection('Function Output', content));
  }

  // Class Members
  if (a.classMembers && a.classMembers.length > 0) {
    const items = a.classMembers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => {
        const staticBadge = m.isStatic
          ? '<span class="badge badge--static-member">static</span>'
          : '';
        const visBadge = `<span class="badge badge--visibility badge--vis-${esc(m.visibility || 'public')}">${esc(m.visibility || 'public')}</span>`;
        // Member name is clickable — navigates to its line in the source file
        const memberNameHtml =
          m.line && tab.symbol.filePath
            ? `<a class="symbol-link" href="#" data-symbol-name="${esc(m.name)}" data-symbol-file="${esc(tab.symbol.filePath)}" data-symbol-line="${m.line}" data-symbol-kind="${esc(m.memberKind === 'method' ? 'method' : 'property')}">${esc(m.name)}</a>`
            : `<span>${esc(m.name)}</span>`;
        // Type name is auto-linked if it matches a known symbol
        const typeHtml = m.typeName ? _escAndLink(m.typeName, ks) : '';
        return `<div class="class-member-item">
        <div class="class-member-item__header">
          <span class="class-member-item__kind">${memberKindIcon(m.memberKind)}</span>
          <span class="class-member-item__name">${memberNameHtml}</span>
          <code class="class-member-item__type">${typeHtml}</code>
          ${visBadge}${staticBadge}
        </div>
        <div class="class-member-item__desc">${_escAndLink(m.description || '', ks)}</div>
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Class Members (${a.classMembers.length})`,
        `<div class="class-member-list">${items}</div>`
      )
    );
  }

  // Member Access Patterns
  if (a.memberAccess && a.memberAccess.length > 0) {
    const items = a.memberAccess
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((ma: any) => {
        const externalBadge = ma.externalAccess
          ? '<span class="badge badge--external">external</span>'
          : '';
        // Render readBy and writtenBy as individual symbol links
        const readersHtml =
          (ma.readBy || []).length > 0
            ? (ma.readBy as string[])
                .map((r: string) => _symbolExploreLink(r, tab.symbol.filePath, undefined, 'method'))
                .join(', ')
            : 'none';
        const writersHtml =
          (ma.writtenBy || []).length > 0
            ? (ma.writtenBy as string[])
                .map((w: string) => _symbolExploreLink(w, tab.symbol.filePath, undefined, 'method'))
                .join(', ')
            : 'none';
        // Member name itself is an explore link
        const memberNameHtml = _symbolExploreLink(
          ma.memberName,
          tab.symbol.filePath,
          undefined,
          'property'
        );
        return `<div class="member-access-item">
        <div class="member-access-item__header">
          <strong>${memberNameHtml}</strong> ${externalBadge}
        </div>
        <div class="member-access-item__row">
          <span class="member-access-item__label">Read by:</span> <span>${readersHtml}</span>
        </div>
        <div class="member-access-item__row">
          <span class="member-access-item__label">Written by:</span> <span>${writersHtml}</span>
        </div>
      </div>`;
      })
      .join('');
    sections.push(
      renderSection('Member Access Patterns', `<div class="member-access-list">${items}</div>`)
    );
  }

  // Variable Lifecycle
  if (a.variableLifecycle) {
    const vl = a.variableLifecycle;
    const parts: string[] = [];
    if (vl.declaration) {
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Declaration:</span> ${_escAndLink(vl.declaration, ks)}</div>`
      );
    }
    if (vl.initialization) {
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Initialization:</span> ${_escAndLink(vl.initialization, ks)}</div>`
      );
    }
    if (vl.mutations && vl.mutations.length > 0) {
      const muts = vl.mutations.map((m: string) => `<li>${_escAndLink(m, ks)}</li>`).join('');
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Mutations:</span><ul class="lifecycle-sublist">${muts}</ul></div>`
      );
    }
    if (vl.consumption && vl.consumption.length > 0) {
      const cons = vl.consumption.map((c: string) => `<li>${_escAndLink(c, ks)}</li>`).join('');
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Consumption:</span><ul class="lifecycle-sublist">${cons}</ul></div>`
      );
    }
    if (vl.scopeAndLifetime) {
      parts.push(
        `<div class="lifecycle-item"><span class="lifecycle-item__label">Scope & Lifetime:</span> ${_escAndLink(vl.scopeAndLifetime, ks)}</div>`
      );
    }
    if (parts.length > 0) {
      sections.push(
        renderSection('Variable Lifecycle', `<div class="lifecycle-list">${parts.join('')}</div>`)
      );
    }
  }

  // Data Flow
  if (a.dataFlow && a.dataFlow.length > 0) {
    const items = a.dataFlow
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((df: any) => {
        const typeLabel = dataFlowIcon(df.type);
        const fileRef = df.filePath
          ? `<a class="data-flow-item__file file-link" href="#" data-file="${esc(df.filePath)}" data-line="${df.line || 1}" data-char="0">${esc(shortPath(df.filePath))}:${df.line}</a>`
          : '';
        return `<div class="data-flow-item">
        <span class="data-flow-item__type">${typeLabel}</span>
        <span class="data-flow-item__desc">${_escAndLink(df.description, ks)}</span>
        ${fileRef}
      </div>`;
      })
      .join('');
    sections.push(
      renderSection(
        `Data Flow (${a.dataFlow.length})`,
        `<div class="data-flow-list">${items}</div>`
      )
    );
  }

  // Key methods / points
  if (a.keyMethods && a.keyMethods.length > 0) {
    const items = a.keyMethods.map((m: string) => `<li>${_escAndLink(m, ks)}</li>`).join('');
    sections.push(renderSection('Key Points', `<ul class="list">${items}</ul>`));
  }

  // Usages
  if (a.usages && a.usages.length > 0) {
    const rows = a.usages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((u: any) => {
        const defBadge = u.isDefinition ? ' <span class="badge badge--def">def</span>' : '';
        return `<div class="usage-row" data-file="${esc(u.filePath)}" data-line="${u.line}" data-char="${u.character}">
          <span class="usage-row__file">${esc(shortPath(u.filePath))}:${u.line}</span>${defBadge}
          <span class="usage-row__context">${esc(u.contextLine?.trim() || '')}</span>
        </div>`;
      })
      .join('');
    sections.push(
      renderSection(`Usages (${a.usages.length})`, `<div class="usage-list">${rows}</div>`)
    );
  }

  // Call stacks
  if (a.callStacks && a.callStacks.length > 0) {
    const items = a.callStacks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => {
        const chain = c.chain || `${c.caller.name} → ${tab.symbol.name}`;
        const nameHtml = c.caller.filePath
          ? `<a class="symbol-link" href="#" data-symbol-name="${esc(c.caller.name)}" data-symbol-file="${esc(c.caller.filePath)}" data-symbol-line="${c.caller.line || 0}" data-symbol-kind="${esc(c.caller.kind || 'function')}">${esc(c.caller.name)}</a>`
          : `<strong>${esc(c.caller.name)}</strong>`;
        return `<li class="callstack-item">
          ${nameHtml}
          <a class="callstack-item__file file-link" href="#" data-file="${esc(c.caller.filePath)}" data-line="${c.caller.line || 1}" data-char="0">${esc(shortPath(c.caller.filePath))}:${c.caller.line}</a>
          <div class="callstack-item__chain">${_escAndLink(chain, ks)}</div>
        </li>`;
      })
      .join('');
    sections.push(
      renderSection(`Call Stacks (${a.callStacks.length})`, `<ul class="list">${items}</ul>`)
    );
  }

  // Relationships
  if (a.relationships && a.relationships.length > 0) {
    const items = a.relationships
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => {
          const targetLink = _symbolExploreLink(
            r.targetName,
            r.targetFilePath,
            r.targetLine,
            'unknown'
          );
          return `<li><span class="rel-type">${esc(r.type)}</span> ${targetLink} <a class="rel-file file-link" href="#" data-file="${esc(r.targetFilePath)}" data-line="${r.targetLine || 1}" data-char="0">${esc(shortPath(r.targetFilePath))}</a></li>`;
        }
      )
      .join('');
    sections.push(renderSection('Relationships', `<ul class="list">${items}</ul>`));
  }

  // Dependencies
  if (a.dependencies && a.dependencies.length > 0) {
    const items = a.dependencies.map((d: string) => `<li>${_escAndLink(d, ks)}</li>`).join('');
    sections.push(renderSection('Dependencies', `<ul class="list">${items}</ul>`));
  }

  // Usage pattern
  if (a.usagePattern) {
    sections.push(renderSection('Usage Pattern', `<p>${_escAndLink(a.usagePattern, ks)}</p>`));
  }

  // Potential issues
  if (a.potentialIssues && a.potentialIssues.length > 0) {
    const items = a.potentialIssues.map((i: string) => `<li>⚠ ${_escAndLink(i, ks)}</li>`).join('');
    sections.push(renderSection('Potential Issues', `<ul class="list">${items}</ul>`));
  }

  // Diagrams (Mermaid) — rendered as placeholder divs, filled by renderMermaidDiagrams()
  if (a.diagrams && a.diagrams.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of a.diagrams as any[]) {
      if (!d.mermaidSource) {
        continue;
      }
      const diagramId = `mermaid-${++_mermaidIdCounter}`;
      const content = `<div class="diagram-container" id="${diagramId}" data-mermaid-source="${escAttr(d.mermaidSource)}">
        <div class="diagram-loading">Rendering diagram\u2026</div>
      </div>`;
      sections.push(renderSection(d.title || 'Diagram', content));
    }
  }

  // Q&A History
  if (a.qaHistory && a.qaHistory.length > 0) {
    const items = a.qaHistory
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((qa: any, index: number) => {
        const time = qa.timestamp ? new Date(qa.timestamp).toLocaleString() : '';
        return `<div class="qa-item" id="qa-item-${index}">
          <div class="qa-item__question">
            <span class="qa-item__q-label">Q:</span>
            <span class="qa-item__q-text">${esc(qa.question)}</span>
          </div>
          <div class="qa-item__time">${esc(time)}</div>
          <div class="qa-item__answer">${_renderMarkdownWithMermaid(qa.answer, ks)}</div>
        </div>`;
      })
      .join('');
    sections.push(
      renderSection(`Q&A (${a.qaHistory.length})`, `<div class="qa-list">${items}</div>`)
    );
  }

  // Timestamp
  if (a.metadata?.analyzedAt) {
    const time = new Date(a.metadata.analyzedAt).toLocaleString();
    sections.push(`<div class="metadata">Analyzed: ${esc(time)}</div>`);
  }

  return `<div class="analysis-content">${sections.join('')}</div>`;
}

function renderSection(title: string, content: string): string {
  return `<details class="section" open>
    <summary class="section__title">${title}</summary>
    <div class="section__body">${content}</div>
  </details>`;
}

// =====================
// Event Listeners
// =====================

function attachListeners(): void {
  document.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.tabId;
      if (tabId) {
        vscode.postMessage({ type: 'tabClicked', tabId });
      }
    });
  });

  document.querySelectorAll('.tab__close').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.closeId;
      if (tabId) {
        vscode.postMessage({ type: 'tabClosed', tabId });
      }
    });
  });

  document.querySelectorAll('.error-state__retry').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.retryId;
      if (tabId) {
        vscode.postMessage({ type: 'retryAnalysis', tabId });
      }
    });
  });

  document.querySelectorAll('.usage-row').forEach((el) => {
    el.addEventListener('click', () => {
      const row = el as HTMLElement;
      const filePath = row.dataset.file;
      const line = parseInt(row.dataset.line || '0', 10);
      const character = parseInt(row.dataset.char || '0', 10);
      if (filePath) {
        vscode.postMessage({ type: 'navigateToSource', filePath, line, character });
      }
    });
  });

  // All file:line references rendered as <a class="file-link"> are clickable
  document.querySelectorAll('.file-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const link = el as HTMLElement;
      const filePath = link.dataset.file;
      const line = parseInt(link.dataset.line || '1', 10);
      const character = parseInt(link.dataset.char || '0', 10);
      if (filePath) {
        vscode.postMessage({ type: 'navigateToSource', filePath, line, character });
      }
    });
  });

  document.querySelectorAll('.symbol-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const link = el as HTMLElement;
      const symbolName = link.dataset.symbolName;
      const filePath = link.dataset.symbolFile;
      const line = parseInt(link.dataset.symbolLine || '0', 10);
      const kind = link.dataset.symbolKind || 'function';
      if (symbolName) {
        vscode.postMessage({
          type: 'exploreSymbol',
          symbolName,
          filePath,
          line: line || undefined,
          kind,
        });
      }
    });
  });

  // Enhance button — opens input dialog for user question/enhancement request
  document.querySelectorAll('.enhance-bar__button').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.tabId;
      if (!tabId) {
        return;
      }
      _showEnhanceDialog(tabId);
    });
  });
}

// =====================
// Enhance Dialog
// =====================

/**
 * Show a modal dialog for the user to enter their question or enhancement request.
 * When submitted, sends an 'enhanceAnalysis' message to the extension.
 */
function _showEnhanceDialog(tabId: string): void {
  // Remove any existing dialog
  const existing = document.getElementById('enhance-dialog-overlay');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'enhance-dialog-overlay';
  overlay.className = 'enhance-dialog-overlay';

  overlay.innerHTML = `<div class="enhance-dialog">
    <div class="enhance-dialog__header">
      <span class="enhance-dialog__title">✨ Enhance Analysis</span>
      <button class="enhance-dialog__close" id="enhance-dialog-close">×</button>
    </div>
    <div class="enhance-dialog__body">
      <label class="enhance-dialog__label" for="enhance-dialog-input">
        Ask a question or request an enhancement:
      </label>
      <textarea
        class="enhance-dialog__input"
        id="enhance-dialog-input"
        rows="4"
        placeholder="e.g., How does this function handle errors? What are the edge cases? Can you explain the algorithm in more detail?"
      ></textarea>
    </div>
    <div class="enhance-dialog__footer">
      <button class="enhance-dialog__cancel" id="enhance-dialog-cancel">Cancel</button>
      <button class="enhance-dialog__submit" id="enhance-dialog-submit">Send</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('enhance-dialog-input') as HTMLTextAreaElement;
  const submitBtn = document.getElementById('enhance-dialog-submit') as HTMLButtonElement;
  const cancelBtn = document.getElementById('enhance-dialog-cancel') as HTMLButtonElement;
  const closeBtn = document.getElementById('enhance-dialog-close') as HTMLButtonElement;

  // Focus the input
  setTimeout(() => input.focus(), 50);

  const close = (): void => {
    overlay.remove();
  };

  const submit = (): void => {
    const userPrompt = input.value.trim();
    if (!userPrompt) {
      input.classList.add('enhance-dialog__input--error');
      input.focus();
      return;
    }

    log(`enhance: submitting prompt for tab ${tabId}: "${userPrompt.substring(0, 80)}"`);
    vscode.postMessage({
      type: 'enhanceAnalysis',
      tabId,
      userPrompt,
    });
    close();
  };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  // Close on Escape, submit on Ctrl+Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      submit();
    }
  });

  // Close on overlay click (outside dialog)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });
}

// =====================
// Helpers
// =====================

function kindIcon(kind: string): string {
  const icons: Record<string, string> = {
    class: '🅲',
    function: 'ƒ',
    method: '𝑚',
    variable: '𝑥',
    interface: '𝐼',
    type: '𝑇',
    enum: 'ℰ',
    property: '𝑝',
    parameter: '𝑎',
    struct: '🅂',
  };
  return icons[kind] || '◆';
}

function memberKindIcon(memberKind: string): string {
  const icons: Record<string, string> = {
    field: '𝑥',
    method: '𝑚',
    property: '𝑝',
    constructor: '⊕',
    getter: '↗',
    setter: '↙',
  };
  return icons[memberKind] || '·';
}

function dataFlowIcon(flowType: string): string {
  const icons: Record<string, string> = {
    created: '⊕ created',
    assigned: '← assigned',
    read: '→ read',
    modified: '⚡ modified',
    consumed: '✓ consumed',
    returned: '↩ returned',
    passed: '→ passed',
  };
  return icons[flowType] || flowType;
}

function shortPath(filePath: string): string {
  if (!filePath) {
    return '';
  }
  const parts = filePath.split('/');
  if (parts.length <= 2) {
    return filePath;
  }
  return '…/' + parts.slice(-2).join('/');
}

function esc(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape a string for use in an HTML attribute value.
 * Handles double quotes and newlines so mermaid source can be stored in data-* attributes.
 */
function escAttr(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');
}

/**
 * After DOM is updated, find all diagram-container elements with
 * data-mermaid-source and render them via mermaid.
 */
async function renderMermaidDiagrams(): Promise<void> {
  const containers = document.querySelectorAll('.diagram-container[data-mermaid-source]');
  if (containers.length === 0) {
    return;
  }

  log(`renderMermaidDiagrams: rendering ${containers.length} diagram(s)`);

  for (const container of containers) {
    const el = container as HTMLElement;
    const source = el.dataset.mermaidSource;
    if (!source) {
      continue;
    }

    const diagramId = el.id || `mermaid-auto-${++_mermaidIdCounter}`;

    try {
      const { svg } = await mermaid.render(diagramId + '-svg', source);
      el.innerHTML = svg;
      el.classList.add('diagram-container--rendered');
      el.classList.remove('diagram-container--error');
      // Remove the data attribute so we don't re-render
      delete el.dataset.mermaidSource;
    } catch (err) {
      log(`renderMermaidDiagrams: failed to render ${diagramId}: ${err}`);
      // Show the raw source as a fallback code block
      el.innerHTML = `<div class="diagram-error">
        <div class="diagram-error__label">Diagram render failed</div>
        <pre class="diagram-error__source"><code>${esc(source)}</code></pre>
      </div>`;
      el.classList.add('diagram-container--error');
      // Remove the data attribute so we don't retry
      delete el.dataset.mermaidSource;
    }
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
