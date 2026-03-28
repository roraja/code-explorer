# Changelog

All notable changes to the "Code Explorer" extension will be documented in this file.

## [Unreleased]

### Added
- Project scaffolding and directory structure
- TypeScript configuration for extension and webview
- esbuild bundling for extension and webview
- ESLint + Prettier configuration
- VS Code debug and task configurations
- Core data model interfaces (`src/models/types.ts`)
- Error type hierarchy (`src/models/errors.ts`)
- Constants module (`src/models/constants.ts`)
- Extension entry point with activate/deactivate
- Webview entry point with empty state
- Webview CSS with VS Code theme variables
- Test infrastructure (Mocha + VS Code Test Runner)
- Unit tests for data models and error types
- `.vscodeignore` for VSIX packaging
- Activity bar icon (SVG)
