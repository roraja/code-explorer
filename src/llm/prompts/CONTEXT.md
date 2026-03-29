# src/llm/prompts/

Per-symbol-kind prompt strategies. Each strategy builds a prompt tailored to analyze a specific type of code symbol.

**Note**: These strategies are used by the **legacy** `PromptBuilder.build()` flow. The primary flow uses `PromptBuilder.buildUnified()` which generates a single prompt covering all symbol kinds.

## Modules

| File | Symbol Kinds | Focus |
|------|-------------|-------|
| `PromptStrategy.ts` | — | Interface definition + `PromptContext` type |
| `FunctionPromptStrategy.ts` | `function`, `method` | Step-by-step breakdown, sub-functions, inputs/outputs, callers |
| `ClassPromptStrategy.ts` | `class`, `struct`, `interface`, `enum` | Class structure, member analysis, member access patterns, lifecycle |
| `VariablePromptStrategy.ts` | `variable` | Data mutation tracking, variable lifecycle, data flow, data kind |
| `PropertyPromptStrategy.ts` | `property` | Member access patterns, mutation tracking, encapsulation |

## Strategy Interface

```typescript
interface PromptStrategy {
  buildPrompt(symbol: SymbolInfo, context: PromptContext, lang: string): string;
}

interface PromptContext {
  sourceCode: string;
  containingScopeSource?: string;    // For variables/properties
  containingClassName?: string;       // For class members
}
```

## JSON Block Convention

All strategies request the LLM to output structured data in fenced blocks with tagged names:

```
```json:tag_name
[...]
```
```

This convention allows `ResponseParser` to extract machine-readable data from the LLM's markdown response.

## Sections Requested Per Strategy

| Section | Function | Class | Variable | Property |
|---------|----------|-------|----------|----------|
| Overview | Yes | Yes | Yes | Yes |
| Key Points | Yes | Yes | Yes | Yes |
| Data Kind (`json:data_kind`) | No | No | Yes | No |
| Step-by-Step (`json:steps`) | Yes | Yes (lifecycle) | No | No |
| Sub-Functions (`json:subfunctions`) | Yes | No | No | No |
| Function Input (`json:function_inputs`) | Yes | No | No | No |
| Function Output (`json:function_output`) | Yes | No | No | No |
| Class Members (`json:class_members`) | No | Yes | No | No |
| Member Access (`json:member_access`) | No | Yes | No | Yes |
| Variable Lifecycle (`json:variable_lifecycle`) | No | No | Yes | Yes |
| Data Flow (`json:data_flow`) | No | No | Yes | Yes |
| Callers (`json:callers`) | Yes | Yes | Yes | Yes |
| Dependencies | Yes | Yes | Yes | Yes |
| Usage Pattern | Yes | Yes | Yes | Yes |
| Potential Issues | Yes | Yes | Yes | Yes |
| Related Symbols (`json:related_symbols`) | Yes | Yes | Yes | Yes |

## Adding a New Strategy

1. Create `src/llm/prompts/NewKindPromptStrategy.ts` implementing `PromptStrategy`
2. Register in `STRATEGY_MAP` in `src/llm/PromptBuilder.ts`
3. Add any new JSON block tags to `ResponseParser.ts` parsing methods
4. Add corresponding interfaces to `src/models/types.ts` if new data shapes are needed
