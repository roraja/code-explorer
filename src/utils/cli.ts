/**
 * Code Explorer — CLI Process Runner
 *
 * Shared utility for spawning CLI processes with stdin piping,
 * manual timeout, and structured error handling. Used by all
 * LLM providers that shell out to a CLI tool.
 */
import { spawn } from 'child_process';
import { logger } from './logger';

export interface CLIRunOptions {
  /** The command to run (e.g. 'claude', 'copilot'). */
  command: string;
  /** Arguments to pass to the command. */
  args: string[];
  /** Data to write to stdin. */
  stdinData: string;
  /** Timeout in milliseconds (default: 900000 = 15 min). */
  timeoutMs?: number;
  /** Environment variable overrides — keys set to undefined are deleted. */
  envOverrides?: Record<string, string | undefined>;
  /** Working directory for the spawned process. Defaults to process.cwd(). */
  cwd?: string;
  /** Label for log messages (e.g. 'mai-claude', 'copilot-cli'). */
  label: string;
  /** Optional callback invoked with each stdout chunk as it arrives. */
  onStdoutChunk?: (chunk: string) => void;
  /** Optional callback invoked with each stderr chunk as it arrives. */
  onStderrChunk?: (chunk: string) => void;
}

/**
 * Spawn a CLI process, pipe data to stdin, and return stdout.
 *
 * - Prompt is sent via stdin to avoid OS argument length limits.
 * - Timeout is handled manually since `spawn()` doesn't support it.
 * - Uses a `settled` guard to prevent double-resolve/reject.
 */
export function runCLI(options: CLIRunOptions): Promise<string> {
  const {
    command,
    args,
    stdinData,
    timeoutMs = 900_000,
    envOverrides,
    cwd,
    label,
    onStdoutChunk,
    onStderrChunk,
  } = options;

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (envOverrides) {
      for (const [key, value] of Object.entries(envOverrides)) {
        if (value === undefined) {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
    }

    const child = spawn(command, args, {
      env,
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pid = child.pid;
    logger.info(`${label}: spawned process PID=${pid}`);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const startTime = Date.now();

    // Periodic "still waiting" log every 15 seconds
    const waitingInterval = setInterval(() => {
      if (!settled) {
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        logger.info(
          `${label}: Still waiting for agent to complete (PID=${pid}, ${elapsedSec}s elapsed)`
        );
      }
    }, 15_000);

    // Manual timeout since spawn doesn't support timeout option
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(waitingInterval);
        child.kill('SIGTERM');
        const err = new Error('Process timed out');
        (err as Error & { killed: boolean; signal: string }).killed = true;
        (err as Error & { signal: string }).signal = 'SIGTERM';
        reject(err);
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdoutChunk) {
        onStdoutChunk(text);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderrChunk) {
        onStderrChunk(text);
      }
    });

    child.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        clearInterval(waitingInterval);
        reject(err);
      }
    });

    child.on('close', (code: number | null, signal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearInterval(waitingInterval);

      if (signal) {
        const err = new Error(`Process killed by signal ${signal}`);
        (err as Error & { signal: string }).signal = signal;
        reject(err);
        return;
      }

      if (stderr.trim()) {
        logger.debug(`${label} stderr: ${stderr.trim().substring(0, 500)}`);
      }

      if (code !== 0 && code !== null) {
        const errorDetail = stderr.trim() || stdout.trim();
        if (stdout.trim()) {
          logger.debug(`${label} stdout on failure: ${stdout.trim().substring(0, 500)}`);
        }
        reject(new Error(`${command} exited with code ${code}: ${errorDetail.substring(0, 500)}`));
        return;
      }

      resolve(stdout);
    });

    // Write prompt to stdin and close
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}
