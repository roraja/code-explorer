/**
 * Code Explorer — ADO Content Sync
 *
 * Manages syncing the .vscode/code-explorer cache folder with an
 * Azure DevOps (ADO) git repository. The cache directory IS the git repo:
 *
 *   .vscode/code-explorer/          ← cloned ADO repo (origin = ADO)
 *     .git/                         ← its own git history
 *     src/cache/CacheStore.ts/      ← cached analysis files
 *     ...
 *
 * ## Pull
 *   - If the directory does not exist: `git clone -b <branch> <url> <dir>`
 *   - If it already exists (already cloned): `git pull --ff-only`
 *   Either way, the result is a full git repo the user can manually
 *   `cd` into and run git commands.
 *
 * ## Push
 *   1. `git pull --ff-only`  (get latest remote changes)
 *   2. `git add -A`          (stage all local changes)
 *   3. `git commit -m "…"`   (commit — no-op if nothing changed)
 *   4. `git push`            (push to origin)
 *
 * Remote URL: https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai
 * Branch:     user/roraja/code-explorer/content
 */
import * as path from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

const ADO_REMOTE_URL = 'https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai';
const ADO_BRANCH = 'user/roraja/code-explorer/content';

/** Target directory (relative to workspace root) — this IS the cloned repo. */
const ADO_CONTENT_DIR = '.vscode/code-explorer';

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
 * Pull content from ADO.
 *
 * - If `.vscode/code-explorer/` does not exist or is not a git repo:
 *   clones the ADO repo into it with `origin` set to the ADO URL.
 * - If it already exists as a git repo: runs `git pull --ff-only`
 *   to fetch and fast-forward.
 *
 * The result is a standalone git repo the user can `cd` into and
 * run manual git commands against.
 */
export async function pullAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];
  const contentDir = path.join(workspaceRoot, ADO_CONTENT_DIR);

  try {
    if (!_isGitRepo(contentDir)) {
      // ── Fresh clone ──────────────────────────────────────
      logger.info(
        `AdoSync: Cloning ${ADO_REMOTE_URL} (branch ${ADO_BRANCH}) into ${ADO_CONTENT_DIR} ...`
      );
      details.push(`Cloning ${ADO_REMOTE_URL}`);
      details.push(`  Branch: ${ADO_BRANCH}`);
      details.push(`  Into:   ${ADO_CONTENT_DIR}`);

      const cloneResult = await _runGit(
        ['clone', '--branch', ADO_BRANCH, '--single-branch', ADO_REMOTE_URL, contentDir],
        workspaceRoot
      );

      if (cloneResult.code !== 0) {
        const errMsg = `Clone failed: ${cloneResult.stderr || cloneResult.stdout}`;
        logger.error(`AdoSync: ${errMsg}`);
        details.push(errMsg);
        return {
          success: false,
          message: `Failed to clone ADO repo. ${cloneResult.stderr}`,
          details: details.join('\n'),
        };
      }

      details.push('Clone successful');
      logger.info(`AdoSync: Clone complete — ${ADO_CONTENT_DIR} is now a git repo`);

      return {
        success: true,
        message: `Cloned ADO repo into ${ADO_CONTENT_DIR}. Origin is set to ADO.`,
        details: details.join('\n'),
      };
    }

    // ── Already a git repo — pull latest ─────────────────
    logger.info(`AdoSync: ${ADO_CONTENT_DIR} is already a git repo — pulling latest ...`);
    details.push(`${ADO_CONTENT_DIR} already exists as a git repo`);
    details.push('Running git pull ...');

    const pullResult = await _runGit(['pull', '--ff-only'], contentDir);

    if (pullResult.code !== 0) {
      const errMsg = `Pull failed: ${pullResult.stderr || pullResult.stdout}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to pull latest from ADO. ${pullResult.stderr}`,
        details: details.join('\n'),
      };
    }

    const pullOutput = pullResult.stdout || pullResult.stderr || 'Already up to date.';
    details.push(pullOutput);
    logger.info(`AdoSync: Pull complete`);

    return {
      success: true,
      message: `Pulled latest changes into ${ADO_CONTENT_DIR}.`,
      details: details.join('\n'),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`AdoSync: Pull failed — ${errMsg}`);
    details.push(`Error: ${errMsg}`);
    return {
      success: false,
      message: `Pull failed: ${errMsg}`,
      details: details.join('\n'),
    };
  }
}

/**
 * Push content to ADO.
 *
 * The content directory must already be a cloned git repo (run Pull first).
 *
 * Steps:
 *   1. git pull --ff-only   (sync with remote first)
 *   2. git add -A           (stage all changes — new, modified, deleted)
 *   3. git commit            (commit with timestamp message; no-op if clean)
 *   4. git push              (push to origin)
 */
export async function pushAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];
  const contentDir = path.join(workspaceRoot, ADO_CONTENT_DIR);

  try {
    // Must be an existing git repo
    if (!_isGitRepo(contentDir)) {
      return {
        success: false,
        message: `${ADO_CONTENT_DIR} is not a git repo. Run "Pull ADO Content" first to clone it.`,
        details: `No .git directory found in ${contentDir}`,
      };
    }

    // ── Step 1: Pull latest ──────────────────────────────
    logger.info('AdoSync: Pulling latest before push ...');
    details.push('--- Pull (before push) ---');

    const pullResult = await _runGit(['pull', '--ff-only'], contentDir);
    if (pullResult.code !== 0) {
      // Pull failure is not fatal — there may be local-only changes
      // on a branch that doesn't exist remotely yet. Log and continue.
      const pullMsg = pullResult.stderr || pullResult.stdout;
      logger.warn(`AdoSync: Pull before push had issues: ${pullMsg}`);
      details.push(`Pull warning: ${pullMsg}`);
    } else {
      details.push(pullResult.stdout || pullResult.stderr || 'Already up to date.');
    }

    // ── Step 2: Stage all changes ────────────────────────
    details.push('\n--- Stage changes ---');
    const addResult = await _runGit(['add', '-A'], contentDir);
    if (addResult.code !== 0) {
      const errMsg = `git add failed: ${addResult.stderr}`;
      logger.error(`AdoSync: ${errMsg}`);
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
      // Exit code 1 with "nothing to commit" is normal — not an error
      if (
        commitResult.stdout.includes('nothing to commit') ||
        commitResult.stdout.includes('working tree clean')
      ) {
        logger.info('AdoSync: Nothing to commit — working tree clean');
        details.push('Nothing to commit, working tree clean');
        return {
          success: true,
          message: 'No changes to push — cache is already in sync with ADO.',
          details: details.join('\n'),
        };
      }

      const errMsg = `Commit failed: ${commitResult.stderr || commitResult.stdout}`;
      logger.error(`AdoSync: ${errMsg}`);
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
    logger.info('AdoSync: Pushing to origin ...');
    details.push('Pushing to origin ...');

    const pushResult = await _runGit(['push'], contentDir);

    if (pushResult.code !== 0) {
      const errMsg = `Push failed: ${pushResult.stderr || pushResult.stdout}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Push to ADO failed. ${pushResult.stderr}`,
        details: details.join('\n'),
      };
    }

    const pushOutput = pushResult.stderr || pushResult.stdout || 'Done';
    details.push(pushOutput);
    logger.info('AdoSync: Push complete');

    return {
      success: true,
      message: 'Committed and pushed cache changes to ADO.',
      details: details.join('\n'),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`AdoSync: Push failed — ${errMsg}`);
    details.push(`Error: ${errMsg}`);
    return {
      success: false,
      message: `Push failed: ${errMsg}`,
      details: details.join('\n'),
    };
  }
}
