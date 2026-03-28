/**
 * Minimal vscode module mock for unit tests.
 * Provides stubs for APIs used by the extension's non-UI code (logger, etc.)
 * so that unit tests can run outside the VS Code extension host.
 */
module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      append: () => {},
      show: () => {},
      dispose: () => {},
    }),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: () => undefined,
    }),
  },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file' }),
    parse: (s) => ({ fsPath: s, scheme: 'file' }),
  },
  EventEmitter: class {
    fire() {}
    event() {}
    dispose() {}
  },
  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class {
    constructor(startLine, startChar, endLine, endChar) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  },
  commands: {
    executeCommand: async () => undefined,
  },
};
