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
    logger.info(`${label}: spawned process PID=${pid}, command: ${command} ${args.join(' ')}`);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const startTime = Date.now();

    // Track last output for the "still waiting" periodic log
    let _lastStdoutSnippet = '';
    let _lastStderrSnippet = '';
    let _stdoutLineCount = 0;
    let _stderrLineCount = 0;

    // Periodic "still waiting" log every 15 seconds — includes recent output snippet
    const waitingInterval = setInterval(() => {
      if (!settled) {
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        const recentOut = _lastStdoutSnippet
          ? ` | last stdout: "${_lastStdoutSnippet.substring(0, 120).replace(/\n/g, '\\n')}"`
          : ' | no stdout yet';
        const recentErr = _lastStderrSnippet
          ? ` | last stderr: "${_lastStderrSnippet.substring(0, 120).replace(/\n/g, '\\n')}"`
          : '';
        logger.info(
          `${label}: Still waiting (PID=${pid}, ${elapsedSec}s elapsed, ` +
            `stdout=${_stdoutLineCount} lines/${stdout.length} bytes, ` +
            `stderr=${_stderrLineCount} lines/${stderr.length} bytes)` +
            `${recentOut}${recentErr}`
        );
      }
    }, 15_000);

    // Manual timeout since spawn doesn't support timeout option
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(waitingInterval);
        child.kill('SIGTERM');
        const elapsedMs = Date.now() - startTime;
        logger.error(
          `${label}: TIMED OUT after ${elapsedMs}ms (PID=${pid}, ` +
            `stdout=${stdout.length} bytes/${_stdoutLineCount} lines, ` +
            `stderr=${stderr.length} bytes/${_stderrLineCount} lines)`
        );
        if (_lastStdoutSnippet) {
          logger.error(
            `${label}: last stdout before timeout: "${_lastStdoutSnippet.substring(0, 200).replace(/\n/g, '\\n')}"`
          );
        }
        if (_lastStderrSnippet) {
          logger.error(
            `${label}: last stderr before timeout: "${_lastStderrSnippet.substring(0, 200).replace(/\n/g, '\\n')}"`
          );
        }
        const err = new Error('Process timed out');
        (err as Error & { killed: boolean; signal: string }).killed = true;
        (err as Error & { signal: string }).signal = 'SIGTERM';
        reject(err);
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;

      // Track for periodic "still waiting" summary
      _lastStdoutSnippet = text.trimEnd();
      _stdoutLineCount += (text.match(/\n/g) || []).length;

      // Log every stdout chunk to the main logger so it's visible in
      // the Output Channel and daily log file in real time.
      // Use debug level to avoid flooding, but always present in file logs.
      const lines = text.trimEnd().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          logger.debug(`${label} [stdout]: ${line}`);
        }
      }

      if (onStdoutChunk) {
        onStdoutChunk(text);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      // Track for periodic "still waiting" summary
      _lastStderrSnippet = text.trimEnd();
      _stderrLineCount += (text.match(/\n/g) || []).length;

      // Log every stderr chunk at warn level so it's immediately visible
      // in the Output Channel — stderr often contains progress info,
      // error messages, or diagnostic output that helps debug stuck processes.
      const lines = text.trimEnd().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          logger.warn(`${label} [stderr]: ${line}`);
        }
      }

      if (onStderrChunk) {
        onStderrChunk(text);
      }
    });

    child.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        clearInterval(waitingInterval);
        const elapsedMs = Date.now() - startTime;
        logger.error(
          `${label}: spawn error after ${elapsedMs}ms (PID=${pid}): ${err.message}`
        );
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

      const elapsedMs = Date.now() - startTime;

      if (signal) {
        logger.error(
          `${label}: process killed by signal ${signal} after ${elapsedMs}ms ` +
            `(PID=${pid}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes)`
        );
        const err = new Error(`Process killed by signal ${signal}`);
        (err as Error & { signal: string }).signal = signal;
        reject(err);
        return;
      }

      if (stderr.trim()) {
        logger.debug(`${label} stderr (final): ${stderr.trim().substring(0, 500)}`);
      }

      if (code !== 0 && code !== null) {
        const errorDetail = stderr.trim() || stdout.trim();
        logger.error(
          `${label}: exited with code ${code} after ${elapsedMs}ms ` +
            `(PID=${pid}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes)`
        );
        if (stdout.trim()) {
          logger.debug(`${label} stdout on failure: ${stdout.trim().substring(0, 500)}`);
        }
        reject(new Error(`${command} exited with code ${code}: ${errorDetail.substring(0, 500)}`));
        return;
      }

      logger.info(
        `${label}: completed successfully in ${elapsedMs}ms ` +
          `(PID=${pid}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes)`
      );

      resolve(stdout);
    });

    // Write prompt to stdin and close
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}
