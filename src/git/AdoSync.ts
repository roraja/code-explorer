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
 * Run a git command with extra environment variables.
 * Used for plumbing commands that need GIT_INDEX_FILE or GIT_WORK_TREE overrides.
 */
function _runGitEnv(
  args: string[],
  cwd: string,
  envOverrides: Record<string, string>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverrides },
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

/** Target directory (relative to workspace root) where ADO content is placed. */
const ADO_CONTENT_DIR = '.vscode/code-explorer';

/**
 * Pull content from ADO.
 *
 * Fetches the ADO branch and checks out its content into
 * `.vscode/code-explorer/`. This avoids a merge (which would fail with
 * "refusing to merge unrelated histories" since the ADO repo has no
 * common ancestor with the local repo). Instead we use
 * `git checkout <ref> -- .` to overlay the remote content into the
 * target directory.
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

    const fetchResult = await _runGit(['fetch', ADO_REMOTE_NAME, ADO_BRANCH], workspaceRoot);
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

    // 3. Ensure the target directory exists
    const { mkdirSync } = await import('fs');
    const { join } = await import('path');
    const targetDir = join(workspaceRoot, ADO_CONTENT_DIR);
    mkdirSync(targetDir, { recursive: true });

    // 4. Checkout the ADO branch content into the target directory.
    //    We use `git checkout <ref> -- .` run from within the target dir
    //    with GIT_WORK_TREE and GIT_DIR so files land in the right place.
    //    Instead, a simpler approach: use read-tree + checkout-index to
    //    extract files without touching HEAD or the index permanently.
    //
    //    Simplest correct approach:
    //      git --work-tree=<targetDir> checkout <ref> -- .
    //    This checks out all files from the remote branch root into targetDir.
    logger.info(
      `AdoSync: Checking out ${ADO_REMOTE_NAME}/${ADO_BRANCH} into ${ADO_CONTENT_DIR} ...`
    );
    details.push(`Checking out into ${ADO_CONTENT_DIR} ...`);

    const ref = `${ADO_REMOTE_NAME}/${ADO_BRANCH}`;
    const checkoutResult = await _runGit(
      [`--work-tree=${targetDir}`, 'checkout', ref, '--', '.'],
      workspaceRoot
    );
    if (checkoutResult.code !== 0) {
      const errMsg = `Checkout failed: ${checkoutResult.stderr || checkoutResult.stdout}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to checkout ADO content. ${checkoutResult.stderr}`,
        details: details.join('\n'),
      };
    }

    // 5. Reset the index so the checked-out files don't appear staged
    //    at the repo root. The `--work-tree` checkout above writes into
    //    the index as if the files were at the repo root; we need to
    //    unstage them and instead track them under ADO_CONTENT_DIR.
    await _runGit(['reset', 'HEAD', '--', '.'], workspaceRoot);

    const checkoutMsg = checkoutResult.stdout || 'Content extracted successfully.';
    details.push(checkoutMsg);
    logger.info(`AdoSync: Pull complete — content placed in ${ADO_CONTENT_DIR}`);

    return {
      success: true,
      message: `Pulled ${ADO_REMOTE_NAME}/${ADO_BRANCH} into ${ADO_CONTENT_DIR} successfully.`,
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
 * Creates a commit containing the contents of `.vscode/code-explorer/`
 * and pushes it to the ADO branch. This uses git plumbing commands
 * (write-tree, commit-tree) to build a commit in the ADO branch's
 * history without affecting the local repo's HEAD or index.
 *
 * Steps:
 *   1. Fetch latest from ADO (to get the parent commit)
 *   2. Build a tree from the content directory using a temporary index
 *   3. Create a commit object parented to the ADO branch tip
 *   4. Push that commit to the ADO branch
 */
