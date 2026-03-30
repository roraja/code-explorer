# 32 - Process Monitor Web Server and Build Service LLM Provider

**Date**: 2026-03-30 05:15 UTC
**Prompt**: Create an independent web server that shows all running copilot/claude processes with live logs, process control (Ctrl+C, re-drive), stdin/stdout/stderr I/O visibility, and prompt detection. Also add support for using the Go build service HTTP API as an LLM provider alongside the existing CLI-based providers.

## 1. Code Reading & Analysis
- Read `src/utils/cli.ts` — understood the `runCLI()` utility for spawning CLI processes with stdin piping, timeout, and chunk callbacks
- Read `src/llm/CopilotCLIProvider.ts` — understood how copilot CLI is invoked with `--yolo -s --output-format text`
- Read `src/llm/MaiClaudeProvider.ts` — understood how claude CLI is invoked with `-p --output-format text` and `CLAUDECODE` env deletion
- Read `src/llm/LLMProvider.ts` — the interface: `name`, `isAvailable()`, `analyze(request)`, `getCapabilities()`, `setWorkspaceRoot?()`
- Read `src/llm/LLMProviderFactory.ts` — factory pattern creating providers from config string
- Read `src/llm/NullProvider.ts` — no-op reference implementation
- Read `src/models/types.ts` — `LLMAnalysisRequest` and `ProviderCapabilities` interfaces
- Read `src/models/constants.ts` — config keys under `codeExplorer.*` namespace
- Read `src/extension.ts` — wiring: `LLMProviderFactory.create(providerName)` → `setWorkspaceRoot()`
- Read `.context/FLOORPLAN.md` — overall architecture understanding
- Read `src/llm/CONTEXT.md` — provider architecture documentation
- Read Go build service API docs at `bd-build-service-go/docs/01-API-Signatures.md` — full API reference, especially `POST /api/v1/copilot/run` endpoint
- Read `dashboard/services/build_service_client.py` — Python reference client with polling, log streaming, and cancel patterns
- Inspected running processes via `ps aux`, `/proc/<pid>/status`, `/proc/<pid>/io`, `/proc/<pid>/cmdline`, `/proc/<pid>/cwd`, `/proc/<pid>/fd/`
- Analyzed process tree structure: `uv → python → claude` chains for mai-claude sessions
- Identified false positive processes (zsh shell-snapshot wrappers containing "claude" in args)

