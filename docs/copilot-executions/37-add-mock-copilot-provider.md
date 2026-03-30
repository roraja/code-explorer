# 37 - Add Mock-Copilot LLM Provider

**Date**: 2026-03-30 14:40 UTC
**Prompt**: Add a new LLM provider along with build service, copilot called mock-copilot. This is a mock executable nodejs script which is a mock AI agent aimed at testing this app. Given a prompt, the mock AI agent will reply with a document which has the input prompt, date of call, any input arguments provided to the AI agent. It will resolve in 3 seconds (configurable via settings).

## 1. Code Reading & Analysis

Files read to understand the architecture:
- `.context/FLOORPLAN.md` — Routing table for all modules
- `src/llm/CONTEXT.md` — LLM provider architecture and conventions
- `src/llm/LLMProvider.ts` (lines 1-13) — `LLMProvider` interface: `name`, `isAvailable()`, `analyze()`, `getCapabilities()`, `setWorkspaceRoot?()`
- `src/llm/CopilotCLIProvider.ts` (lines 1-125) — Reference implementation for CLI-based provider, uses `runCLI()` utility
- `src/llm/MaiClaudeProvider.ts` (lines 1-111) — Second CLI provider, similar pattern
- `src/llm/BuildServiceProvider.ts` (lines 1-445) — HTTP-based provider, different transport
- `src/llm/NullProvider.ts` (lines 1-33) — No-op provider when disabled
- `src/llm/LLMProviderFactory.ts` (lines 1-59) — Factory that creates providers from config strings
- `src/extension.ts` (lines 1-609) — Extension entry point, wiring of LLM provider via factory
- `src/models/constants.ts` (lines 1-101) — CONFIG keys
- `src/models/types.ts` (lines 1-771) — Core types including `LLMAnalysisRequest`, `ProviderCapabilities`
- `src/models/errors.ts` (lines 1-161) — Error hierarchy with `LLMError`, `ErrorCode`
- `src/utils/cli.ts` (lines 1-242) — Shared `runCLI()` utility for spawning CLI processes
- `package.json` (lines 1-333) — Settings schema, enum for llmProvider
- `test/unit/llm/BuildServiceProvider.test.ts` (lines 1-873) — Test patterns (Mocha TDD, `suite`/`test`)

Key patterns identified:
- CLI providers use `runCLI()` utility from `src/utils/cli.ts` for stdin piping and timeout handling
- Providers implement `LLMProvider` interface with `name`, `isAvailable()`, `analyze()`, `getCapabilities()`, optional `setWorkspaceRoot()`
- Factory maps config string → provider instance
- package.json has enum for provider selection + per-provider settings
- Tests use Mocha TDD UI with `assert` module

## 2. Issues Identified

No issues — this is a new feature addition.

## 3. Plan

Create a mock-copilot LLM provider with:
1. **`tools/mock-copilot.js`** — Executable Node.js script that reads stdin, waits configurable delay, outputs structured markdown response echoing prompt/args/timestamp
2. **`src/llm/MockCopilotProvider.ts`** — LLM provider that spawns `node tools/mock-copilot.js` via `runCLI()`
3. **`src/llm/LLMProviderFactory.ts`** — Register `mock-copilot` case
4. **`package.json`** — Add `mock-copilot` to enum, add `codeExplorer.mockCopilotDelayMs` setting
5. **`src/models/constants.ts`** — Add `MOCK_COPILOT_DELAY_MS` config key
6. **`src/extension.ts`** — Pass mock-copilot options to factory
7. **`test/unit/llm/MockCopilotProvider.test.ts`** — Comprehensive unit tests

The mock script outputs structured markdown with `json:symbol_identity`, `json:steps`, `json:diagrams` blocks so the response can be parsed by `ResponseParser` just like real LLM output.

## 4. Changes Made

### `tools/mock-copilot.js` (Created)
- Executable Node.js script with `#!/usr/bin/env node` shebang
- Reads prompt from stdin
- Accepts `--delay <ms>` CLI arg (also `MOCK_COPILOT_DELAY_MS` env var)
- After configurable delay (default 3000ms), outputs structured markdown:
  - `### Overview` — mock analysis description with symbol name, timestamp, prompt length, CLI args
  - `### Key Points` — summary items
  - `### Potential Issues` — notes about mock nature
  - `json:symbol_identity` — extracted from prompt context (word/kind patterns)
  - `json:callers`, `json:steps`, `json:subfunctions` — empty/minimal mock data
  - `json:diagrams` — simple flowchart diagram
  - Mock Metadata table and Input Prompt Preview
- Tries to extract symbol name and kind from prompt using regex patterns