export async function pushAdoContent(workspaceRoot: string): Promise<AdoSyncResult> {
  const details: string[] = [];

  try {
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const contentDir = join(workspaceRoot, ADO_CONTENT_DIR);

    // Check that content directory exists
    if (!existsSync(contentDir)) {
      return {
        success: false,
        message: `Content directory ${ADO_CONTENT_DIR} does not exist. Pull first.`,
        details: `${ADO_CONTENT_DIR} not found at ${contentDir}`,
      };
    }

    // 1. Ensure remote exists
    const remoteLog = await _ensureRemote(workspaceRoot);
    details.push(remoteLog);

    // 2. Fetch latest from ADO to get the current tip
    logger.info('AdoSync: Fetching latest before push ...');
    details.push('--- Fetch (before push) ---');

    const fetchResult = await _runGit(['fetch', ADO_REMOTE_NAME, ADO_BRANCH], workspaceRoot);
    if (fetchResult.code !== 0) {
      const errMsg = `Fetch failed: ${fetchResult.stderr}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Pre-push fetch failed. ${fetchResult.stderr}`,
        details: details.join('\n'),
      };
    }
    details.push('Fetch successful');

    // 3. Build a tree object from the content directory using a temp index
    details.push('\n--- Build commit ---');
    const tmpIndex = join(workspaceRoot, '.git', 'ado-push-index');
    const envOverride = { GIT_INDEX_FILE: tmpIndex, GIT_WORK_TREE: contentDir };

    // Add all files from content dir to temp index
    const addResult = await _runGitEnv(['add', '-A'], workspaceRoot, envOverride);
    if (addResult.code !== 0) {
      const errMsg = `Index add failed: ${addResult.stderr}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to stage content for push. ${addResult.stderr}`,
        details: details.join('\n'),
      };
    }

    // Write the tree
    const writeTreeResult = await _runGitEnv(['write-tree'], workspaceRoot, envOverride);
    if (writeTreeResult.code !== 0) {
      const errMsg = `write-tree failed: ${writeTreeResult.stderr}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to create tree object. ${writeTreeResult.stderr}`,
        details: details.join('\n'),
      };
    }
    const treeHash = writeTreeResult.stdout.trim();
    details.push(`Tree: ${treeHash}`);

    // Clean up temp index
    try {
      const { unlinkSync } = await import('fs');
      unlinkSync(tmpIndex);
    } catch {
      // Ignore cleanup errors
    }

    // 4. Get the current ADO branch tip as parent
    const ref = `${ADO_REMOTE_NAME}/${ADO_BRANCH}`;
    const parentResult = await _runGit(['rev-parse', ref], workspaceRoot);
    const parentArgs =
      parentResult.code === 0 && parentResult.stdout.trim()
        ? ['-p', parentResult.stdout.trim()]
        : [];

    // 5. Create a commit object
    const commitMsg = `chore: sync code-explorer content (${new Date().toISOString()})`;
    const commitTreeResult = await _runGit(
      ['commit-tree', treeHash, ...parentArgs, '-m', commitMsg],
      workspaceRoot
    );
    if (commitTreeResult.code !== 0) {
      const errMsg = `commit-tree failed: ${commitTreeResult.stderr}`;
      logger.error(`AdoSync: ${errMsg}`);
      details.push(errMsg);
      return {
        success: false,
        message: `Failed to create commit. ${commitTreeResult.stderr}`,
        details: details.join('\n'),
      };
    }
    const commitHash = commitTreeResult.stdout.trim();
    details.push(`Commit: ${commitHash}`);

    // 6. Push the commit to the ADO branch
    details.push('\n--- Push ---');
    logger.info(
      `AdoSync: Pushing ${commitHash} to ${ADO_REMOTE_NAME}:refs/heads/${ADO_BRANCH} ...`
    );
    details.push(`Pushing to ${ADO_REMOTE_NAME}:refs/heads/${ADO_BRANCH} ...`);

    const pushResult = await _runGit(
      ['push', ADO_REMOTE_NAME, `${commitHash}:refs/heads/${ADO_BRANCH}`],
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
