/**
 * Mocha setup — register mock modules that are unavailable
 * outside the VS Code extension host (e.g. 'vscode').
 */
const Module = require('module');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
  if (request === 'vscode') {
    return require.resolve('./__mocks__/vscode.js');
  }
  return originalResolve.call(this, request, parent);
};