## 2. Issues Identified
- No web-based tool existed for monitoring copilot/claude processes
- No build-service-based LLM provider existed — only local CLI spawning
- Process discovery needed careful filtering to avoid false positives (zsh/bash shell wrappers that mention "claude" in args but aren't actual agent processes)
- `LLMProviderFactory.create()` didn't accept options for configuring the build service URL/model

## 3. Plan
### Process Monitor
- Create standalone Node.js web server at `tools/process-monitor/`
- Scan `/proc` filesystem for copilot/claude processes
- Group into sessions by process tree (uv → python → claude chains)
- Provide REST API + Server-Sent Events for live log streaming
- Use `strace` for real-time I/O capture
- Build full HTML/CSS/JS dashboard (single-file, no build step needed)
- Add build service jobs view by proxying to Go build service at localhost:8090

### Build Service Provider
- Create `BuildServiceProvider` implementing `LLMProvider` interface
- Use Node.js built-in `http`/`https` modules (no external dependencies)
- Submit prompts via `POST /api/v1/copilot/run`
- Poll for completion via `GET /api/v1/jobs/{id}/logs` with incremental streaming
- Handle timeout by cancelling via `POST /api/v1/jobs/{id}/cancel`
- Update factory to support `"build-service"` provider name
- Pass build service config options from `extension.ts`

## 4. Changes Made

### New Files

**`tools/process-monitor/package.json`** — Package manifest for the standalone process monitor
**`tools/process-monitor/server.js`** — Full process monitor implementation:
- Process discovery via `/proc` filesystem scanning
- Session grouping by process tree (parent-child chains)
- False-positive filtering (excludes zsh/bash wrappers, grep, etc.)
- REST API endpoints: `/api/processes`, `/api/process/:pid/prompt`, `/api/process/:pid/io`, `/api/process/:pid/logs`, `/api/process/:pid/signal`, `/api/process/:pid/redrive`, `/api/process/:pid/trace/start|stop`
- SSE endpoint for live log streaming: `/api/process/:pid/logs/stream`
- Build service proxy endpoints: `/api/build-service/jobs`, `/api/build-service/jobs/:id/logs`, `/api/build-service/jobs/:id/cancel`
- Full HTML/CSS/JS dashboard with GitHub-dark theme
- Process list sidebar with state indicators, type badges, TTY, RSS, flags
- Detail panel with tabs: Info & I/O, Live Logs, Prompt, Process Tree
- Build service jobs section with job list and detail view
- Process control buttons: Resume, Suspend, SIGTERM (Ctrl+C), SIGKILL, Re-drive
- Auto-refresh every 3 seconds

**`src/llm/BuildServiceProvider.ts`** — New LLM provider:
- Implements full `LLMProvider` interface
- `isAvailable()`: health check via `GET /api/v1/jobs`
- `analyze()`: submits to `POST /api/v1/copilot/run`, polls via `GET /api/v1/jobs/{id}/logs`
- Configurable: `baseUrl`, `model`, `agentBackend`, `pollIntervalMs`, `timeoutMs`
- `setWorkspaceRoot()`: derives `cr_src_folder` and `depot_tools_path`
- `setCrPaths()`: explicit chromium path setting
- Error handling: maps to `LLMError` hierarchy (timeout, unavailable, parse)
- Uses only built-in Node.js `http`/`https` modules — zero dependencies

### Modified Files

**`src/llm/LLMProviderFactory.ts`**:
- Before: only supported `copilot-cli`, `mai-claude`, `none`
- After: added `build-service` case, accepts optional `BuildServiceFactoryOptions` parameter
- Updated JSDoc with all supported provider names

**`src/extension.ts`**:
- Before: `LLMProviderFactory.create(llmProviderName)`
- After: `LLMProviderFactory.create(llmProviderName, { baseUrl, model, agentBackend })` reading from config

**`src/llm/CONTEXT.md`**:
- Added `BuildServiceProvider.ts` to modules table
- Updated provider architecture section with HTTP transport description
- Updated provider comparison table with 3 providers

## 5. Commands Run
- `npx tsc --noEmit` — TypeScript type check → 1 error (unused `resp` variable) → fixed → clean
- `npm run build` — Extension + webview build → success (extension: 225.8kb, webview: 2.8mb)
- `npm run lint` — ESLint → clean (no errors)
- `npm run test:unit` — 223 tests passing
- `node server.js --port 9100` — Process monitor server test → discovered 45 sessions (42 mai-claude, 3 copilot) + 1418 build service jobs
- `curl http://localhost:9100/api/processes` — API test → correct JSON response
- `curl http://localhost:9100/api/build-service/jobs` — Build service proxy test → 1418 jobs returned
- `curl http://localhost:9100/` — HTML UI test → 38KB page served correctly

## 6. Result
Both deliverables are complete and working:

1. **Process Monitor** (`tools/process-monitor/`): Standalone Node.js web server on port 9100 that provides a full dashboard for monitoring copilot/claude processes. Start with `node tools/process-monitor/server.js`. Features:
   - Real-time process discovery from /proc filesystem
   - Live stdout/stderr/stdin capture via strace
   - Process control (SIGTERM, SIGKILL, SIGTSTP, SIGCONT, re-drive)
   - Prompt detection from /tmp files, LLM logs, and cmdline args
   - I/O statistics from /proc/<pid>/io
   - Process tree visualization
   - Build service jobs view (proxied from Go build service at localhost:8090)
   - Auto-refresh every 3 seconds

2. **Build Service Provider** (`src/llm/BuildServiceProvider.ts`): New LLM provider that uses the Go build service HTTP API instead of spawning local CLI processes. Set `codeExplorer.llmProvider: "build-service"` to use it. Configurable via `codeExplorer.buildServiceUrl`, `codeExplorer.buildServiceModel`, `codeExplorer.buildServiceAgentBackend`.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| tools/process-monitor/package.json | Created | Package manifest for process monitor tool |
| tools/process-monitor/server.js | Created | Full process monitor web server with HTML dashboard |
| src/llm/BuildServiceProvider.ts | Created | HTTP-based LLM provider using Go build service API |
| src/llm/LLMProviderFactory.ts | Modified | Added "build-service" provider support with options |
| src/extension.ts | Modified | Pass build service config options to factory |
| src/llm/CONTEXT.md | Modified | Documented BuildServiceProvider and updated provider table |
