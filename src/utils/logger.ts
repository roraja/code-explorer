/**
 * Code Explorer — Logging Utility
 *
 * Dual-output logger:
 * 1. VS Code OutputChannel — visible in the "Code Explorer" output panel
 *    (only when running inside VS Code extension host)
 * 2. File log — persisted at <workspace>/.vscode/code-explorer-logs/<date>.log
 *
 * Log files are rotated daily. All severity levels (DEBUG through ERROR) are
 * written to both destinations so nothing is lost.
 *
 * When running outside VS Code (CLI, tests), the OutputChannel is replaced
 * by a no-op stub — logs still go to the file log and per-command/LLM logs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSION_DISPLAY_NAME } from '../models/constants';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO ',
  [LogLevel.WARN]: 'WARN ',
  [LogLevel.ERROR]: 'ERROR',
};

// ── VS Code OutputChannel (lazy, optional) ─────────────────

/**
 * Minimal interface matching vscode.OutputChannel so we don't need
 * a compile-time dependency on the vscode module.
 */
interface OutputChannelLike {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

let _channel: OutputChannelLike | undefined;
let _vscodeAvailable: boolean | undefined;

/**
 * Check whether we're running inside a VS Code extension host.
 * Result is cached after the first call.
 */
function isVscodeAvailable(): boolean {
  if (_vscodeAvailable !== undefined) {
    return _vscodeAvailable;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve('vscode');
    _vscodeAvailable = true;
  } catch {
    _vscodeAvailable = false;
  }
  return _vscodeAvailable;
}

function getChannel(): OutputChannelLike {
  if (!_channel) {
    if (isVscodeAvailable()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscode = require('vscode');
        _channel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
      } catch {
        // Fallback: no-op channel
        _channel = {
          appendLine: () => {},
          show: () => {},
          dispose: () => {},
        };
      }
    } else {
      // Outside VS Code — no-op channel
      _channel = {
        appendLine: () => {},
        show: () => {},
        dispose: () => {},
      };
    }
  }
  return _channel!;
}

// ── State ──────────────────────────────────────────────────

let _level: LogLevel = LogLevel.INFO;
let _logDir: string | undefined;
let _logStream: fs.WriteStream | undefined;
let _currentLogDate: string | undefined;
let _sessionId: string | undefined;
let _extensionVersion: string | undefined;
let _llmCallCounter = 0;
let _llmLogDir: string | undefined;
let _activeLLMLogFile: string | undefined;
let _activeLLMLogStream: fs.WriteStream | undefined;
let _commandCallCounter = 0;
let _commandLogDir: string | undefined;
let _activeCommandLogStream: fs.WriteStream | undefined;
let _activeCommandLogFile: string | undefined;

// ── helpers ──────────────────────────────────────────────

/**
 * Scan a directory for files matching `NN-*.ext` and return the highest
 * sequence number found, or 0 if none exist.
 */
function findHighestSequenceNumber(dir: string, ext: string): number {
  try {
    if (!fs.existsSync(dir)) {
      return 0;
    }
    const files = fs.readdirSync(dir);
    let max = 0;
    for (const file of files) {
      if (!file.endsWith(ext)) {
        continue;
      }
      const match = file.match(/^(\d+)-/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) {
          max = num;
        }
      }
    }
    return max;
  } catch {
    return 0;
  }
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 23);
}

function dateStamp(): string {
  return new Date().toISOString().substring(0, 10); // YYYY-MM-DD
}

/**
 * Ensure the log directory exists and return the stream for today's log file.
 * Rotates to a new file when the date changes.
 */
function getLogStream(): fs.WriteStream | undefined {
  if (!_logDir) {
    return undefined;
  }

  const today = dateStamp();

  // If the date has rolled over, close the old stream and open a new one.
  if (_currentLogDate !== today) {
    _logStream?.end();
    _logStream = undefined;
    _currentLogDate = today;
  }

  if (!_logStream) {
    try {
      fs.mkdirSync(_logDir, { recursive: true });
      const filePath = path.join(_logDir, `${today}.log`);
      _logStream = fs.createWriteStream(filePath, { flags: 'a' });

      // Write session header on first open
      const versionStr = _extensionVersion ? `  v${_extensionVersion}` : '';
      _logStream.write(
        `\n${'─'.repeat(72)}\n` +
          `Session ${_sessionId}${versionStr}  started ${new Date().toISOString()}\n` +
          `${'─'.repeat(72)}\n`
      );
    } catch {
      // If we can't create the log file, just skip file logging.
      _logStream = undefined;
    }
  }

  return _logStream;
}

