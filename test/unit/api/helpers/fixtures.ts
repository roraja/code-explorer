/**
 * Code Explorer — Test Fixtures
 *
 * Canned LLM responses and sample source code for API tests.
 * These responses match the format that ResponseParser expects.
 */

/** Sample TypeScript source file with multiple symbols. */
export const SAMPLE_SOURCE = `
import { Database } from './database';

export function processUser(user: User): Result {
  const validated = validateInput(user);
  if (!validated) {
    return { success: false, error: 'Invalid input' };
  }
  return saveUser(validated);
}

function validateInput(user: User): User | null {
  if (!user.name || !user.email) {
    return null;
  }
  return user;
}

function saveUser(user: User): Result {
  const db = new Database();
  db.insert('users', user);
  return { success: true, data: user };
}

export class UserService {
  private _db: Database;

  constructor(db: Database) {
    this._db = db;
  }

  async getUser(id: string): Promise<User | null> {
    return this._db.find('users', id);
  }

  async deleteUser(id: string): Promise<boolean> {
    return this._db.delete('users', id);
  }
}
`.trim();

/**
 * Canned LLM response for a unified exploreSymbol call.
 * Contains json:symbol_identity, json:steps, json:subfunctions, json:callers, etc.
 */
export const EXPLORE_SYMBOL_RESPONSE = `
## Step 1: Symbol Identification

\`\`\`json:symbol_identity
{
  "name": "processUser",
  "kind": "function",
  "container": null,
  "scope_chain": []
}
\`\`\`

### Overview

\`processUser\` is the main entry point function that processes a user object through validation and persistence. It orchestrates the validation-then-save pipeline, returning a structured Result object indicating success or failure.

### Key Points

- Validates user input before saving
- Returns a structured Result object
- Delegates to validateInput and saveUser

### Step-by-Step Breakdown

\`\`\`json:steps
[
  { "step": 1, "description": "Calls validateInput to check the user object" },
  { "step": 2, "description": "Returns early with error if validation fails" },
  { "step": 3, "description": "Calls saveUser with the validated user" }
]
\`\`\`

### Sub-Functions

\`\`\`json:subfunctions
[
  {
    "name": "validateInput",
    "description": "Validates user has required fields (name, email)",
    "input": "(user: User) — the user to validate",
    "output": "User | null — validated user or null",
    "filePath": "src/main.ts",
    "line": 12,
    "kind": "function"
  },
  {
    "name": "saveUser",
    "description": "Persists validated user to the database",
    "input": "(user: User) — the validated user",
    "output": "Result — success/failure result",
    "filePath": "src/main.ts",
    "line": 19,
    "kind": "function"
  }
]
\`\`\`

### Function Input

\`\`\`json:function_inputs
[
  {
    "name": "user",
    "typeName": "User",
    "description": "The user object to process",
    "mutated": false
  }
]
\`\`\`

### Function Output

\`\`\`json:function_output
{
  "typeName": "Result",
  "description": "A result indicating success or failure of user processing"
}
\`\`\`

### Class Members

\`\`\`json:class_members
[]
\`\`\`

### Member Access Patterns

\`\`\`json:member_access
[]
\`\`\`

### Data Flow

\`\`\`json:data_flow
[]
\`\`\`

### Callers

\`\`\`json:callers
[
  {
    "name": "handleRequest",
    "filePath": "src/routes.ts",
    "line": 15,
    "kind": "function",
    "context": "Calls processUser in the POST /users handler"
  }
]
\`\`\`

### Dependencies

- \`validateInput\` (src/main.ts)
- \`saveUser\` (src/main.ts)
- \`User\` type
- \`Result\` type

### Usage Pattern

Called from HTTP route handlers to process incoming user creation requests.

### Potential Issues

- No error handling for saveUser failures
- Synchronous validation could block on large payloads

### Diagrams

\`\`\`json:diagrams
[]
\`\`\`

### Related Symbols

\`\`\`json:related_symbols
[]
\`\`\`

\`\`\`json:related_symbol_analyses
[]
\`\`\`
`.trim();

/**
 * Canned LLM response for file-level analysis (json:file_symbol_analyses).
 */
