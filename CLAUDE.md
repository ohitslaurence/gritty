# Gritty - AI-Powered Git CLI

## Project Overview

A fast, TypeScript-based CLI tool using Claude to enhance Git workflows. Built with Effect for robust error handling and composability.

**Stack:** Bun + TypeScript + Effect + @effect/cli + Claude Code SDK

## Build & Test Commands

- `bun dev`: Run CLI in development
- `bun build`: Build for distribution
- `bun check`: Run oxlint + typecheck + tests
- `bun lint`: Run oxlint
- `bun format`: Run prettier
- `bun typecheck`: TypeScript type checking
- `bun test`: Run all tests
- `bun test path/to/file.test.ts`: Run specific test
- `bun eval`: Run AI quality evaluations

## Code Style Guidelines

### Imports

- ALWAYS use ES6 static imports (`import { x } from 'y'`)
- NEVER use CommonJS (`require()`)
- NEVER use dynamic imports (`import()`)
- Group by source: external imports first, then internal
- **No index/barrel exports** - Import directly from source files

### File Naming

- Files: `kebab-case.ts`
- Test files: `*.test.ts` suffix ONLY for actual test suites
- Test utilities: NO `.test.ts` suffix (e.g., `test-layer.ts`, not `test.test.ts`)

### Naming Conventions

- PascalCase: Types, interfaces, services, layers
- camelCase: Functions, variables, constants
- UPPER_SNAKE_CASE: Only for true constants (config keys, error codes)

### Types

- **Strict mode always** - no `any`, use `unknown` and narrow
- Use branded types for domain concepts:
  ```typescript
  type CommitMessage = string & Brand.Brand<"CommitMessage">
  type DiffContent = string & Brand.Brand<"DiffContent">
  ```
- Discriminated unions for variants with `_tag`
- Readonly by default for interfaces

### Module Pattern

Export functions through namespace modules when grouping related functionality.

## Effect Best Practices

**Before implementing Effect features**, run `effect-solutions list` and read the relevant guide with `effect-solutions show <topic>`.

Available topics:
- **basics** - Coding conventions for Effect.fn and Effect.gen
- **services-and-layers** - Context.Tag and Layer patterns for dependency injection
- **data-modeling** - Records, variants, brands, pattern matching, and JSON serialization
- **error-handling** - Schema.TaggedError modeling, pattern matching, and defects
- **config** - Effect Config usage, providers, and layer patterns
- **testing** - How to test Effect code with @effect/vitest

**Key conventions:**
- Import Schema from `effect` (not `@effect/schema` which is deprecated)
- Use `Schema.TaggedError` for typed, yieldable errors

**Effect Source Reference:** `~/.local/share/effect-solutions/effect`
Search here for real implementations when docs aren't enough.

### Effect.gen for Sequential Logic

```typescript
const program = Effect.gen(function* () {
  const user = yield* getUser(id)
  const account = yield* getAccount(user.accountId)
  return { user, account }
})
```

### pipe() for Transformations

```typescript
const result = fetchData().pipe(
  Effect.map(transform),
  Effect.tap((data) => Effect.log("Fetched", data)),
  Effect.mapError((e) => new MyError(e))
)
```

### Services and Layers

```typescript
// Define service interface
class GitService extends Context.Tag("GitService")<
  GitService,
  {
    getStagedDiff: () => Effect.Effect<string, GitError>
    commit: (message: string) => Effect.Effect<void, GitError>
  }
>() {}

// Create live implementation
const GitServiceLive = Layer.effect(
  GitService,
  Effect.gen(function* () {
    return {
      getStagedDiff: () => Effect.tryPromise({
        try: () => execGit("diff", "--staged"),
        catch: (e) => new GitError({ operation: "diff", cause: e })
      }),
      commit: (message) => Effect.tryPromise({
        try: () => execGit("commit", "-m", message),
        catch: (e) => new GitError({ operation: "commit", cause: e })
      })
    }
  })
)
```

### Error Handling

Use `Schema.TaggedError` for typed, yieldable errors:

```typescript
class GitError extends Schema.TaggedError<GitError>()("GitError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

// Handle with catchTag
program.pipe(
  Effect.catchTag("GitError", (e) =>
    Effect.fail(new UserFacingError(`Git ${e.operation} failed: ${e.message}`))
  )
)
```

### Wrapping Promises

```typescript
const runCommand = (cmd: string, args: string[]) =>
  Effect.tryPromise({
    try: () => exec(cmd, args),
    catch: (error) => new CommandError({
      command: cmd,
      message: String(error),
      cause: error
    })
  })
```

### Parallel Operations

```typescript
// Use Effect.all for parallel execution
const [diff, commits] = yield* Effect.all([
  GitService.getStagedDiff(),
  GitService.getRecentCommits(10)
])
```

## Testing

Use `bun:test` with `describe`/`it` pattern.

### Testing Effect Code

```typescript
import { describe, it, expect } from "bun:test"
import { Effect, Layer, Exit } from "effect"

// Create test layer
const TestGitService = Layer.succeed(GitService, {
  getStagedDiff: () => Effect.succeed("mock diff"),
  commit: () => Effect.succeed(undefined)
})

describe("commit command", () => {
  it("generates message from diff", async () => {
    const result = await Effect.runPromiseExit(
      generateCommit().pipe(Effect.provide(TestGitService))
    )

    expect(Exit.isSuccess(result)).toBe(true)
  })
})
```

### Test Layer Pattern

```typescript
// Create configurable test implementations
const TestAIService = {
  withResponse: (response: string) =>
    Layer.succeed(AIService, {
      generateCommitMessage: () => Effect.succeed(response)
    }),

  withError: <E>(error: E) =>
    Layer.succeed(AIService, {
      generateCommitMessage: () => Effect.fail(error)
    })
}
```

## CLI Patterns (@effect/cli)

```typescript
import { Command, Options, Args } from "@effect/cli"

const speedOption = Options.choice("speed", ["fast", "medium", "slow"]).pipe(
  Options.withDefault("medium"),
  Options.withDescription("Model speed tier")
)

const commitCommand = Command.make("commit", { speed: speedOption }, (args) =>
  Effect.gen(function* () {
    const git = yield* GitService
    const ai = yield* AIService

    const diff = yield* git.getStagedDiff()
    const message = yield* ai.generateCommitMessage(diff, args.speed)

    yield* Console.log(message)
  })
)
```

## Development Rules

- **Run `bun check` after changes** to verify typecheck + tests pass
- **Read before Write/Edit** - always read files before modifying
- **Complete discovery first** - understand existing patterns before changes
- **Validate after execution** - verify changes work as expected
- **Small, focused commits** - one logical change per commit

## Using Gritty (Dogfooding)

Use gritty itself for git workflows in this project:

```bash
# Create/switch branches
bun run dev -- branch feat/my-feature

# Compose commits (ALWAYS use --accept since we can't interact with prompts)
bun run dev -- compose --accept

# Create PRs (ALWAYS use --accept)
bun run dev -- pr --accept

# Single commits
bun run dev -- commit --accept
```

**IMPORTANT:** Always use `--accept` flag when running gritty commands from Claude Code, since interactive prompts (y/n/e) cannot be answered.

## Key Architectural Decisions

1. **Effect for all async/fallible operations** - No raw Promises or try/catch
2. **Service pattern for DI** - All external interactions through Effect services
3. **Schema for validation** - Runtime validation with `Schema.decodeUnknown`
4. **Branded types** - Type safety for domain concepts
5. **Test layers** - Easy mocking via Layer substitution