### `src/llm/MockCopilotProvider.ts` (Created)
- Implements `LLMProvider` interface
- `name = 'mock-copilot'`
- `isAvailable()` — checks if `tools/mock-copilot.js` exists at resolved path
- `analyze()` — uses `runCLI()` to spawn `node tools/mock-copilot.js --delay <ms> --output-format text` with prompt on stdin
- `getCapabilities()` — returns `{ maxContextTokens: 128_000, supportsStreaming: false, costPerMTokenInput: 0, costPerMTokenOutput: 0 }`
- `setWorkspaceRoot()`, `setExtensionRoot()`, `setDelayMs()` — configuration setters
- `_getScriptPath()` — resolves script path from extensionRoot, workspaceRoot, or __dirname fallback
- Error handling follows same pattern as CopilotCLIProvider (LLMError hierarchy)
- Prepends system prompt same way as CopilotCLIProvider

### `src/llm/LLMProviderFactory.ts` (Modified)
- Added `import { MockCopilotProvider }`
- Added `MockCopilotFactoryOptions` interface (`delayMs?`, `extensionRoot?`)
- Added third parameter `mockCopilotOptions?` to `create()` method
- Added `case 'mock-copilot':` that creates `MockCopilotProvider` with options
- Updated file header comment to list mock-copilot

### `package.json` (Modified)
- Added `"mock-copilot"` to `codeExplorer.llmProvider` enum
- Added enum description: `"Use mock AI agent for testing (node tools/mock-copilot.js)"`
- Added new setting `codeExplorer.mockCopilotDelayMs`:
  - type: number, default: 3000, min: 0, max: 60000
  - description: "Response delay in milliseconds for the mock-copilot provider"

### `src/models/constants.ts` (Modified)
- Added `MOCK_COPILOT_DELAY_MS: 'codeExplorer.mockCopilotDelayMs'` to CONFIG object

### `src/extension.ts` (Modified)
- Updated `LLMProviderFactory.create()` call to pass mock-copilot options:
  - `delayMs: config.get<number>('mockCopilotDelayMs', 3000)`
  - `extensionRoot: context.extensionUri.fsPath`

### `test/unit/llm/MockCopilotProvider.test.ts` (Created)
20 tests covering:
- Constructor defaults and option overrides (2 tests)
- setWorkspaceRoot does not throw (1 test)
- setDelayMs updates delay (1 test)
- isAvailable returns true when script exists (1 test)
- isAvailable returns false for bad path (1 test)
- getCapabilities returns expected shape (1 test)
- analyze returns structured mock response (1 test)
- analyze echoes back prompt content (1 test)
- analyze includes timestamp (1 test)
- analyze includes json:symbol_identity block (1 test)
- analyze includes json:steps block (1 test)
- analyze includes json:diagrams block (1 test)
- analyze prepends systemPrompt (1 test)
- analyze extracts symbol name from prompt (1 test)
- analyze respects configurable delay (1 test)
- analyze responds quickly with delay=0 (1 test)
- Factory creates MockCopilotProvider (1 test)
- Factory creates with defaults (1 test)
- Factory existing providers still work (1 test)

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Success — dist/extension.js (231.7kb), webview/dist/main.js (2.8mb) |
| `npm run lint` | ✅ Pass — no warnings or errors |
| `TS_NODE_PROJECT=tsconfig.test.json npx mocha test/unit/llm/MockCopilotProvider.test.ts` | ✅ All 268 tests passing (including 20 new) |
| `echo "test" \| node tools/mock-copilot.js --delay 0` | ✅ Script produces structured markdown output |
| `chmod +x tools/mock-copilot.js` | ✅ Made script executable |

## 6. Result

Successfully added mock-copilot as a new LLM provider:
- **Mock executable**: `tools/mock-copilot.js` — standalone Node.js script that simulates an AI agent
- **LLM provider**: `MockCopilotProvider` — fully integrated into the extension's provider architecture
- **Configurable delay**: `codeExplorer.mockCopilotDelayMs` setting (default 3000ms, 0-60000ms range)
- **Response format**: Produces structured markdown with all expected JSON blocks (`symbol_identity`, `steps`, `diagrams`, etc.) that `ResponseParser` can parse
- **Test coverage**: 20 unit tests covering constructor, availability, analysis, timing, and factory integration
- All 268 tests pass, build succeeds, lint passes

The mock provider can be selected via `codeExplorer.llmProvider: "mock-copilot"` in VS Code settings, enabling deterministic testing of the entire analysis pipeline without requiring a real LLM.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `tools/mock-copilot.js` | Created | Mock AI agent executable script — reads stdin, delays, outputs structured markdown |
| `src/llm/MockCopilotProvider.ts` | Created | LLM provider that spawns mock-copilot.js via runCLI() |
| `src/llm/LLMProviderFactory.ts` | Modified | Added mock-copilot case + MockCopilotFactoryOptions |
| `package.json` | Modified | Added mock-copilot to enum + mockCopilotDelayMs setting |
| `src/models/constants.ts` | Modified | Added MOCK_COPILOT_DELAY_MS config key |
| `src/extension.ts` | Modified | Pass mock-copilot options to factory create() |
| `test/unit/llm/MockCopilotProvider.test.ts` | Created | 20 unit tests for provider + factory integration |
