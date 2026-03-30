/**
 * Code Explorer — ADO Content Sync
 *
 * Manages syncing the .vscode/code-explorer cache folder with an
 * Azure DevOps (ADO) git repository. Two branches share the same
 * cloned repo directory:
 *
 *   .vscode/code-explorer/          ← cloned ADO repo (origin = ADO)
 *     .git/                         ← git history, branches: content + content-upstream
 *     src/...                       ← cached analysis files
 *
 * Branches:
 *   - content          (user/roraja/code-explorer/content)
 *   - content-upstream (user/roraja/code-explorer/content-upstream)
 *
 * Pull/push commands switch to the correct branch automatically.
 *
 * ## Pull
 *   - If the directory does not exist: `git clone -b <branch> <url> <dir>`
 *   - If it exists on a different branch: fetch + checkout target branch
 *   - If it exists on the correct branch: `git pull --ff-only`
 *
 * ## Push
 *   1. Switch to target branch (if needed)
 *   2. `git pull --ff-only`
 *   3. `git add -A`
 *   4. `git commit -m "…"`
 *   5. `git push`
 *
 * Remote URL: https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai
 */
import * as path from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

const ADO_REMOTE_URL = 'https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai';

/** Sync target configuration. */
interface SyncTarget {
  /** ADO branch name */
  branch: string;
  /** Directory relative to workspace root */
  dir: string;
  /** Human-readable label for log/UI messages */
  label: string;
}

const CONTENT_TARGET: SyncTarget = {
  branch: 'user/roraja/code-explorer/content',
  dir: '.vscode/code-explorer',
  label: 'ADO Content',
};

const UPSTREAM_TARGET: SyncTarget = {
  branch: 'user/roraja/code-explorer/content-upstream',
  dir: '.vscode/code-explorer',
  label: 'ADO Upstream',
};

export interface AdoSyncResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** Human-readable summary of what happened. */
  message: string;
  /** Detailed log output from git commands. */
  details: string;
}

/**
 * Run a git command in the given working directory.
 * Returns { code, stdout, stderr }.
 */
function _runGit(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // On Windows, spawn needs shell:true to resolve .cmd/.bat shims
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err: Error) => {
      reject(err);
    });

    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/**
 * Check whether the content directory is already a git repo
 * (i.e., has a .git directory inside it).
 */
function _isGitRepo(contentDir: string): boolean {
  return existsSync(path.join(contentDir, '.git'));
}

/**
 * Get the short name of the branch the repo currently has checked out.
 * Returns null if it can't be determined.
 */
