/**
 * Code Explorer — ADO Content Sync
 *
 * Manages syncing the .vscode/code-explorer content folder with
 * Azure DevOps (ADO) via git operations.
 *
 * Remote: ado → https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai
 * Branch: user/roraja/code-explorer/content
 *
 * This mirrors the shell functions from .vscode/commands/git/00-ado.sh
 * but runs natively in Node.js via child_process.
 */
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

const ADO_REMOTE_URL = 'https://microsoft.visualstudio.com/Edge/_git/edgeinternal.ai';
const ADO_REMOTE_NAME = 'ado';
const ADO_BRANCH = 'user/roraja/code-explorer/content';

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
 * Ensure the 'ado' remote exists in the git repository.
 * Adds it if missing. Also configures credential.helper.
 */
async function _ensureRemote(cwd: string): Promise<string> {
  const logs: string[] = [];

  // Check if the 'ado' remote already exists
  const checkResult = await _runGit(['remote', 'get-url', ADO_REMOTE_NAME], cwd);

  if (checkResult.code !== 0) {
    // Remote doesn't exist — add it
    logger.info(`AdoSync: Adding remote '${ADO_REMOTE_NAME}' → ${ADO_REMOTE_URL}`);
    logs.push(`Adding remote '${ADO_REMOTE_NAME}' → ${ADO_REMOTE_URL}`);

    const addResult = await _runGit(['remote', 'add', ADO_REMOTE_NAME, ADO_REMOTE_URL], cwd);
    if (addResult.code !== 0) {
      throw new Error(`Failed to add remote: ${addResult.stderr}`);
    }

    // Configure credential helper
    await _runGit(['config', 'credential.helper', 'store'], cwd);
    logs.push(`Remote '${ADO_REMOTE_NAME}' added successfully`);
  } else {
    logs.push(`Remote '${ADO_REMOTE_NAME}' already configured (${checkResult.stdout})`);
  }

  return logs.join('\n');
}

/**
 * Pull content from ADO.
 *
 * Fetches the ADO branch and merges it into the current branch.
 * This is equivalent to Git.Ado.Pull() from the shell script.
 */
export async function pullAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];

  try {
    // 1. Ensure remote exists
    const remoteLog = await _ensureRemote(workspaceRoot);
    details.push(remoteLog);

    // 2. Fetch the ADO branch
    logger.info(`AdoSync: Fetching ${ADO_REMOTE_NAME}/${ADO_BRANCH} ...`);
    details.push(`Fetching ${ADO_REMOTE_NAME} ${ADO_BRANCH} ...`);

    const fetchResult = await _runGit(
      ['fetch', ADO_REMOTE_NAME, ADO_BRANCH],
      workspaceRoot
    );
    if (fetchResult.code !== 0) {
      const errMsg = `Fetch failed: ${fetchResult.stderr}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to fetch from ADO. ${fetchResult.stderr}`,
        details: details.join('\n'),
      };
    }
    details.push('Fetch successful');

    // 3. Merge the fetched branch
    logger.info(`AdoSync: Merging ${ADO_REMOTE_NAME}/${ADO_BRANCH} ...`);
    details.push(`Merging ${ADO_REMOTE_NAME}/${ADO_BRANCH} ...`);

    const mergeResult = await _runGit(
      ['merge', `${ADO_REMOTE_NAME}/${ADO_BRANCH}`, '--no-edit'],
      workspaceRoot
    );
    if (mergeResult.code !== 0) {
      const errMsg = `Merge failed: ${mergeResult.stderr || mergeResult.stdout}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: 'Merge failed — resolve conflicts manually and commit.',
        details: details.join('\n'),
      };
    }

    const mergeMsg = mergeResult.stdout || 'Already up to date.';
    details.push(mergeMsg);
    logger.info(`AdoSync: Pull complete — ${mergeMsg}`);

    return {
      success: true,
      message: `Pulled and merged ${ADO_REMOTE_NAME}/${ADO_BRANCH} successfully.`,
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
 * First pulls (fetch + merge), then pushes HEAD to the ADO branch.
 * This is equivalent to Git.Ado.Pull() followed by Git.Ado.Push().
 */
export async function pushAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];

  try {
    // 1. Pull first to avoid conflicts
    logger.info('AdoSync: Pulling before push ...');
    details.push('--- Pull (before push) ---');

    const pullResult = await pullAdoContent(workspaceRoot);
    details.push(pullResult.details);

    if (!pullResult.success) {
      return {
        success: false,
        message: `Pre-push pull failed: ${pullResult.message}`,
        details: details.join('\n'),
      };
    }

    // 2. Push HEAD to the ADO branch
    details.push('\n--- Push ---');
    logger.info(`AdoSync: Pushing HEAD to ${ADO_REMOTE_NAME}:refs/heads/${ADO_BRANCH} ...`);
    details.push(`Pushing HEAD to ${ADO_REMOTE_NAME}:refs/heads/${ADO_BRANCH} ...`);

    const pushResult = await _runGit(
      ['push', ADO_REMOTE_NAME, `HEAD:refs/heads/${ADO_BRANCH}`],
      workspaceRoot
    );

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
    logger.info(`AdoSync: Push complete`);

    return {
      success: true,
      message: `Pushed to ADO (${ADO_REMOTE_NAME}/${ADO_BRANCH}) successfully.`,
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
