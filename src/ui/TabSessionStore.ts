/**
 * Code Explorer — Tab Session Store
 *
 * Persists and restores tab session state (which tabs are open, which is active)
 * so that tabs survive window reloads. The session file is stored at:
 *   .vscode/code-explorer-logs/tab-session.json
 *
 * Only "ready" tabs with cached analysis are persisted — loading/error tabs
 * are transient and not worth restoring.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SymbolInfo, NavigationEntry, PinnedInvestigation, TabGroup } from '../models/types';
import { logger } from '../utils/logger';

/** Minimal per-tab data needed to reconstruct tabs on restore. */
export interface PersistedTab {
  /** Tab ID (will be reassigned on restore to avoid counter conflicts) */
  id: string;
  /** The symbol info — enough to look up the cache and rebuild the tab */
  symbol: SymbolInfo;
}

/** Shape of the session file on disk. */
export interface TabSession {
  /** Version for future migration support */
  version: 1;
  /** ISO 8601 timestamp of when the session was saved */
  savedAt: string;
  /** Persisted tabs (only ready tabs with analysis) */
  tabs: PersistedTab[];
  /** ID of the active tab at save time (may be null) */
  activeTabId: string | null;
  /** Navigation history entries (optional for backward compatibility) */
  navigationHistory?: NavigationEntry[];
  /** Navigation history current index (optional for backward compatibility) */
  navigationIndex?: number;
  /** Pinned investigations (optional for backward compatibility) */
  pinnedInvestigations?: PinnedInvestigation[];
  /** Tab group tree structure (optional for backward compatibility) */
  tabGroups?: TabGroup[];
}

const SESSION_FILE_NAME = 'tab-session.json';

export class TabSessionStore {
  private readonly _sessionFilePath: string;

  constructor(workspaceRoot: string) {
    this._sessionFilePath = path.join(
      workspaceRoot,
      '.vscode',
      'code-explorer-logs',
      SESSION_FILE_NAME
    );
  }

  /**
   * Save the current tab session to disk.
   * Only persists tabs that are in "ready" status with analysis results.
   * This is called on every tab mutation (open, close, focus change).
   *
   * Uses synchronous write to avoid race conditions with rapid state changes.
   */
  save(
    tabs: PersistedTab[],
    activeTabId: string | null,
    navigationHistory?: NavigationEntry[],
    navigationIndex?: number,
    pinnedInvestigations?: PinnedInvestigation[],
    tabGroups?: TabGroup[]
  ): void {
    const session: TabSession = {
      version: 1,
      savedAt: new Date().toISOString(),
      tabs,
      activeTabId,
      navigationHistory,
      navigationIndex,
      pinnedInvestigations,
      tabGroups,
    };

    try {
      const dir = path.dirname(this._sessionFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._sessionFilePath, JSON.stringify(session, null, 2), 'utf-8');
      logger.debug(`TabSessionStore.save: persisted ${tabs.length} tabs, active=${activeTabId}`);
    } catch (err) {
      // Non-fatal — worst case we lose tab state on reload
      logger.warn(`TabSessionStore.save: failed to write session file: ${err}`);
    }
  }

  /**
   * Load a previously saved tab session from disk.
   * Returns null if no session file exists or it is corrupt.
   */
  load(): TabSession | null {
    try {
      if (!fs.existsSync(this._sessionFilePath)) {
        logger.debug('TabSessionStore.load: no session file found');
        return null;
      }

      const content = fs.readFileSync(this._sessionFilePath, 'utf-8');
      const session = JSON.parse(content) as TabSession;

      // Basic validation
      if (!session || session.version !== 1 || !Array.isArray(session.tabs)) {
        logger.warn('TabSessionStore.load: invalid session file format, ignoring');
        return null;
      }

      // Validate each tab has required fields
      const validTabs = session.tabs.filter(
        (t) =>
          t &&
          typeof t.id === 'string' &&
          t.symbol &&
          typeof t.symbol.name === 'string' &&
          typeof t.symbol.kind === 'string' &&
          typeof t.symbol.filePath === 'string' &&
          t.symbol.position &&
          typeof t.symbol.position.line === 'number'
      );

      if (validTabs.length < session.tabs.length) {
        logger.warn(
          `TabSessionStore.load: filtered out ${session.tabs.length - validTabs.length} invalid tabs`
        );
      }

      logger.info(
        `TabSessionStore.load: restored session with ${validTabs.length} tabs ` +
          `(saved at ${session.savedAt})`
      );

      return {
        ...session,
        tabs: validTabs,
      };
    } catch (err) {
      logger.warn(`TabSessionStore.load: failed to read session file: ${err}`);
      return null;
    }
  }

  /**
   * Delete the session file (e.g., when all tabs are closed).
   */
  clear(): void {
    try {
      if (fs.existsSync(this._sessionFilePath)) {
        fs.unlinkSync(this._sessionFilePath);
        logger.debug('TabSessionStore.clear: session file removed');
      }
    } catch (err) {
      logger.warn(`TabSessionStore.clear: failed to remove session file: ${err}`);
    }
  }
}