export const EXPLORE_FILE_RESPONSE = `
Here is the analysis of all symbols in the file:

\`\`\`json:file_symbol_analyses
[
  {
    "cache_file_path": "src/service.ts/class.UserService.md",
    "name": "UserService",
    "kind": "class",
    "filePath": "src/service.ts",
    "line": 5,
    "container": null,
    "scope_chain": [],
    "overview": "UserService provides user CRUD operations backed by a Database instance. It encapsulates all database interactions for user management.",
    "key_points": ["Wraps Database instance", "Provides getUser and deleteUser methods"],
    "steps": [],
    "sub_functions": [],
    "function_inputs": [],
    "function_output": null,
    "class_members": [
      {
        "name": "_db",
        "memberKind": "field",
        "typeName": "Database",
        "visibility": "private",
        "isStatic": false,
        "description": "Database instance for user operations",
        "line": 6
      }
    ],
    "callers": [],
    "dependencies": ["Database"],
    "usage_pattern": "Instantiated with a Database and used for user lookups",
    "potential_issues": ["No connection pooling"]
  },
  {
    "cache_file_path": "src/service.ts/UserService.method.getUser.md",
    "name": "getUser",
    "kind": "method",
    "filePath": "src/service.ts",
    "line": 12,
    "container": "UserService",
    "scope_chain": ["UserService"],
    "overview": "Retrieves a user by their ID from the database. Returns null if the user is not found.",
    "key_points": ["Async method", "Returns Promise<User | null>"],
    "steps": [
      { "step": 1, "description": "Calls this._db.find with table 'users' and the given id" }
    ],
    "sub_functions": [
      {
        "name": "find",
        "description": "Database find method",
        "input": "(table: string, id: string)",
        "output": "User | null",
        "filePath": "src/database.ts",
        "line": 10,
        "kind": "method"
      }
    ],
    "function_inputs": [
      {
        "name": "id",
        "typeName": "string",
        "description": "The user ID to look up",
        "mutated": false
      }
    ],
    "function_output": {
      "typeName": "Promise<User | null>",
      "description": "The found user or null"
    },
    "class_members": [],
    "callers": [],
    "dependencies": ["Database.find"],
    "usage_pattern": "Called with a user ID to retrieve user data",
    "potential_issues": []
  },
  {
    "cache_file_path": "src/service.ts/UserService.method.deleteUser.md",
    "name": "deleteUser",
    "kind": "method",
    "filePath": "src/service.ts",
    "line": 16,
    "container": "UserService",
    "scope_chain": ["UserService"],
    "overview": "Deletes a user by their ID from the database. Returns true if the deletion was successful.",
    "key_points": ["Async method", "Returns Promise<boolean>"],
    "steps": [
      { "step": 1, "description": "Calls this._db.delete with table 'users' and the given id" }
    ],
    "sub_functions": [],
    "function_inputs": [
      {
        "name": "id",
        "typeName": "string",
        "description": "The user ID to delete",
        "mutated": false
      }
    ],
    "function_output": {
      "typeName": "Promise<boolean>",
      "description": "True if deletion succeeded"
    },
    "class_members": [],
    "callers": [],
    "dependencies": ["Database.delete"],
    "usage_pattern": "Called with a user ID to remove a user",
    "potential_issues": []
  }
]
\`\`\`
`.trim();

/**
 * Canned LLM response for enhance analysis.
 */
export const ENHANCE_RESPONSE = `
### Answer

When \`user\` is null, the \`processUser\` function will pass \`null\` to \`validateInput\`. The \`validateInput\` function checks \`user.name\` and \`user.email\`, which will throw a **TypeError** at runtime because you cannot access properties of null.

Specifically:
- \`validateInput(null)\` will throw \`TypeError: Cannot read properties of null (reading 'name')\`
- The function does not have a null guard before calling \`validateInput\`

**Recommendation**: Add a null check at the top of \`processUser\`:
\`\`\`typescript
if (!user) {
  return { success: false, error: 'User is required' };
}
\`\`\`

### Updated Overview

\`processUser\` is the main entry point function that processes a user object through validation and persistence. It orchestrates the validation-then-save pipeline, returning a structured Result object. **Note: it currently lacks a null guard and will throw if called with null.**

\`\`\`json:additional_key_points
["Throws TypeError if called with null user — needs null guard"]
\`\`\`

\`\`\`json:additional_issues
["No null check before accessing user properties"]
\`\`\`
`.trim();