async function _currentBranch(repoDir: string): Promise<string | null> {
  const result = await _runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Extract the short branch name from a full branch path.
 * e.g. "user/roraja/code-explorer/content" → "content"
 * (used for local branch names after clone --single-branch)
 */
function _shortBranch(fullBranch: string): string {
  const lastSlash = fullBranch.lastIndexOf('/');
  return lastSlash >= 0 ? fullBranch.substring(lastSlash + 1) : fullBranch;
}

// ── Generic pull / push ──────────────────────────────────

/**
 * Pull (clone, switch branch, or fast-forward) a sync target.
 *
 * Since content and upstream share the same directory, pull handles
 * three scenarios:
 *   1. Directory doesn't exist → clone with the target branch
 *   2. Exists, already on target branch → git pull --ff-only
 *   3. Exists, on a different branch → fetch, checkout/create target branch, pull
 */
async function _pull(target: SyncTarget, workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];
  const contentDir = path.join(workspaceRoot, target.dir);

  try {
    if (!_isGitRepo(contentDir)) {
      // ── Fresh clone ──────────────────────────────────────
      logger.info(
        `AdoSync [${target.label}]: Cloning ${ADO_REMOTE_URL} (branch ${target.branch}) into ${target.dir} ...`
      );
      details.push(`Cloning ${ADO_REMOTE_URL}`);
      details.push(`  Branch: ${target.branch}`);
      details.push(`  Into:   ${target.dir}`);

      const cloneResult = await _runGit(
        ['clone', '--branch', target.branch, ADO_REMOTE_URL, contentDir],
        workspaceRoot
      );

      if (cloneResult.code !== 0) {
        const errMsg = `Clone failed: ${cloneResult.stderr || cloneResult.stdout}`;
        logger.error(`AdoSync [${target.label}]: ${errMsg}`);
        details.push(errMsg);
        return {
          success: false,
          message: `Failed to clone ADO repo. ${cloneResult.stderr}`,
          details: details.join('\n'),
        };
      }

      details.push('Clone successful');
      logger.info(`AdoSync [${target.label}]: Clone complete — ${target.dir} is now a git repo`);

      return {
        success: true,
        message: `Cloned ADO repo into ${target.dir} (branch: ${_shortBranch(target.branch)}). Origin is set to ADO.`,
        details: details.join('\n'),
      };
    }

    // ── Already a git repo — check if we need to switch branches ──
    const currentBranch = await _currentBranch(contentDir);
    const targetShort = _shortBranch(target.branch);

    logger.info(
      `AdoSync [${target.label}]: ${target.dir} exists (on branch "${currentBranch}"), target is "${targetShort}"`
    );
    details.push(`${target.dir} already exists as a git repo`);
    details.push(`Current branch: ${currentBranch}`);
    details.push(`Target branch:  ${targetShort}`);

    if (currentBranch !== targetShort) {
      // ── Switch to target branch ────────────────────────
      details.push(`\nSwitching to branch "${targetShort}" ...`);

      // Fetch all branches so the target branch ref is available
      const fetchResult = await _runGit(['fetch', 'origin'], contentDir);
      if (fetchResult.code !== 0) {
        logger.warn(
          `AdoSync [${target.label}]: fetch before branch switch had issues: ${fetchResult.stderr}`
        );
        details.push(`Fetch warning: ${fetchResult.stderr}`);
      }

      // Try checkout — the branch may already exist locally or need to be created from remote
      let checkoutResult = await _runGit(['checkout', targetShort], contentDir);
      if (checkoutResult.code !== 0) {
        // Branch doesn't exist locally — create it tracking the remote
        checkoutResult = await _runGit(
          ['checkout', '-b', targetShort, `origin/${targetShort}`],
          contentDir
        );
      }

      if (checkoutResult.code !== 0) {
        const errMsg = `Branch switch failed: ${checkoutResult.stderr || checkoutResult.stdout}`;
        logger.error(`AdoSync [${target.label}]: ${errMsg}`);
        details.push(errMsg);
        return {
          success: false,
          message: `Failed to switch to branch "${targetShort}". ${checkoutResult.stderr}`,
          details: details.join('\n'),
        };
      }

      details.push(`Switched to branch "${targetShort}"`);
    }

    // ── Pull latest ──────────────────────────────────────
    details.push('\nRunning git pull ...');
    const pullResult = await _runGit(['pull', '--ff-only'], contentDir);

    if (pullResult.code !== 0) {
      const errMsg = `Pull failed: ${pullResult.stderr || pullResult.stdout}`;
      logger.error(`AdoSync [${target.label}]: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to pull latest from ADO. ${pullResult.stderr}`,
        details: details.join('\n'),
      };
    }

    const pullOutput = pullResult.stdout || pullResult.stderr || 'Already up to date.';
    details.push(pullOutput);
    logger.info(`AdoSync [${target.label}]: Pull complete`);

    return {
      success: true,
      message: `Pulled latest changes into ${target.dir} (branch: ${targetShort}).`,
      details: details.join('\n'),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`AdoSync [${target.label}]: Pull failed — ${errMsg}`);
    details.push(`Error: ${errMsg}`);
    return {
      success: false,
      message: `Pull failed: ${errMsg}`,
      details: details.join('\n'),
    };
  }
}

/**
 * Push a sync target: ensure correct branch → pull → stage → commit → push.
 */
