---
name: update-context
description: "This skill should be used when the user asks to 'update context files',
  'refresh context', 'update floorplan', 'sync context with code', 'update CONTEXT.md',
  'update FLOORPLAN.md', or when the codebase has changed and documentation needs to
  reflect the current state. Walks through all source files and updates .context/FLOORPLAN.md
  and all CONTEXT.md files to accurately describe the current implementation."
---

# Update Context

Walk through the codebase and update all context documentation files to reflect the current state of the code. This includes `.context/FLOORPLAN.md` (the workspace floorplan) and all `CONTEXT.md` files co-located in key folders.

## Context File Locations

These are the files that must be reviewed and updated:

| File | Scope |
|------|-------|
| `.context/FLOORPLAN.md` | Top-level routing table, feature status, data flow, conventions |
| `src/CONTEXT.md` | Extension host entry point, dependency graph, module overview |
| `src/models/CONTEXT.md` | Types, error hierarchy, constants |
| `src/providers/CONTEXT.md` | Symbol resolution logic |
| `src/analysis/CONTEXT.md` | Analysis pipeline, static analyzer |
| `src/llm/CONTEXT.md` | LLM providers, prompt building, response parsing |
| `src/llm/prompts/CONTEXT.md` | Per-symbol-kind prompt strategies |
| `src/cache/CONTEXT.md` | Cache store, serialization format |
| `src/ui/CONTEXT.md` | Webview provider, tab state, message protocol |
| `src/utils/CONTEXT.md` | Logger, CLI runner |
| `webview/CONTEXT.md` | Browser-side rendering, event handling |
| `test/CONTEXT.md` | Test framework, conventions, file structure |

## Procedure

Follow these steps in order:

### Step 1: Inventory Current Files

Scan the project to find all source files. Run:
```
find . -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' | sort
```

Compare against the file lists in each CONTEXT.md. Identify:
- New files not documented in any CONTEXT.md
- Files listed in CONTEXT.md that no longer exist
- Files whose role has changed

### Step 2: Read Key Source Files

For each module folder, read the actual source files to understand current state:
- Check class/function names, method signatures, imports
- Check constructor parameters (dependency injection)
- Check which features are implemented vs stubbed
- Check which methods are actually called vs defined but unused

### Step 3: Update FLOORPLAN.md

Update `.context/FLOORPLAN.md` with:
- **Feature status table**: Mark features as Implemented, Not implemented, or Stub based on actual code
- **Folder routing table**: Add/remove entries for new/deleted folders
- **Data flow diagram**: Update if the pipeline has changed
- **Build commands**: Verify against `package.json` scripts
- **Conventions**: Check against `.eslintrc.json` and actual code patterns
- **Troubleshooting**: Add any new common issues discovered

### Step 4: Update Each CONTEXT.md

For each folder's CONTEXT.md:

1. **Module table**: List all files in the folder with one-line descriptions. Remove deleted files, add new files.
2. **Key methods/classes**: Update signatures, parameters, return types if they changed.
3. **Design decisions**: Add notes about any non-obvious architectural choices found in the code.
4. **"Do NOT" section**: Update with current antipatterns based on code conventions.
5. **Cross-references**: Verify that references to other modules are still accurate.

### Step 5: Check for New Folders

If new folders were created that contain significant code:
1. Create a `CONTEXT.md` in the new folder
2. Add a routing entry in `.context/FLOORPLAN.md`
3. Follow the same format as existing CONTEXT.md files

### Step 6: Verify Accuracy

For each updated file, verify:
- File paths referenced actually exist
- Class/interface names match the actual code
- Feature statuses match reality (don't list something as "Implemented" if it's a stub)
- "Not Yet Implemented" items haven't been implemented since last update

## Writing Guidelines

- Use present tense ("Reads cache files" not "Will read cache files")
- Be specific about what is implemented vs planned
- Include actual file names and class names from the code
- Keep each CONTEXT.md focused on its folder's scope
- Use tables for structured information (modules, methods, features)
- Mark stubs and placeholders clearly (e.g., "Stub only" or "Shows 'future release' message")
