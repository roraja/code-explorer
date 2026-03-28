---
applyTo: "webview/**"
description: "Use when modifying the webview (sidebar UI). Enforces browser-only APIs and VS Code theme integration."
---

# Webview Conventions

- **Platform**: Browser only — no Node.js APIs (`fs`, `path`, `child_process`), no `require()`
- **No imports from `src/`**: The webview cannot import extension host types. Redefine interfaces locally.
- **Communication**: Use `vscode.postMessage()` to send messages to the extension. Receive via `window.addEventListener('message', ...)`.
- **State**: The webview is a pure renderer. All state is owned by the extension and pushed via `setState` messages. Persist locally with `vscode.setState()`/`vscode.getState()`.
- **CSS**: Use VS Code theme variables (`var(--vscode-foreground)`, `var(--vscode-editor-background)`) — no hardcoded colors
- **Framework**: Vanilla TypeScript, no React/Vue. Keep bundle small.
- **CSP**: Content Security Policy is enforced. No inline scripts, no eval.
