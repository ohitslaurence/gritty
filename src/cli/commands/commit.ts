import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { DiffContent } from "../../types/branded"
import { NoStagedChangesError, UserError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"
import { AIService } from "../../services/ai/service"
import { GitService } from "../../services/git/service"

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
const yesOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDescription("Skip confirmation, commit directly")
)

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Print message only, don't commit")
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
  yes: yesOption,
  dryRun: dryRunOption,
  stagedOnly: stagedOnlyOption,
  context: contextOption,
}

/**
 * Determine speed tier from flags.
 */
const getSpeedTier = (fast: boolean, _medium: boolean, slow: boolean): SpeedTier => {
  if (fast) return "fast"
  if (slow) return "slow"
  return "medium" // default (medium flag is implicit)
}

/**
 * Format the generated message for display.
 */
const formatMessage = (message: string): string => {
  const separator = "─".repeat(60)
  return `
Generated commit message:
${separator}
${message}
${separator}`
}

/**
 * Prompt user for confirmation.
 */
const promptConfirmation = (): Effect.Effect<"yes" | "no" | "edit", never> =>
  Effect.sync(() => {
    // For now, just auto-confirm. Real implementation would use readline.
    // TODO: Implement interactive prompt
    return "yes" as const
  })

/**
 * The commit command implementation.
 */
export const commitCommand = Command.make(
  "commit",
  commitOptions,
  ({ fast, medium, slow, yes, dryRun, stagedOnly, context }) =>
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

      // Stage all changes unless --staged-only
      if (!stagedOnly) {
        yield* Console.log("Staging all changes...")
        yield* git.stageAll()
      }

      // Get staged diff
      const diff = yield* git.getStagedDiff()

      // Check if there are staged changes
      if (!diff || diff.trim().length === 0) {
        return yield* Effect.fail(
          new NoStagedChangesError({
            message: stagedOnly
              ? "No staged changes found. Stage files with `git add` first."
              : "No changes found (staged or unstaged). Make some changes first!",
          })
        )
      }

      // Determine speed tier
      const speed = getSpeedTier(fast, medium, slow)
      yield* Console.log(`Analyzing staged changes (using ${speed} mode)...`)

      // Fetch recent commits for style detection
      const recentCommits = yield* git.getRecentCommits(10).pipe(
        Effect.catchAll(() => Effect.succeed([] as const))
      )

      // Generate commit message
      const contextValue = Option.getOrUndefined(context)
      const message = yield* ai.generateCommitMessage(
        DiffContent(diff),
        contextValue
          ? { speed, context: contextValue, recentCommits }
          : { speed, recentCommits }
      )

      // Display the message
      yield* Console.log(formatMessage(message))

      // Handle dry run
      if (dryRun) {
        return
      }

      // Handle auto-confirm
      if (yes) {
        yield* git.commit(message)
        yield* Console.log(`\n✓ Committed: ${message.split("\n")[0]}`)
        return
      }

      // Interactive confirmation
      yield* Console.log("\n? Commit with this message? (Y/n/e)")
      yield* Console.log("  Y - Yes, commit")
      yield* Console.log("  n - No, abort")
      yield* Console.log("  e - Edit message first")

      const response = yield* promptConfirmation()

      switch (response) {
        case "yes":
          yield* git.commit(message)
          yield* Console.log(`\n✓ Committed: ${message.split("\n")[0]}`)
          break
        case "no":
          yield* Console.log("\nAborted.")
          break
        case "edit":
          // TODO: Open editor
          yield* Console.log("\nEdit mode not yet implemented.")
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
