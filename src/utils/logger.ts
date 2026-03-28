/**
 * Code Explorer — Logging Utility
 *
 * Dual-output logger:
 * 1. VS Code OutputChannel — visible in the "Code Explorer" output panel
 * 2. File log — persisted at <workspace>/.vscode/code-explorer/logs/<date>.log
 *
 * Log files are rotated daily. All severity levels (DEBUG through ERROR) are
 * written to both destinations so nothing is lost.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSION_DISPLAY_NAME, CACHE } from '../models/constants';

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

let _channel: vscode.OutputChannel | undefined;
let _level: LogLevel = LogLevel.INFO;
let _logDir: string | undefined;
let _logStream: fs.WriteStream | undefined;
let _currentLogDate: string | undefined;
let _sessionId: string | undefined;
let _llmCallCounter = 0;
let _llmLogDir: string | undefined;
let _activeLLMLogFile: string | undefined;

// ── helpers ──────────────────────────────────────────────

function getChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
  }
  return _channel;
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
      _logStream.write(
        `\n${'─'.repeat(72)}\n` +
          `Session ${_sessionId}  started ${new Date().toISOString()}\n` +
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

  // 1. VS Code output channel
  getChannel().appendLine(line);

  // 2. File log (always, regardless of level filter — the file captures everything)
  const stream = getLogStream();
  if (stream) {
    stream.write(line + '\n');
  }
}

// ── public API (unchanged from before) ──────────────────

export const logger = {
  /**
   * Initialise file logging.
   * Call once during activation with the workspace root path.
   * Creates .vscode/code-explorer/logs/ if it does not exist.
   */
  init(workspaceRoot: string): void {
    _logDir = path.join(workspaceRoot, '.vscode', CACHE.DIR_NAME, 'logs');
    _llmLogDir = path.join(_logDir, 'llms');
    _llmCallCounter = 0;
    _sessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

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
    _logStream?.end();
    _logStream = undefined;
    _channel?.dispose();
    _channel = undefined;
  },

  /** Get the underlying output channel (for context.subscriptions). */
  getOutputChannel(): vscode.OutputChannel {
    return getChannel();
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
   * Start a new LLM call log file. Creates the markdown file with a header.
   * Subsequent calls to logLLMStep/logLLMInput/logLLMOutput append to this file.
   */
  startLLMCallLog(symbolName: string, provider: string): void {
    if (!_llmLogDir) {
      return;
    }
    try {
      fs.mkdirSync(_llmLogDir, { recursive: true });
      _llmCallCounter++;
      const seq = String(_llmCallCounter).padStart(2, '0');
      const safeName = symbolName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${seq}-${safeName}-call.md`;
      _activeLLMLogFile = path.join(_llmLogDir, fileName);

      const header =
        `# LLM Call: ${symbolName}\n\n` +
        `- **Provider:** ${provider}\n` +
        `- **Started:** ${new Date().toISOString()}\n` +
        `- **Session:** ${_sessionId}\n\n` +
        `---\n\n` +
        `## Agent Progress\n\n`;

      fs.writeFileSync(_activeLLMLogFile, header, 'utf-8');
      emit(LogLevel.DEBUG, `LLM call log started: ${fileName}`, []);
    } catch {
      _activeLLMLogFile = undefined;
      emit(LogLevel.WARN, `Failed to start LLM call log for "${symbolName}"`, []);
    }
  },

  /**
   * Append a timestamped progress step to the active LLM log file.
   * Use this to trace what the agent is thinking/deciding at each stage.
   */
  logLLMStep(message: string): void {
    if (!_activeLLMLogFile) {
      return;
    }
    try {
      const line = `- \`${timestamp()}\` ${message}\n`;
      fs.appendFileSync(_activeLLMLogFile, line, 'utf-8');
    } catch {
      // silently skip
    }
  },

  /**
   * Append the full prompt (input) section to the active LLM log file.
   */
  logLLMInput(prompt: string): void {
    if (!_activeLLMLogFile) {
      return;
    }
    try {
      const section =
        `\n---\n\n` +
        `## Input (Prompt)\n\n` +
        '```\n' + prompt + '\n```\n\n';
      fs.appendFileSync(_activeLLMLogFile, section, 'utf-8');
    } catch {
      // silently skip
    }
  },

  /**
   * Append the full response (output) section to the active LLM log file.
   */
  logLLMOutput(response: string): void {
    if (!_activeLLMLogFile) {
      return;
    }
    try {
      const section =
        `---\n\n` +
        `## Output (Response)\n\n` +
        response + '\n';
      fs.appendFileSync(_activeLLMLogFile, section, 'utf-8');
      _activeLLMLogFile = undefined; // done with this log
    } catch {
      _activeLLMLogFile = undefined;
    }
  },
};
