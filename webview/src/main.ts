/**
 * Code Explorer — Webview Entry Point
 *
 * Pure renderer. Receives full state from the extension via a single
 * `setState` message and renders it. Never owns or mutates state —
 * all mutations go through messages to the extension, which pushes
 * back the updated state.
 */

import './styles/main.css';

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
  'cache-check': 'Checking cache\u2026',
  'reading-source': 'Reading source code\u2026',
  'llm-analyzing': 'Running LLM analysis\u2026',
  'writing-cache': 'Saving to cache\u2026',
};

let currentTabs: Tab[] = [];
let currentActiveTabId: string | null = null;

function log(msg: string): void {
  console.log(`[CE] ${msg}`);
}

function init(): void {
  log('init');

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
}

function renderEmpty(): string {
  return `<div class="empty-state">
    <div class="empty-state__icon">🔍</div>
    <h2 class="empty-state__title">Code Explorer</h2>
    <p class="empty-state__description">
      Click on a symbol in your code, then run<br>
      <strong>Code Explorer: Explore Symbol</strong><br>
      or press <kbd>Ctrl+Shift+H</kbd>
    </p>
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
      const scope = tab.symbol.scopeChain && tab.symbol.scopeChain.length > 0
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

function renderAnalysis(tab: Tab): string {
  const a = tab.analysis;
  const sections: string[] = [];

  // Header
  sections.push(`<div class="symbol-header">
    <span class="symbol-header__icon">${kindIcon(tab.symbol.kind)}</span>
    <span class="symbol-header__kind">${esc(tab.symbol.kind)}</span>
    <span class="symbol-header__name">${esc(tab.symbol.name)}</span>
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
    sections.push(renderSection('Overview', `<p class="overview-text">${esc(a.overview)}</p>`));
  }

  // Data Kind (for variables — what kind of data this variable holds)
  if (a.dataKind && a.dataKind.label) {
    const dk = a.dataKind;
    const parts: string[] = [];
    parts.push(`<div class="data-kind-item">`);
    parts.push(`<div class="data-kind-item__label"><span class="badge badge--data-kind">📦 ${esc(dk.label)}</span></div>`);
    if (dk.description) {
      parts.push(`<div class="data-kind-item__desc">${esc(dk.description)}</div>`);
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
        parts.push(`<li>${esc(ref)}</li>`);
      }
      parts.push(`</ul>`);
    }
    parts.push(`</div>`);
    sections.push(renderSection('Data Kind', parts.join('')));
  }

  // Step-by-Step Breakdown (numbered functionalities)
  if (a.functionSteps && a.functionSteps.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = a.functionSteps.map((s: any) =>
      `<li class="step-item"><span class="step-item__number">${s.step}.</span> ${esc(s.description)}</li>`
    ).join('');
    sections.push(renderSection('Step-by-Step Breakdown', `<ol class="step-list">${items}</ol>`));
  }

  // Sub-Functions
  if (a.subFunctions && a.subFunctions.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = a.subFunctions.map((sf: any) => {
      const linkAttrs = sf.filePath
        ? ` data-symbol-name="${esc(sf.name)}" data-symbol-file="${esc(sf.filePath)}" data-symbol-line="${sf.line || 0}" data-symbol-kind="${esc(sf.kind || 'function')}"`
        : '';
      const nameHtml = sf.filePath
        ? `<a class="symbol-link" href="#"${linkAttrs}>${esc(sf.name)}</a>`
        : `<strong>${esc(sf.name)}</strong>`;
      return `<div class="subfunction-item">
        <div class="subfunction-item__header">${nameHtml}</div>
        <div class="subfunction-item__desc">${esc(sf.description)}</div>
        <div class="subfunction-item__io">
          <span class="subfunction-item__label">Input:</span> <span>${esc(sf.input)}</span>
        </div>
        <div class="subfunction-item__io">
          <span class="subfunction-item__label">Output:</span> <span>${esc(sf.output)}</span>
        </div>
        ${sf.filePath ? `<div class="subfunction-item__file">${esc(shortPath(sf.filePath))}${sf.line ? ':' + sf.line : ''}</div>` : ''}
      </div>`;
    }).join('');
    sections.push(renderSection(`Sub-Functions (${a.subFunctions.length})`, `<div class="subfunction-list">${items}</div>`));
  }

  // Function Input
  if (a.functionInputs && a.functionInputs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = a.functionInputs.map((p: any) => {
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
        <div class="fn-param-item__desc">${esc(p.description)}</div>
        ${p.mutated && p.mutationDetail ? `<div class="fn-param-item__mutation">⚡ ${esc(p.mutationDetail)}</div>` : ''}
        ${p.typeOverview ? `<div class="fn-param-item__type-overview">${esc(p.typeOverview)}</div>` : ''}
      </div>`;
    }).join('');
    sections.push(renderSection(`Function Input (${a.functionInputs.length})`, `<div class="fn-param-list">${items}</div>`));
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
      <div class="fn-output-item__desc">${esc(out.description)}</div>
      ${out.typeOverview ? `<div class="fn-output-item__type-overview">${esc(out.typeOverview)}</div>` : ''}
    </div>`;
    sections.push(renderSection('Function Output', content));
  }

  // Key methods / points
  if (a.keyMethods && a.keyMethods.length > 0) {
    const items = a.keyMethods.map((m: string) => `<li>${esc(m)}</li>`).join('');
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
          <span class="callstack-item__file">${esc(shortPath(c.caller.filePath))}:${c.caller.line}</span>
          <div class="callstack-item__chain">${esc(chain)}</div>
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
        (r: any) =>
          `<li><span class="rel-type">${esc(r.type)}</span> ${esc(r.targetName)} <span class="rel-file">${esc(shortPath(r.targetFilePath))}</span></li>`
      )
      .join('');
    sections.push(renderSection('Relationships', `<ul class="list">${items}</ul>`));
  }

  // Dependencies
  if (a.dependencies && a.dependencies.length > 0) {
    const items = a.dependencies.map((d: string) => `<li>${esc(d)}</li>`).join('');
    sections.push(renderSection('Dependencies', `<ul class="list">${items}</ul>`));
  }

  // Usage pattern
  if (a.usagePattern) {
    sections.push(renderSection('Usage Pattern', `<p>${esc(a.usagePattern)}</p>`));
  }

  // Potential issues
  if (a.potentialIssues && a.potentialIssues.length > 0) {
    const items = a.potentialIssues.map((i: string) => `<li>⚠ ${esc(i)}</li>`).join('');
    sections.push(renderSection('Potential Issues', `<ul class="list">${items}</ul>`));
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

  document.querySelectorAll('.symbol-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const link = el as HTMLElement;
      const symbolName = link.dataset.symbolName;
      const filePath = link.dataset.symbolFile;
      const line = parseInt(link.dataset.symbolLine || '0', 10);
      const kind = link.dataset.symbolKind || 'function';
      if (symbolName) {
        vscode.postMessage({ type: 'exploreSymbol', symbolName, filePath, line: line || undefined, kind });
      }
    });
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
    struct: '🅂',
  };
  return icons[kind] || '◆';
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

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
