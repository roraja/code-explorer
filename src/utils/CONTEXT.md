# src/utils/

Shared utilities used across the extension host.

## Modules

| File | Role |
|------|------|
| `logger.ts` | Dual-output logger: VS Code OutputChannel + daily log files. Also manages per-LLM-call markdown log files. |
| `cli.ts` | `runCLI()` utility for spawning CLI processes with stdin piping, manual timeout, configurable cwd, and env overrides. |

## Logger

Singleton-style module (not a class). Must call `logger.init(workspaceRoot)` during activation.

### Output Destinations

1. **VS Code OutputChannel** — visible in Output panel as "Code Explorer"
2. **Daily log file** — `<workspace>/.vscode/code-explorer/logs/YYYY-MM-DD.log`
3. **Per-LLM-call markdown** — `<workspace>/.vscode/code-explorer/logs/llms/NN-symbolName-call.md`

### Log Levels

`DEBUG` (0) < `INFO` (1) < `WARN` (2) < `ERROR` (3)

The output channel respects the configured level. File logs capture everything regardless of level.

### LLM Call Logging

Each LLM analysis creates a dedicated markdown file with:
- Header (provider, timestamp, session)
- Agent progress (timestamped steps via `logLLMStep()`)
- Input prompt (via `logLLMInput()`)
- Real-time output chunks (via `logLLMChunk()`)
- Full response (via `logLLMOutput()`)

## CLI Runner (`runCLI()`)

Spawns a CLI process and returns stdout as a string.

```typescript
interface CLIRunOptions {
  command: string;          // e.g. 'claude', 'copilot'
  args: string[];
  stdinData: string;        // Prompt piped via stdin
  timeoutMs?: number;       // Default: 900000 (15 min)
  envOverrides?: Record<string, string | undefined>;  // undefined = delete key
  cwd?: string;             // Working directory (defaults to process.cwd())
  label: string;            // For log messages
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}
```

### Key Implementation Details

- Uses `spawn()` (not `exec()`/`execFile()`) for streaming output
- `cwd` option allows running CLI tools in the workspace directory for full workspace context
- Manual timeout via `setTimeout` + `child.kill('SIGTERM')` (spawn doesn't support timeout)
- `settled` boolean guard prevents double-resolve/reject
- Periodic "still waiting" log every 15 seconds
- Stdin is written then closed (`child.stdin.write()` + `child.stdin.end()`)

## Do NOT

- Use `console.log` anywhere in the extension — use `logger.*` methods
- Pass large prompts as CLI arguments — use stdin via `runCLI()`
- Call `logger.init()` more than once per activation
