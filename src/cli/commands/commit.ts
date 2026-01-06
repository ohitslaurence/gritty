import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { DiffContent } from "../../types/branded"
import { GitError, NoStagedChangesError, UserError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"
import { AIService } from "../../services/ai/service"
import { GitService } from "../../services/git/service"
import {
  formatGroups,
  groupFilesByDirectory,
  isDiffTooLarge,
  shouldAutoSplit,
  type FileGroup,
} from "../../core/split"

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
Generated commit message:
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
 * Commit a single group of files (for split mode).
 */
const commitGroup = (
  git: GitService["Type"],
  ai: AIService["Type"],
  group: FileGroup,
  options: {
    speed: SpeedTier
    recentCommits: readonly { hash: string; message: string; author: string; date: Date }[]
    dryRun: boolean
  }
) =>
  Effect.gen(function* () {
    // Stage only this group's files
    yield* git.stageFiles(group.files)

    // Get diff for just these files
    const diff = yield* git.getDiffForFiles(group.files)

    if (!diff || diff.trim().length === 0) {
      yield* Console.log(`  Skipping ${group.name} (no changes)`)
      return
    }

    yield* Console.log(`\n  Generating message for ${group.name}...`)

    // Generate commit message
    const message = yield* ai.generateCommitMessage(DiffContent(diff), {
      speed: options.speed,
      recentCommits: options.recentCommits,
      context: `This commit covers changes in: ${group.name}`,
    })

    yield* Console.log(formatMessage(message))

    if (options.dryRun) {
      return
    }

    // Open editor for review
    yield* commitWithEditor(message)
    yield* Console.log(`  ✓ Committed: ${message.split("\n")[0]}`)
  })

/**
 * Handle split commit workflow.
 */
const handleSplitCommit = (
  git: GitService["Type"],
  ai: AIService["Type"],
  allFiles: readonly string[],
  options: {
    speed: SpeedTier
    dryRun: boolean
  }
) =>
  Effect.gen(function* () {
    // Group files by directory
    const groups = groupFilesByDirectory(allFiles)

    yield* Console.log(`Splitting ${allFiles.length} files into ${groups.length} commits:\n`)
    yield* Console.log(formatGroups(groups))
    yield* Console.log("")

    // Fetch recent commits for style detection
    const recentCommits = yield* git.getRecentCommits(10).pipe(
      Effect.catchAll(() => Effect.succeed([] as const))
    )

    // First unstage everything to start fresh
    yield* git.unstageAll().pipe(Effect.catchAll(() => Effect.void))

    // Process each group
    for (const group of groups) {
      yield* commitGroup(git, ai, group, {
        speed: options.speed,
        recentCommits,
        dryRun: options.dryRun,
      })
    }

    if (options.dryRun) {
      yield* Console.log("\n(Dry run - no commits created)")
    } else {
      yield* Console.log(`\n✓ Created ${groups.length} commits`)
    }
  })

/**
 * Handle single commit workflow.
 */
const handleSingleCommit = (
  git: GitService["Type"],
  ai: AIService["Type"],
  diff: string,
  options: {
    speed: SpeedTier
    dryRun: boolean
    context: string | undefined
  }
) =>
  Effect.gen(function* () {
    yield* Console.log(`Analyzing changes (${options.speed} mode)...`)

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
      options.context
        ? { speed: options.speed, context: options.context, recentCommits }
        : { speed: options.speed, recentCommits }
    )

    yield* Console.log(formatMessage(message))

    if (options.dryRun) {
      return
    }

    // Open editor for review and commit
    yield* commitWithEditor(message)
    yield* Console.log(`\n✓ Committed: ${message.split("\n")[0]}`)
  })

/**
 * The commit command implementation.
 */
export const commitCommand = Command.make(
  "commit",
  commitOptions,
  ({ fast, medium, slow, dryRun, stagedOnly, context }) =>
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

      // Get current status to check what we're working with
      const status = yield* git.getStatus()
      const allFiles = [...status.staged, ...status.unstaged, ...status.untracked]

      if (allFiles.length === 0) {
        return yield* Effect.fail(
          new NoStagedChangesError({
            message: "No changes found. Make some changes first!",
          })
        )
      }

      // Auto-split if we have a large changeset
      if (shouldAutoSplit(allFiles)) {
        return yield* handleSplitCommit(git, ai, allFiles, { speed, dryRun })
      }

      // Single commit flow
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

      yield* handleSingleCommit(git, ai, diff, { speed, dryRun, context: contextValue })
    }).pipe(
      Effect.catchTags({
        NoStagedChangesError: (e) => Console.error(`\n✗ ${e.message}`),
        UserError: (e) => Console.error(`\n✗ ${e.message}`),
        GitError: (e) => Console.error(`\n✗ Git error: ${e.message}`),
        AIError: (e) => Console.error(`\n✗ AI error: ${e.message}`),
      })
    )
).pipe(Command.withDescription("Generate a commit message for staged changes"))
