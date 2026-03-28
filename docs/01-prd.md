# Product Requirements Document: Code Explorer

**VS Code Extension for AI-Powered Code Intelligence**

| Field              | Value                                      |
| ------------------ | ------------------------------------------ |
| **Document Owner** | Code Explorer Team                         |
| **Status**         | Draft                                      |
| **Version**        | 1.0                                        |
| **Created**        | 2026-03-28                                 |
| **Last Updated**   | 2026-03-28                                 |
| **Target Release** | Q3 2026 (Phase 1)                          |
| **Platform**       | Visual Studio Code (v1.85+)                |
| **Language**       | TypeScript                                 |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users and Personas](#3-target-users-and-personas)
4. [User Stories](#4-user-stories)
5. [Feature Requirements](#5-feature-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [System Architecture Overview](#7-system-architecture-overview)
8. [Success Metrics and KPIs](#8-success-metrics-and-kpis)
9. [Risks and Mitigations](#9-risks-and-mitigations)
10. [Out of Scope and Future Considerations](#10-out-of-scope-and-future-considerations)
11. [Dependencies](#11-dependencies)
12. [Timeline and Milestones](#12-timeline-and-milestones)
13. [Appendix](#13-appendix)

---

## 1. Executive Summary

Code Explorer is a TypeScript-based Visual Studio Code extension that delivers deep, AI-powered code intelligence through an intuitive sidebar panel. By combining static analysis with LLM-driven understanding, Code Explorer helps developers rapidly comprehend unfamiliar codebases, trace complex call hierarchies, analyze data flow, and explore class/function/variable relationships -- all without leaving their editor.

The extension occupies a dedicated sidebar (similar to Copilot Chat or the Source Control panel) and provides a tabbed, interactive interface. When a developer clicks or hovers on a symbol -- a class, function, or variable -- Code Explorer instantly presents contextual intelligence: what the symbol is, where it is used, its call stacks, its data flow lifecycle, and its relationships within the broader codebase. Results are powered by LLM analysis (via `mai-claude` or Copilot CLI), intelligently cached in the workspace for near-instant subsequent lookups, and structured so that both humans and AI coding agents can consume them.

### Why Now

- **Codebases are growing**: The average enterprise project spans hundreds of thousands of lines across dozens of services. Developers spend up to 60% of their time reading and understanding code rather than writing it.
- **AI tooling has matured**: LLMs can now produce reliable, structured code analysis at a cost and latency that makes on-demand analysis practical.
- **Agent-assisted development is emerging**: AI coding agents (Copilot, Claude Code, Cursor) need structured codebase context to be effective. Code Explorer creates that context layer.

### Key Differentiators

| Capability                          | VS Code Built-in | Code Explorer |
| ----------------------------------- | :---------------: | :-----------: |
| Basic Go-to-Definition              |        Yes        |      Yes      |
| Full call-stack visualization        |     Limited       |      Yes      |
| Data flow / variable lifecycle       |        No         |      Yes      |
| LLM-powered semantic analysis       |        No         |      Yes      |
| Persistent, cacheable results       |        No         |      Yes      |
| MCP server for AI agent consumption |        No         |   Planned     |

---

## 2. Problem Statement

### The Core Challenge

Modern software development involves navigating increasingly complex, interconnected codebases. Developers joining a new team, investigating a bug in an unfamiliar service, or performing a cross-cutting refactor face a common set of frustrations:

1. **Understanding "what calls what" is manual and slow.** VS Code provides basic "Find All References" and "Go to Definition," but tracing a multi-level call stack -- especially across files and modules -- requires opening dozens of tabs, mentally reconstructing the flow, and often losing context along the way.

2. **Data flow is invisible.** When a developer clicks on a variable, they can see its declaration and assignments, but they cannot easily answer: "Where is this value created? What transforms it? Where is it ultimately consumed?" This is critical for debugging state-related issues and understanding data pipelines.

3. **Class and function relationships are fragmented.** Inheritance hierarchies, interface implementations, usage patterns, and dependency graphs are scattered across files. Assembling a mental model requires significant time and cognitive load.

4. **Existing tools lack semantic understanding.** Static analysis tools can trace syntax-level references but cannot explain *why* a function is called, *what pattern* a class implements, or *how* a variable flows through business logic. LLMs can provide this understanding, but there is no integrated way to invoke and cache such analysis in the editor.

5. **AI coding agents lack structured codebase context.** When developers ask Copilot or Claude Code to fix a bug or implement a feature, the agent must independently discover codebase structure -- often poorly. A pre-computed, structured knowledge layer would dramatically improve agent effectiveness.

### Impact

| Pain Point                        | Time Cost per Occurrence | Frequency (per dev/week) |
| --------------------------------- | :----------------------: | :----------------------: |
| Tracing a call stack manually     |        15-30 min         |          5-10x           |
| Understanding a new class/module  |        30-60 min         |          3-5x            |
| Debugging data flow issues        |        20-45 min         |          3-7x            |
| Onboarding to an unfamiliar repo  |        4-8 hours         |        1-2x/month        |
| Providing context to AI agents    |        10-20 min         |         10-20x           |

**Estimated developer time savings: 3-6 hours per developer per week.**

---

## 3. Target Users and Personas

### Persona 1: The New Team Member ("Neha")

| Attribute       | Detail                                                              |
| --------------- | ------------------------------------------------------------------- |
| **Role**        | Mid-level Software Engineer                                         |
| **Experience**  | 3 years, recently joined a new team                                 |
| **Pain Points** | Unfamiliar with the codebase; spends most of the day reading code; frequently asks teammates for context; struggles to trace request flows |
| **Goals**       | Become productive quickly; build a mental model of the architecture; reduce reliance on teammates for basic questions |
| **Tech Stack**  | TypeScript, React, Node.js                                          |

### Persona 2: The Senior Debugger ("David")

| Attribute       | Detail                                                              |
| --------------- | ------------------------------------------------------------------- |
| **Role**        | Senior Software Engineer                                            |
| **Experience**  | 8 years, deep expertise in the codebase                             |
| **Pain Points** | Investigating complex, cross-cutting bugs; needs to trace data flow across services; wants faster root-cause analysis |
| **Goals**       | Quickly identify where a value is mutated; trace error propagation paths; validate assumptions about call order |
| **Tech Stack**  | Python, Go, TypeScript                                              |

### Persona 3: The Tech Lead / Reviewer ("Priya")

| Attribute       | Detail                                                              |
| --------------- | ------------------------------------------------------------------- |
| **Role**        | Tech Lead / Staff Engineer                                          |
| **Experience**  | 10+ years, reviews PRs and designs systems                          |
| **Pain Points** | Needs to quickly understand the blast radius of a change; validates that callers are not broken; assesses architectural impact |
| **Goals**       | Faster PR reviews; confident refactoring decisions; clear understanding of dependency graphs |
| **Tech Stack**  | Multi-language, large monorepo                                      |

### Persona 4: The AI-Augmented Developer ("Alex")

| Attribute       | Detail                                                              |
| --------------- | ------------------------------------------------------------------- |
| **Role**        | Full-stack Engineer, heavy AI tooling user                          |
| **Experience**  | 5 years, uses Copilot and Claude Code daily                         |
| **Pain Points** | AI agents produce better results when given structured context, but manually assembling that context is tedious |
| **Goals**       | Feed rich, pre-computed codebase intelligence to AI agents; reduce prompt engineering overhead; get higher-quality AI-generated code |
| **Tech Stack**  | TypeScript, Python, uses MCP-compatible agents                      |

---

## 4. User Stories

### US-01: Class Overview on Click

> **As** a developer exploring an unfamiliar codebase,
> **I want** to click on a class name in the editor and see a summary of what the class does, where it is used, and its top call stacks in the sidebar,
> **so that** I can quickly understand the class's purpose and role without manually searching through files.

**Acceptance Criteria:**
- Clicking on a class name (or right-click -> "Explore in Code Explorer") opens or focuses the Code Explorer sidebar.
- A new tab is created in the sidebar for the clicked class (or an existing tab is focused if one already exists for that class).
- The sidebar tab displays:
  - A one-paragraph AI-generated summary of the class's purpose.
  - A list of files/locations where the class is instantiated or referenced (top 10, with "show more" option).
  - The top 5 call stacks that involve this class, rendered as expandable tree views with context code snippets.
- If cached analysis exists, the result renders in under 500ms.
- If no cached analysis exists, a loading indicator is shown, the LLM analysis is triggered, and results appear within 30 seconds.

---

### US-02: Function Call Hierarchy

> **As** a developer debugging an issue,
> **I want** to click on a function and see its complete call hierarchy -- both callers (who calls this function) and callees (what this function calls),
> **so that** I can trace the execution path and identify where a problem might originate.

**Acceptance Criteria:**
- Clicking on a function name opens a Code Explorer tab for that function.
- The tab displays two sections: "Callers" (upstream) and "Callees" (downstream).
- Each entry in the hierarchy shows: the calling/called function name, the file and line number, and a 3-line code context snippet.
- The hierarchy is expandable to at least 5 levels deep.
- Clicking on any entry in the hierarchy navigates the editor to that location.
- The hierarchy includes cross-file references.

---

### US-03: Variable Lifecycle Explorer

> **As** a developer investigating a data-related bug,
> **I want** to click on a variable and see its complete lifecycle -- where it is created, where it is modified, and where it is consumed,
> **so that** I can understand the flow of data and identify where an unexpected mutation might occur.

**Acceptance Criteria:**
- Clicking on a variable opens a Code Explorer tab with a "Variable Lifecycle" view.
- The lifecycle view shows three categorized sections:
  - **Creation**: Where the variable is first declared/initialized.
  - **Modifications**: All locations where the variable's value is changed (assignments, mutations, method calls that modify it).
  - **Consumption**: All locations where the variable's value is read/used.
- Each entry includes file name, line number, and a code context snippet.
- Modifications are listed in execution-order where determinable.
- The view distinguishes between direct mutations and mutations through references/aliases.

---

### US-04: Multi-Tab Navigation

> **As** a developer exploring multiple symbols simultaneously,
> **I want** to have multiple tabs open in the Code Explorer sidebar (one per explored symbol),
> **so that** I can switch between different exploration contexts without losing my place.

**Acceptance Criteria:**
- Each explored symbol (class, function, variable) opens in a separate tab within the sidebar.
- Tabs display the symbol name and its type icon (class, function, variable).
- The most recently opened tab auto-focuses.
- Tabs can be closed individually via a close button.
- A maximum of 10 tabs can be open simultaneously; opening an 11th closes the oldest tab (LRU eviction) with a brief notification.
- Tab state persists across VS Code restarts within the same workspace.

---

### US-05: Cached Analysis Lookup

> **As** a developer who has previously explored a symbol,
> **I want** subsequent clicks on the same symbol to load instantly from cache,
> **so that** I do not have to wait for AI analysis to re-run every time.

**Acceptance Criteria:**
- After the first LLM analysis for a symbol, the results are persisted to `<workspace-root>/.vscode/code-explorer/`.
- Subsequent clicks on the same symbol load from cache in under 500ms.
- The cache file includes metadata: analysis timestamp, hash of the analyzed source files, and the LLM model used.
- If the source file has changed since the last analysis (detected via file hash comparison), the cached result is displayed with a "Stale -- click to refresh" indicator.
- Refreshing a stale cache replaces the old cache file with updated results.

---

### US-06: Hover Quick Peek

> **As** a developer who wants a quick summary without full sidebar exploration,
> **I want** to hover over a symbol and see a compact tooltip with AI-generated intelligence,
> **so that** I can get quick context without disrupting my workflow.

**Acceptance Criteria:**
- Hovering over a class, function, or variable for 800ms shows an enhanced tooltip (in addition to VS Code's default hover).
- The tooltip includes: a one-line AI-generated summary and a "usage count" (number of references).
- The tooltip includes a "Open in Code Explorer" link that opens the full sidebar view.
- The tooltip only appears if cached analysis exists (no LLM calls triggered on hover).
- The tooltip disappears when the cursor moves away, consistent with VS Code hover behavior.

---

### US-07: Data Flow Analysis

> **As** a developer tracing how data moves through the application,
> **I want** to see a visual data flow diagram for a selected variable or function return value,
> **so that** I can understand the transformation pipeline and identify where data is shaped.

**Acceptance Criteria:**
- From any variable or function return value tab, a "Data Flow" section is available.
- The data flow is rendered as a vertical list of steps: source -> transformation 1 -> transformation 2 -> ... -> sink.
- Each step shows the function/expression that transforms the data, the file/line, and a code snippet.
- Clicking on any step navigates the editor to that location.
- Data flow analysis spans across function boundaries (inter-procedural).
- The analysis identifies common patterns: map/filter/reduce chains, API response shaping, state updates.

---

### US-08: Inheritance and Interface Exploration

> **As** a developer working with an object-oriented codebase,
> **I want** to click on a class and see its inheritance hierarchy, implemented interfaces, and sibling classes,
> **so that** I can understand the type system and find related implementations.

**Acceptance Criteria:**
- The class exploration tab includes an "Inheritance" section.
- The section shows: parent class(es), implemented interfaces, and child classes (direct subclasses).
- Each entry is clickable, opening a new Code Explorer tab for that symbol.
- A compact tree visualization shows the hierarchy (up to 5 levels).
- Interface exploration shows all classes that implement the interface.
- The view highlights abstract/virtual methods and their concrete implementations.

---

### US-09: Background Periodic Analysis

> **As** a developer who wants Code Explorer data to be available proactively,
> **I want** the extension to periodically scan the codebase in the background and pre-populate analysis caches,
> **so that** exploration results are available instantly when I need them.

**Acceptance Criteria:**
- The extension runs a background analysis job that can be configured (enabled/disabled, frequency, scope).
- The background job processes changed files since the last run (detected via Git diff or file modification times).
- The job prioritizes files that the developer has recently opened or edited.
- Background analysis respects system resource limits: CPU usage stays below 10% during analysis, and the job can be paused/cancelled.
- A status bar indicator shows background analysis progress (e.g., "Code Explorer: Analyzing 12/47 files...").
- The user can trigger a manual full re-analysis via a command palette command.

---

### US-10: Cache Browsing and Management

> **As** a developer or AI coding agent,
> **I want** the cached analysis to be stored as human-readable markdown files in a well-organized directory structure,
> **so that** I can browse, search, and consume the analysis results outside of the extension.

**Acceptance Criteria:**
- All cached analysis is stored in `<workspace-root>/.vscode/code-explorer/`.
- The directory structure mirrors the source file structure: `.vscode/code-explorer/src/services/UserService.ts.md` contains analysis for `src/services/UserService.ts`.
- Each markdown file includes:
  - A YAML front-matter block with metadata (analysis date, file hash, model used, symbols analyzed).
  - Sections for each analyzed symbol (classes, functions, variables) with structured headings.
  - Call stacks, usage lists, and data flow in a consistent, parseable format.
- A root index file (`.vscode/code-explorer/index.json`) maps symbols to their cache file paths.
- Cache files are valid markdown that renders correctly in any markdown viewer.

---

### US-11: Context Menu Integration

> **As** a developer who prefers right-click workflows,
> **I want** to right-click on any symbol in the editor and see "Explore in Code Explorer" in the context menu,
> **so that** I can trigger analysis through my preferred interaction pattern.

**Acceptance Criteria:**
- A context menu item "Explore in Code Explorer" appears when right-clicking on a class, function, or variable name.
- The context menu item is grouped under a "Code Explorer" submenu if multiple options exist (e.g., "Explore Class," "Explore Function," "Explore Variable").
- Selecting the menu item opens the sidebar and creates/focuses the appropriate tab.
- The context menu item is only visible when the cursor is positioned on a recognized symbol (not on whitespace or comments).

---

### US-12: Extension Configuration

> **As** a developer with specific preferences,
> **I want** to configure Code Explorer's behavior through VS Code settings,
> **so that** I can control analysis frequency, LLM provider, cache behavior, and UI preferences.

**Acceptance Criteria:**
- The following settings are available in VS Code Settings (under "Code Explorer"):

| Setting                                  | Type    | Default            | Description                                      |
| ---------------------------------------- | ------- | ------------------ | ------------------------------------------------ |
| `codeExplorer.llm.provider`             | enum    | `mai-claude`       | LLM provider: `mai-claude`, `copilot-cli`, `custom` |
| `codeExplorer.llm.model`               | string  | `claude-sonnet`    | Model identifier for the selected provider       |
| `codeExplorer.cache.enabled`            | boolean | `true`             | Enable/disable analysis caching                  |
| `codeExplorer.cache.staleThresholdHours`| number  | `72`               | Hours before cached data is marked as stale      |
| `codeExplorer.background.enabled`       | boolean | `true`             | Enable/disable background analysis               |
| `codeExplorer.background.intervalMinutes`| number | `30`               | Interval between background analysis runs        |
| `codeExplorer.ui.maxTabs`              | number  | `10`               | Maximum number of open sidebar tabs              |
| `codeExplorer.ui.hoverEnabled`         | boolean | `true`             | Enable/disable hover quick peek                  |
| `codeExplorer.analysis.maxDepth`       | number  | `5`                | Maximum call hierarchy depth                     |
| `codeExplorer.analysis.excludePatterns`| array   | `[node_modules, dist, build]` | Glob patterns for files to exclude     |

- All settings can be configured at the workspace and user level.
- Changes to settings take effect without requiring an extension reload.

---

## 5. Feature Requirements

### P0 -- Must Have (MVP)

These features are required for the initial release and represent the core value proposition.

| ID    | Feature                          | Description                                                                                                     | User Stories |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------ |
| P0-01 | **Sidebar Panel**                | A dedicated sidebar view container (like Source Control) with the Code Explorer icon in the activity bar.        | US-04        |
| P0-02 | **Tabbed Interface**             | Multi-tab support within the sidebar, with auto-focus on most recent tab, close buttons, and LRU eviction.      | US-04        |
| P0-03 | **Class Exploration**            | Click on a class name to see: AI summary, usage locations, top 5 call stacks. Rendered in a sidebar tab.        | US-01        |
| P0-04 | **Function Call Hierarchy**      | Click on a function to see callers and callees in an expandable tree view, with code context snippets.          | US-02        |
| P0-05 | **Variable Lifecycle Explorer**  | Click on a variable to see creation, modification, and consumption locations with code context.                 | US-03        |
| P0-06 | **LLM Analysis Engine**          | Integration with `mai-claude` or Copilot CLI to generate structured analysis for clicked symbols.               | US-01, US-02, US-03 |
| P0-07 | **Analysis Caching**             | Persist analysis results to `.vscode/code-explorer/` as structured markdown files with metadata.                | US-05, US-10 |
| P0-08 | **Stale Cache Detection**        | Detect when source files have changed since last analysis via file hashing; show "stale" indicator.             | US-05        |
| P0-09 | **Context Menu Integration**     | Right-click "Explore in Code Explorer" menu item for classes, functions, and variables.                         | US-11        |
| P0-10 | **Editor Navigation**            | Clicking on any reference in the sidebar navigates the editor to that file and line.                            | US-01, US-02, US-03 |

### P1 -- Should Have (v1.1)

These features significantly enhance the user experience and are expected shortly after initial release.

| ID    | Feature                          | Description                                                                                                     | User Stories |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------ |
| P1-01 | **Hover Quick Peek**             | Enhanced hover tooltip with AI summary and usage count for symbols with cached analysis.                        | US-06        |
| P1-02 | **Data Flow Analysis**           | Visual data flow rendering showing source -> transformations -> sink for variables and return values.            | US-07        |
| P1-03 | **Inheritance Explorer**         | Visualize inheritance hierarchies, interface implementations, and sibling classes for OOP codebases.            | US-08        |
| P1-04 | **Background Periodic Analysis** | Configurable background job that pre-populates analysis caches for changed files.                               | US-09        |
| P1-05 | **Extension Settings**           | Full VS Code settings integration for LLM provider, cache behavior, UI preferences, and analysis configuration. | US-12        |
| P1-06 | **Cache Index**                  | A root `index.json` file mapping all analyzed symbols to their cache file paths for fast lookup.                | US-10        |
| P1-07 | **Tab State Persistence**        | Persist open tabs and their state across VS Code restarts within the same workspace.                            | US-04        |
| P1-08 | **Status Bar Integration**       | Status bar item showing analysis status (idle, analyzing, error) and quick access to commands.                  | US-09        |

### P2 -- Nice to Have (Future)

These features add polish and extend the platform for advanced use cases.

| ID    | Feature                          | Description                                                                                                     | User Stories |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------ |
| P2-01 | **MCP Server**                   | An MCP server exposing Code Explorer's cached analysis to AI coding agents (Copilot, Claude Code).             | --           |
| P2-02 | **Dependency Graph Visualization**| Interactive graph visualization of module/file dependencies rendered in a webview panel.                        | --           |
| P2-03 | **Multi-Language Support**       | Extend analysis beyond TypeScript/JavaScript to Python, Go, Java, C#, and Rust.                                | --           |
| P2-04 | **Team Sharing**                 | Share cached analysis via Git (commit `.vscode/code-explorer/` files) so teammates benefit from prior analysis. | --           |
| P2-05 | **Analysis History**             | Track how a symbol's usage has changed over time (diff between analysis snapshots).                             | --           |
| P2-06 | **Custom LLM Provider**          | Allow users to configure custom LLM endpoints (Azure OpenAI, local Ollama, etc.).                              | US-12        |
| P2-07 | **Search Across Analysis**       | Full-text search across all cached analysis files from within the sidebar.                                      | US-10        |
| P2-08 | **Keyboard Shortcuts**           | Configurable keyboard shortcuts for common actions (explore symbol under cursor, toggle sidebar, navigate tabs).| --           |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Requirement                              | Target                          | Measurement Method                        |
| ---------------------------------------- | ------------------------------- | ----------------------------------------- |
| Cached result render time                | < 500ms                         | Time from click to sidebar content render |
| LLM analysis turnaround (uncached)       | < 30 seconds                    | Time from trigger to result display       |
| Extension activation time                | < 2 seconds                     | VS Code extension activation event        |
| Background analysis CPU usage            | < 10% average                   | OS-level process monitoring               |
| Memory overhead (idle)                   | < 50 MB                         | VS Code process memory delta              |
| Memory overhead (active analysis)        | < 150 MB                        | VS Code process memory delta              |
| Sidebar tab switch time                  | < 100ms                         | Time from tab click to content render     |
| Cache index lookup time                  | < 50ms                          | Time from symbol query to cache path resolution |

### 6.2 Scalability

| Requirement                              | Target                          | Notes                                     |
| ---------------------------------------- | ------------------------------- | ----------------------------------------- |
| Maximum workspace size                   | 500,000 lines of code           | Larger workspaces supported with exclude patterns |
| Maximum cached symbols                   | 10,000 symbols                  | Limited by disk space, not by extension    |
| Maximum concurrent analyses              | 3 parallel LLM requests         | Configurable; prevents rate limiting       |
| Maximum open tabs                        | 10 (configurable up to 20)      | LRU eviction for excess tabs               |
| Cache storage size                       | < 100 MB for 10K symbols        | Markdown files are compact                 |

### 6.3 Reliability

| Requirement                              | Target                          | Notes                                     |
| ---------------------------------------- | ------------------------------- | ----------------------------------------- |
| Extension crash rate                     | < 0.1% of sessions              | Crash = unrecoverable extension error     |
| LLM analysis failure handling            | Graceful degradation             | Show error message; allow retry; no crash |
| Cache corruption recovery               | Automatic                        | Detect corrupted cache files; re-analyze  |
| Offline functionality                    | Cached results available offline | LLM analysis requires connectivity        |

### 6.4 Security

| Requirement                              | Detail                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| **Code Privacy**                         | Source code is sent to the configured LLM provider only. No telemetry sends code to third parties. |
| **Cache Security**                       | Cache files are stored locally in the workspace. No cloud sync by default. |
| **Secret Detection**                     | The analysis engine MUST NOT include secrets (API keys, tokens, passwords) in cached markdown files. A basic secret pattern scanner runs on LLM output before caching. |
| **LLM Provider Authentication**          | Uses existing VS Code / system authentication for `mai-claude` or Copilot CLI. No additional credentials stored. |
| **Extension Permissions**                | The extension requests only the minimum required VS Code API permissions: file system access (workspace only), webview, editor decoration, and command registration. |

### 6.5 Accessibility

| Requirement                              | Detail                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| **Keyboard Navigation**                 | All sidebar interactions must be navigable via keyboard (Tab, Enter, Escape, arrow keys). |
| **Screen Reader Support**               | Sidebar content must use proper ARIA labels and semantic HTML in webviews. |
| **High Contrast Theme**                 | The sidebar UI must be legible in VS Code's High Contrast themes (light and dark). |
| **Color Independence**                  | Information must not be conveyed through color alone; use icons, labels, or patterns as supplements. |

### 6.6 Compatibility

| Requirement                              | Detail                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| **VS Code Version**                     | Compatible with VS Code v1.85 and above.                                 |
| **Operating Systems**                   | Windows 10+, macOS 12+, Linux (Ubuntu 20.04+, Fedora 36+).              |
| **Node.js Runtime**                     | Compatible with Node.js 18+ (bundled with VS Code).                      |
| **Language Support (Phase 1)**          | TypeScript, JavaScript (including JSX/TSX).                              |
| **Language Support (Phase 2)**          | Python, Go, Java, C#.                                                    |
| **Extension Conflicts**                 | Must not conflict with: GitHub Copilot, ESLint, Prettier, GitLens, or TypeScript language features. |

---

## 7. System Architecture Overview

### 7.1 High-Level Components

```
+-------------------------------------------------------------------+
|                        VS Code Extension Host                      |
|                                                                     |
|  +---------------------+    +----------------------------------+   |
|  |   Sidebar Webview    |    |      Extension Controller       |   |
|  |                     |    |                                  |   |
|  |  - Tab Manager      |<-->|  - Symbol Detection              |   |
|  |  - Result Renderer  |    |  - Event Handlers (click/hover)  |   |
|  |  - Navigation Links |    |  - Command Registration          |   |
|  +---------------------+    +----------------------------------+   |
|                                        |                           |
|                                        v                           |
|                          +----------------------------+            |
|                          |    Analysis Orchestrator    |            |
|                          |                            |            |
|                          |  - Cache Manager           |            |
|                          |  - LLM Request Queue       |            |
|                          |  - Background Scheduler    |            |
|                          +----------------------------+            |
|                            /                    \                   |
|                           v                      v                 |
|              +------------------+    +----------------------+      |
|              |   Cache Layer    |    |   LLM Integration    |      |
|              |                  |    |                      |      |
|              | .vscode/         |    | - mai-claude adapter |      |
|              |  code-explorer/  |    | - copilot-cli adapter|      |
|              |  *.md files      |    | - prompt templates   |      |
|              |  index.json      |    | - response parser    |      |
|              +------------------+    +----------------------+      |
+-------------------------------------------------------------------+
```

### 7.2 Cache File Structure

```
<workspace-root>/
  .vscode/
    code-explorer/
      index.json                          # Symbol-to-file lookup index
      meta.json                           # Global metadata (last full scan, config snapshot)
      src/
        services/
          UserService.ts.md               # Analysis for src/services/UserService.ts
          AuthService.ts.md               # Analysis for src/services/AuthService.ts
        models/
          User.ts.md                      # Analysis for src/models/User.ts
        controllers/
          UserController.ts.md            # Analysis for src/controllers/UserController.ts
```

### 7.3 Cache File Format (Example)

```markdown
---
file: src/services/UserService.ts
analyzed_at: 2026-03-28T14:30:00Z
file_hash: sha256:a1b2c3d4e5f6...
model: claude-sonnet-4-20250514
symbols_analyzed: [UserService, getUserById, createUser]
---

# UserService

## Summary
UserService is the primary service class for user management operations.
It handles CRUD operations for user entities, coordinates with the
AuthService for permission checks, and emits events for audit logging.

## Usage Locations
| # | File | Line | Context |
|---|------|------|---------|
| 1 | src/controllers/UserController.ts | 15 | `const userService = new UserService(db)` |
| 2 | src/controllers/AdminController.ts | 42 | `this.userService.getUserById(id)` |
| ... | | | |

## Call Stacks (Top 5)
### Stack 1: HTTP GET /users/:id
1. `UserController.getUser()` -- src/controllers/UserController.ts:23
2. `UserService.getUserById(id)` -- src/services/UserService.ts:45
3. `UserRepository.findOne(id)` -- src/repositories/UserRepository.ts:12

...
```

---

## 8. Success Metrics and KPIs

### 8.1 Adoption Metrics

| Metric                                   | Target (6 months post-launch)   | Measurement                              |
| ---------------------------------------- | ------------------------------- | ---------------------------------------- |
| Total installs                           | 5,000+                          | VS Code Marketplace analytics            |
| Weekly active users                      | 1,500+                          | Anonymized telemetry (opt-in)            |
| Daily sidebar opens per active user      | 3+                              | Extension usage telemetry                |
| Retention rate (Week 4)                  | > 40%                           | Users active in Week 4 / installed in Week 1 |

### 8.2 Engagement Metrics

| Metric                                   | Target                          | Measurement                              |
| ---------------------------------------- | ------------------------------- | ---------------------------------------- |
| Symbols explored per session             | 5+                              | Click events on classes/functions/variables |
| Cache hit rate                           | > 70% after first week          | Cache hits / total symbol lookups        |
| Average tabs open per session            | 2-3                             | Tab open/close events                    |
| Hover quick peek usage                   | 10+ per session                 | Hover trigger events                     |

### 8.3 Performance Metrics

| Metric                                   | Target                          | Measurement                              |
| ---------------------------------------- | ------------------------------- | ---------------------------------------- |
| P95 cached result render time            | < 500ms                         | Client-side timing                       |
| P95 uncached analysis time               | < 30 seconds                    | End-to-end timing                        |
| Extension crash rate                     | < 0.1%                          | Error reporting                          |
| Background analysis completion rate      | > 95%                           | Jobs completed / jobs started            |

### 8.4 Satisfaction Metrics

| Metric                                   | Target                          | Measurement                              |
| ---------------------------------------- | ------------------------------- | ---------------------------------------- |
| VS Code Marketplace rating               | 4.0+ stars                      | Marketplace reviews                      |
| Net Promoter Score (NPS)                 | > 30                            | In-extension survey (quarterly)          |
| GitHub issues (bugs) per 1K users        | < 10 per month                  | GitHub issue tracker                     |

---

## 9. Risks and Mitigations

| # | Risk                                          | Likelihood | Impact  | Mitigation Strategy                                                                                          |
|---|-----------------------------------------------|:----------:|:-------:|--------------------------------------------------------------------------------------------------------------|
| 1 | **LLM analysis quality is inconsistent**      | Medium     | High    | Invest in prompt engineering; use structured output schemas; implement output validation; allow users to rate and flag bad results; iterate on prompts based on feedback. |
| 2 | **LLM latency is too high for interactive use**| Medium     | High    | Aggressive caching strategy; background pre-analysis; show partial results as they stream; set hard timeouts with graceful fallback to static analysis only. |
| 3 | **LLM API costs are prohibitive**             | Medium     | Medium  | Cache aggressively to minimize API calls; batch analysis requests; provide cost estimation in settings; allow users to set monthly call budgets. |
| 4 | **Privacy concerns with code sent to LLMs**   | High       | High    | Clear documentation of what is sent; support local LLM providers (Ollama); allow per-folder/per-file exclusion patterns; never send files matching `.gitignore` or secret patterns. |
| 5 | **Large codebase performance degradation**     | Medium     | Medium  | Implement file exclusion patterns; lazy analysis (only analyze on demand); cap background analysis scope; profile and optimize for 500K+ LOC workspaces. |
| 6 | **Cache staleness causes misleading results** | Medium     | Medium  | File hash comparison on every load; clear "stale" visual indicator; auto-invalidate on Git branch switch; allow one-click refresh. |
| 7 | **Conflict with existing VS Code extensions** | Low        | Medium  | Test against top 20 popular extensions; use dedicated view container (not shared with other extensions); avoid overriding built-in keybindings. |
| 8 | **LLM provider API changes / deprecation**    | Low        | High    | Abstract LLM integration behind a provider interface; support multiple providers; maintain adapter pattern for easy provider swaps. |
| 9 | **User overwhelm / information overload**     | Medium     | Medium  | Default to concise summaries; use progressive disclosure (expand for details); allow users to customize what sections are shown; conduct usability testing. |
| 10| **Adoption resistance ("yet another tool")**  | Medium     | Medium  | Focus on zero-config experience; show value within 30 seconds of install; integrate naturally with existing workflows (right-click, hover); avoid requiring behavior changes. |

---

## 10. Out of Scope and Future Considerations

### Explicitly Out of Scope for v1.0

| Item                                      | Rationale                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| **Code generation / refactoring**         | Code Explorer is a *read and understand* tool, not a *write* tool. Code generation is handled by Copilot and similar tools. |
| **Real-time collaboration**               | Multi-user features (shared exploration sessions) add significant complexity and are deferred. |
| **Non-VS Code editors**                   | JetBrains, Neovim, and other editor support is out of scope for the initial release. |
| **Language server protocol (LSP) server** | Code Explorer uses the existing TypeScript Language Service; building a custom LSP is unnecessary for Phase 1. |
| **CI/CD integration**                     | Running Code Explorer analysis in CI pipelines is a future consideration.         |
| **Custom visualization / diagramming**    | Advanced graph visualizations (UML, sequence diagrams) are deferred to P2.        |
| **Code annotation / commenting**          | Adding developer notes to analysis results is a future feature.                   |

### Future Considerations

1. **MCP Server (P2-01):** Expose cached analysis through a Model Context Protocol server, enabling AI coding agents (Copilot, Claude Code, Cursor) to query Code Explorer's knowledge base. This transforms Code Explorer from a developer tool into an infrastructure layer for AI-assisted development.

2. **Multi-Language Expansion (P2-03):** Extend analysis support to Python, Go, Java, C#, and Rust. Each language requires a dedicated symbol resolver and language-specific prompt templates.

3. **Team Analytics Dashboard:** Aggregate anonymized usage data to show which parts of the codebase are most explored (indicating complexity hotspots), informing refactoring and documentation priorities.

4. **Git Integration:** Automatically invalidate caches on branch switches; show how symbol usage has changed between branches or commits; integrate with PR review workflows.

5. **Workspace Recommendations:** Based on exploration patterns, suggest related symbols, files, or documentation that the developer might want to examine next.

---

## 11. Dependencies

### 11.1 Technical Dependencies

| Dependency                                | Type       | Version    | Purpose                                                          | Risk Level |
| ----------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------- | ---------- |
| **VS Code Extension API**                | Runtime    | 1.85+      | Extension host, webview API, TreeView API, editor decorations     | Low        |
| **TypeScript Language Service**           | Runtime    | 5.0+       | Symbol resolution, type information, reference finding            | Low        |
| **mai-claude CLI**                        | Runtime    | Latest     | Primary LLM provider for code analysis                           | Medium     |
| **Copilot CLI (fallback)**               | Runtime    | Latest     | Secondary LLM provider                                           | Medium     |
| **Node.js crypto module**                | Runtime    | Built-in   | SHA-256 file hashing for cache invalidation                      | Low        |
| **VS Code Webview UI Toolkit**           | Build      | Latest     | Consistent UI components for sidebar webviews                    | Low        |
| **webpack / esbuild**                    | Build      | Latest     | Extension bundling and optimization                              | Low        |
| **Mocha / Jest**                         | Test       | Latest     | Unit and integration testing                                     | Low        |
| **VS Code Extension Test Runner**        | Test       | Latest     | End-to-end extension testing in VS Code host                     | Low        |

### 11.2 Organizational Dependencies

| Dependency                                | Owner              | Description                                                       | Status     |
| ----------------------------------------- | ------------------ | ----------------------------------------------------------------- | ---------- |
| **LLM API access and quotas**            | Platform Team      | Ensure sufficient API quota for `mai-claude` / Copilot CLI        | Pending    |
| **VS Code Marketplace publishing**       | DevTools Team      | Publisher account and CI/CD pipeline for extension releases        | Available  |
| **UX review and design feedback**        | Design Team        | Sidebar layout, tab design, and interaction pattern review         | Scheduled  |
| **Security review**                      | Security Team      | Review of data sent to LLM providers; cache security audit         | Scheduled  |

---

## 12. Timeline and Milestones

### Phase Overview

```
Phase 1 (MVP)           Phase 2 (Enhanced)        Phase 3 (Platform)
Q2 2026                 Q3 2026                   Q4 2026+
|--- 10 weeks ---|      |--- 8 weeks ---|         |--- Ongoing ---|
```

### Phase 1: MVP (Weeks 1-10)

**Goal:** Deliver the core sidebar panel with class, function, and variable exploration powered by LLM analysis with caching.

| Week  | Milestone                            | Deliverables                                                                    | Exit Criteria                                  |
| :---: | ------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1-2   | **Foundation**                       | Extension scaffold; sidebar view container; activity bar icon; basic webview    | Sidebar opens from activity bar; empty panel renders |
| 3-4   | **Symbol Detection & Tabs**          | Click handler for classes/functions/variables; tab manager; symbol identification | Clicking a symbol opens a tab with the symbol name |
| 5-6   | **LLM Integration & Analysis**      | LLM adapter (mai-claude); prompt templates for class/function/variable; response parser | LLM analysis triggers on click; structured result returned |
| 7-8   | **Cache System & Results Rendering** | Cache read/write; markdown file generation; stale detection; result rendering in webview | Cached results render in sidebar; stale indicator works |
| 9     | **Context Menu & Navigation**        | Right-click menu; editor navigation from sidebar; call stack rendering          | Full end-to-end flow: right-click -> analyze -> render -> navigate |
| 10    | **Polish & Internal Release**        | Bug fixes; performance optimization; internal dogfooding release                | Internal team uses the extension for 1 week    |

### Phase 2: Enhanced Experience (Weeks 11-18)

**Goal:** Add hover support, data flow analysis, inheritance exploration, background analysis, and full settings.

| Week  | Milestone                            | Deliverables                                                                    | Exit Criteria                                  |
| :---: | ------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| 11-12 | **Hover Quick Peek**                 | Enhanced hover provider; tooltip rendering; "Open in Code Explorer" link        | Hovering on cached symbol shows tooltip         |
| 13-14 | **Data Flow & Inheritance**          | Data flow analysis prompts; inheritance tree extraction; UI rendering           | Data flow and inheritance sections visible in tabs |
| 15-16 | **Background Analysis**              | Background scheduler; Git diff-based file detection; status bar integration     | Background analysis runs on configurable interval |
| 17-18 | **Settings & Marketplace Release**   | Full settings UI; documentation; marketplace listing; public release            | Extension published to VS Code Marketplace      |

### Phase 3: Platform & MCP (Weeks 19+)

**Goal:** Transform Code Explorer into an AI agent infrastructure layer with MCP server integration.

| Week    | Milestone                            | Deliverables                                                                  |
| :-----: | ------------------------------------ | ----------------------------------------------------------------------------- |
| 19-22   | **MCP Server**                       | MCP server implementation; tool definitions for symbol query, call stack, data flow |
| 23-26   | **Multi-Language Support**           | Python and Go analysis adapters; language-specific prompt templates            |
| 27+     | **Advanced Features**                | Dependency graph visualization; analysis history; team sharing; search        |

---

## 13. Appendix

### A. Glossary

| Term                    | Definition                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| **Call Stack**          | The ordered list of function calls that leads to a particular function being executed.                    |
| **Call Hierarchy**      | The tree of callers (who calls this function) and callees (what this function calls).                    |
| **Data Flow**           | The path that a data value takes through the program, from creation through transformations to consumption. |
| **Variable Lifecycle**  | The complete journey of a variable: declaration, initialization, mutations, reads, and scope exit.        |
| **Cache (Analysis Cache)** | Locally stored markdown files containing previously computed LLM analysis results for symbols.        |
| **Stale Cache**         | A cached analysis result whose source file has been modified since the analysis was performed.            |
| **MCP**                 | Model Context Protocol -- a standard for AI agents to discover and invoke tools and data sources.        |
| **Symbol**              | A named code entity: class, function, method, variable, interface, type alias, or enum.                  |
| **mai-claude**          | Microsoft's internal CLI for accessing Claude AI models.                                                 |
| **Copilot CLI**         | GitHub Copilot's command-line interface for programmatic AI interactions.                                 |

### B. Open Questions

| # | Question                                                                                   | Status   | Owner          |
|---|--------------------------------------------------------------------------------------------|----------|----------------|
| 1 | Should `.vscode/code-explorer/` be added to `.gitignore` by default, or left for user decision? | Open     | Product        |
| 2 | What is the maximum file size we should send to the LLM for analysis?                      | Open     | Engineering    |
| 3 | Should we support multi-root workspaces in Phase 1?                                        | Open     | Engineering    |
| 4 | How do we handle monorepos with thousands of files -- full index or on-demand only?         | Open     | Engineering    |
| 5 | Should hover quick peek be opt-in or opt-out by default?                                   | Open     | Product / UX   |
| 6 | What telemetry (if any) should we collect, and how do we communicate this to users?        | Open     | Product / Legal|

### C. References

- [VS Code Extension API Documentation](https://code.visualstudio.com/api)
- [VS Code Webview UI Toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)

---

*This document is a living artifact and will be updated as requirements evolve. All stakeholders are encouraged to provide feedback via comments or direct communication with the document owner.*
