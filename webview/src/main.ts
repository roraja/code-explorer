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
  symbol: { name: string; kind: string; filePath: string };
  status: 'loading' | 'ready' | 'error' | 'stale';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis: any;
  error?: string;
}

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
      or press <kbd>Ctrl+Shift+E</kbd>
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
      return `<div class="tab${active}" data-tab-id="${tab.id}">
        <span class="tab__icon">${icon}</span>
        <span class="tab__label">${esc(tab.symbol.name)}</span>
        ${statusDot}
        <span class="tab__close" data-close-id="${tab.id}">×</span>
      </div>`;
    })
    .join('');

  return `<div class="tab-bar">${tabs}</div>`;
}

function renderContent(tab: Tab): string {
  if (tab.status === 'loading') {
    return `<div class="loading-state">
      <div class="loading-state__spinner"></div>
      <div class="loading-state__text">Analyzing ${esc(tab.symbol.kind)} ${esc(tab.symbol.name)}...</div>
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
        return `<li class="callstack-item">
          <strong>${esc(c.caller.name)}</strong>
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
