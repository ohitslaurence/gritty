import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { DiffContent } from "../../types/branded"
import { GitError, NoStagedChangesError, UserError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"
import { AIService } from "../../services/ai/service"
import { GitService } from "../../services/git/service"
import { confirmWithEdit } from "../../core/prompt"
import { isDiffTooLarge } from "../../core/split"

/**
 * Speed tier options - mutually exclusive flags.
 */
const fastOption = Options.boolean("fast").pipe(
  Options.withAlias("f"),
  Options.withDescription("Use Haiku for speed (< 1.5s)")
)

const mediumOption = Options.boolean("medium").pipe(
  Options.withAlias("m"),
  Options.withDescription("Use Sonnet for balance (default)")
)

const slowOption = Options.boolean("slow").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use Opus for quality")
)

/**
 * Other options.
 */
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Print message only, don't commit")
)

const acceptOption = Options.boolean("accept").pipe(
  Options.withAlias("a"),
  Options.withDescription("Auto-accept the generated message (skip confirmation)")
)

const stagedOnlyOption = Options.boolean("staged-only").pipe(
  Options.withDescription("Only use already-staged changes (skip auto-staging)")
)

const contextOption = Options.text("context").pipe(
  Options.withAlias("c"),
  Options.withDescription("Additional context for the AI"),
  Options.optional
)

/**
 * Combine options into the commit command options.
 */
const commitOptions = {
  fast: fastOption,
  medium: mediumOption,
  slow: slowOption,
  dryRun: dryRunOption,
  accept: acceptOption,
  stagedOnly: stagedOnlyOption,
  context: contextOption,
}

/**
 * Determine speed tier from flags.
 */
const getSpeedTier = (fast: boolean, _medium: boolean, slow: boolean): SpeedTier => {
  if (fast) return "fast"
  if (slow) return "slow"
  return "medium"
}

/**
 * Format the generated message for display.
 */
const formatMessage = (message: string): string => {
  const separator = "─".repeat(60)
  return `
${separator}
${message}
${separator}`
}

/**
 * Execute git commit with editor for review.
 */
const commitWithEditor = (message: string): Effect.Effect<void, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", "commit", "-e", "-m", message], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        throw new Error(`Commit aborted or failed`)
      }
    },
    catch: (error) =>
      new GitError({
        operation: "commit",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * The commit command implementation.
 */
export const commitCommand = Command.make(
  "commit",
  commitOptions,
  ({ fast, medium, slow, dryRun, accept, stagedOnly, context }) =>
    Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService

      // Check if we're in a git repo
      const isRepo = yield* git.isGitRepo()
      if (!isRepo) {
        return yield* Effect.fail(
          new UserError({ message: "Not a git repository. Run this command inside a git project." })
        )
      }

      const speed = getSpeedTier(fast, medium, slow)
      const contextValue = Option.getOrUndefined(context)

      // Stage all changes unless --staged-only
      if (!stagedOnly) {
        yield* Console.log("Staging all changes...")
        yield* git.stageAll()
      }

      const diff = yield* git.getStagedDiff()

      if (!diff || diff.trim().length === 0) {
        return yield* Effect.fail(
          new NoStagedChangesError({
            message: stagedOnly
              ? "No staged changes found. Stage files with `git add` first."
              : "No changes found (staged or unstaged). Make some changes first!",
          })
        )
      }

      yield* Console.log(`Analyzing changes (${speed} mode)...`)

      // Fetch recent commits for style detection
      const recentCommits = yield* git.getRecentCommits(10).pipe(
        Effect.catchAll(() => Effect.succeed([] as const))
      )

      // Truncate diff if too large
      const safeDiff = isDiffTooLarge(diff)
        ? diff.slice(0, 80000) + "\n\n[... diff truncated ...]"
        : diff

      // Generate commit message
      const message = yield* ai.generateCommitMessage(
        DiffContent(safeDiff),
        contextValue
          ? { speed, context: contextValue, recentCommits }
          : { speed, recentCommits }
      )

      yield* Console.log(formatMessage(message))

      // Dry run stops here
      if (dryRun) {
        return
      }

      // Auto-accept if flag is set
      if (accept) {
        yield* git.commit(message)
        yield* Console.log(`\n✓ Committed: ${message.split("\n")[0]}`)
        return
      }

      // Interactive confirmation
      const response = yield* confirmWithEdit("\nCommit with this message?")

      switch (response) {
        case "yes":
          yield* git.commit(message)
          yield* Console.log(`\n✓ Committed: ${message.split("\n")[0]}`)
          break
        case "edit":
          yield* commitWithEditor(message)
          yield* Console.log(`\n✓ Committed`)
          break
        case "no":
          yield* Console.log("\nAborted.")
          break
      }
    }).pipe(
      Effect.catchTags({
        NoStagedChangesError: (e) => Console.error(`\n✗ ${e.message}`),
        UserError: (e) => Console.error(`\n✗ ${e.message}`),
        GitError: (e) => Console.error(`\n✗ Git error: ${e.message}`),
        AIError: (e) => Console.error(`\n✗ AI error: ${e.message}`),
      })
    )
).pipe(Command.withDescription("Generate a commit message for staged changes"))