/** Source for the service file used in explore-file tests. */
export const SERVICE_SOURCE = `
import { Database } from './database';

export class UserService {
  private _db: Database;

  constructor(db: Database) {
    this._db = db;
  }

  async getUser(id: string): Promise<User | null> {
    return this._db.find('users', id);
  }

  async deleteUser(id: string): Promise<boolean> {
    return this._db.delete('users', id);
  }
}
`.trim();

/**
 * Canned LLM response for validateInput symbol (used in dependency graph test).
 */
export const VALIDATE_INPUT_RESPONSE = `
\`\`\`json:symbol_identity
{
  "name": "validateInput",
  "kind": "function",
  "container": null,
  "scope_chain": []
}
\`\`\`

### Overview

\`validateInput\` checks that a User object has the required \`name\` and \`email\` fields. Returns the user if valid, null otherwise.

### Key Points

- Simple null-field validation
- Returns the input unchanged if valid

\`\`\`json:steps
[
  { "step": 1, "description": "Checks if user.name exists" },
  { "step": 2, "description": "Checks if user.email exists" },
  { "step": 3, "description": "Returns null if either is missing, else returns user" }
]
\`\`\`

\`\`\`json:subfunctions
[]
\`\`\`

\`\`\`json:function_inputs
[
  { "name": "user", "typeName": "User", "description": "The user to validate", "mutated": false }
]
\`\`\`

\`\`\`json:function_output
{ "typeName": "User | null", "description": "The validated user or null if invalid" }
\`\`\`

\`\`\`json:class_members
[]
\`\`\`

\`\`\`json:member_access
[]
\`\`\`

\`\`\`json:data_flow
[]
\`\`\`

\`\`\`json:callers
[
  { "name": "processUser", "filePath": "src/main.ts", "line": 4, "kind": "function", "context": "Calls validateInput in the processing pipeline" }
]
\`\`\`

### Dependencies

None

### Usage Pattern

Called by processUser to validate incoming user data.

### Potential Issues

None detected.

\`\`\`json:diagrams
[]
\`\`\`

\`\`\`json:related_symbols
[]
\`\`\`

\`\`\`json:related_symbol_analyses
[]
\`\`\`
`.trim();

/**
 * Canned LLM response for saveUser symbol (used in dependency graph test).
 */
export const SAVE_USER_RESPONSE = `
\`\`\`json:symbol_identity
{
  "name": "saveUser",
  "kind": "function",
  "container": null,
  "scope_chain": []
}
\`\`\`

### Overview

\`saveUser\` persists a validated user to the database and returns a Result object indicating success.

### Key Points

- Creates a new Database instance
- Inserts the user into the 'users' table

\`\`\`json:steps
[
  { "step": 1, "description": "Creates a new Database instance" },
  { "step": 2, "description": "Inserts the user into the 'users' table" },
  { "step": 3, "description": "Returns success result with user data" }
]
\`\`\`

\`\`\`json:subfunctions
[]
\`\`\`

\`\`\`json:function_inputs
[
  { "name": "user", "typeName": "User", "description": "The validated user to save", "mutated": false }
]
\`\`\`

\`\`\`json:function_output
{ "typeName": "Result", "description": "Success result containing the saved user" }
\`\`\`

\`\`\`json:class_members
[]
\`\`\`

\`\`\`json:member_access
[]
\`\`\`

\`\`\`json:data_flow
[]
\`\`\`

\`\`\`json:callers
[
  { "name": "processUser", "filePath": "src/main.ts", "line": 4, "kind": "function", "context": "Calls saveUser after validation succeeds" }
]
\`\`\`

### Dependencies

- \`Database\` (src/database.ts)

### Usage Pattern

Called by processUser to persist validated user data.

### Potential Issues

- Creates a new Database instance on every call (should be injected)

\`\`\`json:diagrams
[]
\`\`\`

\`\`\`json:related_symbols
[]
\`\`\`

\`\`\`json:related_symbol_analyses
[]
\`\`\`
`.trim();
