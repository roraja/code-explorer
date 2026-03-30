/**
 * Code Explorer — Console Logger
 *
 * ILogger implementation that writes to stderr.
 * Used outside VS Code (CLI tool).
 */
import type { ILogger } from './ILogger';

export class ConsoleLogger implements ILogger {
  debug(msg: string): void {
    process.stderr.write(`[DEBUG] ${msg}\n`);
  }

  info(msg: string): void {
    process.stderr.write(`[INFO ] ${msg}\n`);
  }

  warn(msg: string): void {
    process.stderr.write(`[WARN ] ${msg}\n`);
  }

  error(msg: string): void {
    process.stderr.write(`[ERROR] ${msg}\n`);
  }

  startLLMCallLog(_symbolName: string, _providerName: string): void {
    // no-op
  }

  logLLMStep(_msg: string): void {
    // no-op
  }

  logLLMInput(_prompt: string): void {
    // no-op
  }

  logLLMOutput(_response: string): void {
    // no-op
  }

  logLLMChunk(_chunk: string): void {
    // no-op
  }

  startCommandLog(_commandName: string): void {
    // no-op
  }

  endCommandLog(): void {
    // no-op
  }
}