function formatLine(level: LogLevel, message: string, args: unknown[]): string {
  const prefix = `[${timestamp()}] [${LEVEL_LABELS[level]}]`;
  if (args.length === 0) {
    return `${prefix} ${message}`;
  }
  const extra = args
    .map((a) => {
      if (a instanceof Error) {
        return a.stack || a.message;
      }
      if (typeof a === 'string') {
        return a;
      }
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  return `${prefix} ${message} ${extra}`;
}

function emit(level: LogLevel, message: string, args: unknown[]): void {
  if (level < _level) {
    return;
  }

  const line = formatLine(level, message, args);

  // 1. VS Code output channel (no-op outside VS Code)
  getChannel().appendLine(line);

  // 2. File log (always, regardless of level filter — the file captures everything)
  const stream = getLogStream();
  if (stream) {
    stream.write(line + '\n');
  }

  // 3. Per-command log file (if a command session is active)
  if (_activeCommandLogStream) {
    _activeCommandLogStream.write(line + '\n');
  }
}

// ── public API ──────────────────────────────────────────

export const logger = {
  /**
   * Initialise file logging.
   * Call once during activation with the workspace root path.
   * Creates .vscode/code-explorer-logs/ if it does not exist.
   */
  init(workspaceRoot: string, version?: string): void {
    _logDir = path.join(workspaceRoot, '.vscode', 'code-explorer-logs');
    _llmLogDir = path.join(_logDir, 'llms');
    _commandLogDir = path.join(_logDir, 'commands');
    // Scan existing files to find the highest sequence number so new files
    // continue from where they left off instead of resetting to 01.
    _llmCallCounter = findHighestSequenceNumber(_llmLogDir, '.md');
    _commandCallCounter = findHighestSequenceNumber(_commandLogDir, '.log');
    _sessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    _extensionVersion = version;

    // Force-write the first line so the file is created immediately
    const stream = getLogStream();
    if (stream) {
      stream.write(`[${timestamp()}] [INFO ] Log directory: ${_logDir}\n`);
    }
  },

  /** Set the minimum log level for the output channel. */
  setLevel(level: LogLevel): void {
    _level = level;
  },

  /** Show the output channel panel. */
  show(): void {
    getChannel().show(true);
  },

  /** Dispose the output channel and close the file stream. */
  dispose(): void {
    _activeLLMLogStream?.end();
    _activeLLMLogStream = undefined;
    _activeLLMLogFile = undefined;
    _activeCommandLogStream?.end();
    _activeCommandLogStream = undefined;
    _activeCommandLogFile = undefined;
    _logStream?.end();
    _logStream = undefined;
    _channel?.dispose();
    _channel = undefined;
  },

  /** Get the underlying output channel. */
  getOutputChannel(): OutputChannelLike {
    return getChannel();
  },

  /**
   * Start a per-command log file. Creates a sequentially-numbered .log file
   * in .vscode/code-explorer-logs/commands/ (e.g., 01-explore-symbol-readText.log).
   * All subsequent logger.debug/info/warn/error calls will also be written to this file
   * until endCommandLog() is called.
   *
   * @param commandLabel — short kebab-case label for the file name (e.g., "explore-symbol-readText")
   */
  startCommandLog(commandLabel: string): void {
    if (!_commandLogDir) {
      return;
    }
    // Close any previously active command log
    _activeCommandLogStream?.end();
    _activeCommandLogStream = undefined;
    _activeCommandLogFile = undefined;

    try {
      fs.mkdirSync(_commandLogDir, { recursive: true });
      _commandCallCounter++;
      const seq = String(_commandCallCounter).padStart(2, '0');
      const safeName = commandLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${seq}-${safeName}.log`;
      _activeCommandLogFile = path.join(_commandLogDir, fileName);

      _activeCommandLogStream = fs.createWriteStream(_activeCommandLogFile, { flags: 'a' });

      // Write header
      const versionStr = _extensionVersion ? `  v${_extensionVersion}` : '';
      _activeCommandLogStream.write(
        `${'─'.repeat(72)}\n` +
          `Command: ${commandLabel}\n` +
          `Session: ${_sessionId}${versionStr}\n` +
          `Started: ${new Date().toISOString()}\n` +
          `${'─'.repeat(72)}\n`
      );

      emit(LogLevel.INFO, `Command log started: ${_activeCommandLogFile}`, []);
    } catch {
      _activeCommandLogStream = undefined;
      _activeCommandLogFile = undefined;
      emit(LogLevel.WARN, `Failed to start command log for "${commandLabel}"`, []);
    }
  },

  /**
   * End the active per-command log file. Closes the stream and resets state.
   */
  endCommandLog(): void {
    if (_activeCommandLogStream) {
      _activeCommandLogStream.write(
        `${'─'.repeat(72)}\n` + `Ended: ${new Date().toISOString()}\n` + `${'─'.repeat(72)}\n`
      );
      _activeCommandLogStream.end();
      _activeCommandLogStream = undefined;
      _activeCommandLogFile = undefined;
    }
  },

  debug(message: string, ...args: unknown[]): void {
    emit(LogLevel.DEBUG, message, args);
  },

  info(message: string, ...args: unknown[]): void {
    emit(LogLevel.INFO, message, args);
  },

  warn(message: string, ...args: unknown[]): void {
    emit(LogLevel.WARN, message, args);
  },

  error(message: string, ...args: unknown[]): void {
    emit(LogLevel.ERROR, message, args);
  },

  /**
   * Start a new LLM call log file. Creates the markdown file with a header
   * and opens a persistent WriteStream for real-time chunk streaming.
   * Subsequent calls to logLLMStep/logLLMInput/logLLMOutput/logLLMChunk
   * append to this stream immediately (visible in real time).
   */
  startLLMCallLog(symbolName: string, provider: string): void {
    if (!_llmLogDir) {
      return;
    }

    // Close any previously active LLM log stream
    _activeLLMLogStream?.end();
    _activeLLMLogStream = undefined;
    _activeLLMLogFile = undefined;

    try {
      fs.mkdirSync(_llmLogDir, { recursive: true });
      _llmCallCounter++;
      const seq = String(_llmCallCounter).padStart(2, '0');
      const safeName = symbolName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${seq}-${safeName}-call.md`;
      _activeLLMLogFile = path.join(_llmLogDir, fileName);

      // Open a persistent WriteStream so all writes flush immediately
      _activeLLMLogStream = fs.createWriteStream(_activeLLMLogFile, { flags: 'w' });

      const header =
        `# LLM Call: ${symbolName}\n\n` +
        `- **Provider:** ${provider}\n` +
        `- **Started:** ${new Date().toISOString()}\n` +
        `- **Session:** ${_sessionId}\n\n` +
        `---\n\n` +
        `## Agent Progress\n\n`;

      _activeLLMLogStream.write(header);
      emit(LogLevel.INFO, `LLM call log: ${_activeLLMLogFile}`, []);
    } catch {
      _activeLLMLogStream = undefined;
      _activeLLMLogFile = undefined;
      emit(LogLevel.WARN, `Failed to start LLM call log for "${symbolName}"`, []);
    }
  },

  /**
   * Append a timestamped progress step to the active LLM log file.
   * Use this to trace what the agent is thinking/deciding at each stage.
   */
  logLLMStep(message: string): void {
    if (!_activeLLMLogStream) {
      return;
    }
    try {
      const line = `- \`${timestamp()}\` ${message}\n`;
      _activeLLMLogStream.write(line);
    } catch {
      // silently skip
    }
  },

  /**
   * Append the full prompt (input) section to the active LLM log file.
   */
  logLLMInput(prompt: string): void {
    if (!_activeLLMLogStream) {
      return;
    }
    try {
      const section = `\n---\n\n` + `## Input (Prompt)\n\n` + '```\n' + prompt + '\n```\n\n';
      _activeLLMLogStream.write(section);
    } catch {
      // silently skip
    }
  },

  /**
   * Append the full response (output) section to the active LLM log file
   * and close the stream.
   */
  logLLMOutput(response: string): void {
    if (!_activeLLMLogStream) {
      return;
    }
    try {
      const section =
        `---
\n` +
        `## Output (Response)\n\n` +
        response +
        '\n';
      _activeLLMLogStream.write(section);
      _activeLLMLogStream.end();
      _activeLLMLogStream = undefined;
      _activeLLMLogFile = undefined;
    } catch {
      _activeLLMLogStream?.end();
      _activeLLMLogStream = undefined;
      _activeLLMLogFile = undefined;
    }
  },

  /**
   * Append a raw stdout chunk to the active LLM log file in real time.
   * Used to capture streaming CLI output as it arrives.
   * Uses the persistent WriteStream so chunks are flushed to disk immediately.
   */
  logLLMChunk(chunk: string): void {
    if (!_activeLLMLogStream) {
      return;
    }
    try {
      _activeLLMLogStream.write(chunk);
    } catch {
      // silently skip
    }
  },
};
