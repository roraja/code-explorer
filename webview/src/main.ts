/**
 * Code Explorer — Webview Entry Point
 *
 * Renders the sidebar UI: tabs, analysis results, loading/error states.
 * Communicates with the extension host via message passing.
 */

import './styles/main.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage: (_msg: unknown) => {},
  getState: () => null,
  setState: (_state: unknown) => {},
};

interface TabData {
  id: string;
  symbolName: string;
  symbolKind: string;
  status: 'loading' | 'ready' | 'error' | 'stale';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis: any;
  error?: string;
}

const state = {
  tabs: [] as TabData[],
  activeTabId: null as string | null,
};

function init(): void {
  render();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'openTab':
        addTab(msg.tab);
        break;
      case 'focusTab':
        focusTab(msg.tabId);
        break;
      case 'closeTab':
        removeTab(msg.tabId);
        break;
      case 'analysisResult':
        updateTabResult(msg.tabId, msg.result);
        break;
      case 'analysisError':
        updateTabError(msg.tabId, msg.error);
        break;
      case 'updateTab':
        if (msg.updates?.status) {
          const tab = state.tabs.find((t) => t.id === msg.tabId);
          if (tab) {
            tab.status = msg.updates.status;
            render();
          }
        }
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTab(tabData: any): void {
  const existing = state.tabs.find((t) => t.id === tabData.id);
  if (!existing) {
    state.tabs.push({
      id: tabData.id,
      symbolName: tabData.symbol.name,
      symbolKind: tabData.symbol.kind,
      status: tabData.status || 'loading',
      analysis: tabData.analysis,
      error: tabData.error,
    });
  }
  state.activeTabId = tabData.id;
  render();
}

function focusTab(tabId: string): void {
  state.activeTabId = tabId;
  render();
}

function removeTab(tabId: string): void {
  state.tabs = state.tabs.filter((t) => t.id !== tabId);
  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs.length > 0 ? state.tabs[state.tabs.length - 1].id : null;
  }
  render();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateTabResult(tabId: string, result: any): void {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab) {
    tab.status = 'ready';
    tab.analysis = result;
    tab.error = undefined;
  }
  render();
}

function updateTabError(tabId: string, error: string): void {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab) {
    tab.status = 'error';
    tab.error = error;
  }
  render();
}

// =====================
// Rendering
// =====================

function render(): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  if (state.tabs.length === 0) {
    root.innerHTML = renderEmpty();
    return;
  }

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0];
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
  const tabs = state.tabs
    .map((tab) => {
      const active = tab.id === state.activeTabId ? ' tab--active' : '';
      const icon = kindIcon(tab.symbolKind);
      const statusDot =
        tab.status === 'loading'
          ? '<span class="tab__status tab__status--loading">⟳</span>'
          : tab.status === 'error'
            ? '<span class="tab__status tab__status--error">✕</span>'
            : '';
      return `<div class="tab${active}" data-tab-id="${tab.id}">
        <span class="tab__icon">${icon}</span>
        <span class="tab__label">${esc(tab.symbolName)}</span>
        ${statusDot}
        <span class="tab__close" data-close-id="${tab.id}">×</span>
      </div>`;
    })
    .join('');

  return `<div class="tab-bar">${tabs}</div>`;
}

function renderContent(tab: TabData): string {
  if (tab.status === 'loading') {
    return `<div class="loading-state">
      <div class="loading-state__spinner"></div>
      <div class="loading-state__text">Analyzing ${esc(tab.symbolKind)} ${esc(tab.symbolName)}...</div>
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderAnalysis(tab: TabData): string {
  const a = tab.analysis;
  const sections: string[] = [];

  // Header
  sections.push(`<div class="symbol-header">
    <span class="symbol-header__icon">${kindIcon(a.symbol?.kind || tab.symbolKind)}</span>
    <span class="symbol-header__kind">${esc(a.symbol?.kind || tab.symbolKind)}</span>
    <span class="symbol-header__name">${esc(a.symbol?.name || tab.symbolName)}</span>
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
        const chain = c.chain || `${c.caller.name} → ${a.symbol?.name || tab.symbolName}`;
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
  // Tab clicks
  document.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.tabId;
      if (tabId) {
        vscode.postMessage({ type: 'tabClicked', tabId });
      }
    });
  });

  // Tab close buttons
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

  // Retry buttons
  document.querySelectorAll('.error-state__retry').forEach((el) => {
    el.addEventListener('click', () => {
      const tabId = (el as HTMLElement).dataset.retryId;
      if (tabId) {
        vscode.postMessage({ type: 'retryAnalysis', tabId });
      }
    });
  });

  // Usage row clicks (navigate to source)
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