async function _push(target: SyncTarget, workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];
  const contentDir = path.join(workspaceRoot, target.dir);

  try {
    // Must be an existing git repo
    if (!_isGitRepo(contentDir)) {
      return {
        success: false,
        message: `${target.dir} is not a git repo. Run "Pull ${target.label}" first to clone it.`,
        details: `No .git directory found in ${contentDir}`,
      };
    }

    // ── Step 0: Ensure correct branch ────────────────────
    const currentBranch = await _currentBranch(contentDir);
    const targetShort = _shortBranch(target.branch);

    if (currentBranch !== targetShort) {
      details.push(`Switching to branch "${targetShort}" (currently on "${currentBranch}") ...`);
      await _runGit(['fetch', 'origin'], contentDir);
      let checkoutResult = await _runGit(['checkout', targetShort], contentDir);
      if (checkoutResult.code !== 0) {
        checkoutResult = await _runGit(
          ['checkout', '-b', targetShort, `origin/${targetShort}`],
          contentDir
        );
      }
      if (checkoutResult.code !== 0) {
        const errMsg = `Branch switch failed: ${checkoutResult.stderr || checkoutResult.stdout}`;
        logger.error(`AdoSync [${target.label}]: ${errMsg}`);
        details.push(errMsg);
        return {
          success: false,
          message: `Failed to switch to branch "${targetShort}". ${checkoutResult.stderr}`,
          details: details.join('\n'),
        };
      }
      details.push(`Switched to branch "${targetShort}"`);
    }

    // ── Step 1: Pull latest ──────────────────────────────
    logger.info(`AdoSync [${target.label}]: Pulling latest before push ...`);
    details.push('\n--- Pull (before push) ---');

    const pullResult = await _runGit(['pull', '--ff-only'], contentDir);
    if (pullResult.code !== 0) {
      const pullMsg = pullResult.stderr || pullResult.stdout;
      logger.warn(`AdoSync [${target.label}]: Pull before push had issues: ${pullMsg}`);
      details.push(`Pull warning: ${pullMsg}`);
    } else {
      details.push(pullResult.stdout || pullResult.stderr || 'Already up to date.');
    }

    // ── Step 2: Stage all changes ────────────────────────
    details.push('\n--- Stage changes ---');
    const addResult = await _runGit(['add', '-A'], contentDir);
    if (addResult.code !== 0) {
      const errMsg = `git add failed: ${addResult.stderr}`;
      logger.error(`AdoSync [${target.label}]: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to stage changes. ${addResult.stderr}`,
        details: details.join('\n'),
      };
    }
    details.push('All changes staged');

    // ── Step 3: Commit ───────────────────────────────────
    details.push('\n--- Commit ---');
    const commitMsg = `chore: sync code-explorer cache (${new Date().toISOString()})`;
    const commitResult = await _runGit(['commit', '-m', commitMsg], contentDir);

    if (commitResult.code !== 0) {
      if (
        commitResult.stdout.includes('nothing to commit') ||
        commitResult.stdout.includes('working tree clean')
      ) {
        logger.info(`AdoSync [${target.label}]: Nothing to commit — working tree clean`);
        details.push('Nothing to commit, working tree clean');
        return {
          success: true,
          message: `No changes to push — ${target.dir} is already in sync with ADO.`,
          details: details.join('\n'),
        };
      }

      const errMsg = `Commit failed: ${commitResult.stderr || commitResult.stdout}`;
      logger.error(`AdoSync [${target.label}]: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to commit changes. ${commitResult.stderr}`,
        details: details.join('\n'),
      };
    }
    details.push(commitResult.stdout || 'Committed');

    // ── Step 4: Push ─────────────────────────────────────
    details.push('\n--- Push ---');
    logger.info(`AdoSync [${target.label}]: Pushing to origin ...`);
    details.push('Pushing to origin ...');

    const pushResult = await _runGit(['push'], contentDir);

    if (pushResult.code !== 0) {
      const errMsg = `Push failed: ${pushResult.stderr || pushResult.stdout}`;
      logger.error(`AdoSync [${target.label}]: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Push to ADO failed. ${pushResult.stderr}`,
        details: details.join('\n'),
      };
    }

    const pushOutput = pushResult.stderr || pushResult.stdout || 'Done';
    details.push(pushOutput);
    logger.info(`AdoSync [${target.label}]: Push complete`);

    return {
      success: true,
      message: `Committed and pushed changes to ADO (${target.dir}).`,
      details: details.join('\n'),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`AdoSync [${target.label}]: Push failed — ${errMsg}`);
    details.push(`Error: ${errMsg}`);
    return {
      success: false,
      message: `Push failed: ${errMsg}`,
      details: details.join('\n'),
    };
  }
}

// ── Public API ───────────────────────────────────────────

/** Pull content from ADO → .vscode/code-explorer/ */
export function pullAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  return _pull(CONTENT_TARGET, workspaceRoot);
}

/** Push content from .vscode/code-explorer/ → ADO */
export function pushAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  return _push(CONTENT_TARGET, workspaceRoot);
}

/** Pull upstream content from ADO → .vscode/code-explorer-upstream/ */
export function pullAdoUpstream(workspaceRoot: string): Promise<AdoSyncResult> {
  return _pull(UPSTREAM_TARGET, workspaceRoot);
}

/** Push upstream content from .vscode/code-explorer-upstream/ → ADO */
export function pushAdoUpstream(workspaceRoot: string): Promise<AdoSyncResult> {
  return _push(UPSTREAM_TARGET, workspaceRoot);
}
