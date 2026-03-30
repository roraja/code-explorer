/**
 * Code Explorer — Logger Interface
 *
 * Abstracts VS-Code-coupled logging so the analysis pipeline
 * can run outside VS Code (CLI, tests, MCP server).
 *
 * Implementations:
 *   - VscodeLogger   — OutputChannel + file logs (extension host)
 *   - ConsoleLogger  — stderr (CLI)
 *   - NullLogger     — discards all output (silent tests)
 */
export interface ILogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;

  /** Start a per-LLM-call log file. No-op in simple implementations. */
  startLLMCallLog(symbolName: string, providerName: string): void;
  /** Append a progress step to the active LLM log. */
  logLLMStep(msg: string): void;
  /** Append the full prompt to the active LLM log. */
  logLLMInput(prompt: string): void;
  /** Append the full response to the active LLM log and close it. */
  logLLMOutput(response: string): void;
  /** Append a raw stdout chunk to the active LLM log. */
  logLLMChunk(chunk: string): void;

  /** Start a per-command log file. No-op in simple implementations. */
  startCommandLog(commandName: string): void;
  /** End the active per-command log file. */
  endCommandLog(): void;
}
