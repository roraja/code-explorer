/**
 * Code Explorer — Null Logger
 *
 * ILogger implementation that discards all output.
 * Used in tests to keep output silent.
 */
import type { ILogger } from './ILogger';

export class NullLogger implements ILogger {
  debug(_msg: string): void {}
  info(_msg: string): void {}
  warn(_msg: string): void {}
  error(_msg: string): void {}
  startLLMCallLog(_symbolName: string, _providerName: string): void {}
  logLLMStep(_msg: string): void {}
  logLLMInput(_prompt: string): void {}
  logLLMOutput(_response: string): void {}
  logLLMChunk(_chunk: string): void {}
  startCommandLog(_commandName: string): void {}
  endCommandLog(): void {}
}
