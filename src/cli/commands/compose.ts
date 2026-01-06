import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { DiffContent } from "../../types/branded"
import { NoStagedChangesError, UserError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"
import { AIService, type ProposedCommit } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { GitService } from "../../services/git/service"
import { confirmWithFeedback, promptText, confirm } from "../../core/prompt"
import { commitWithEditor } from "../../core/git-utils"

/**
 * Speed tier options.
 */
const fastOption = Options.boolean("fast").pipe(
  Options.withAlias("f"),
  Options.withDescription("Use Haiku for speed (~1s, good for simple changes)")
)

const slowOption = Options.boolean("slow").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use Opus for quality (best for complex refactors)")
)

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Preview proposed commits without executing")
)

const acceptOption = Options.boolean("accept").pipe(
  Options.withAlias("a"),
  Options.withDescription("Skip all confirmation prompts (for automation)")
)

const composeOptions = {
  fast: fastOption,
  slow: slowOption,
  dryRun: dryRunOption,
  accept: acceptOption,
}

/**
 * Format proposed commits for display.
 */
const formatProposedCommits = (commits: readonly ProposedCommit[]): string => {
  const separator = "─".repeat(60)
  const lines = [`\n${separator}`, "Proposed commits:", separator, ""]

  commits.forEach((commit, i) => {
    lines.push(`${i + 1}. ${commit.title}`)
    lines.push(`   Files: ${commit.files.join(", ")}`)
    lines.push(`   Reason: ${commit.reason}`)
    lines.push("")
  })

  lines.push(separator)
  return lines.join("\n")
}

/**
 * Execute a single proposed commit.
 */
const executeCommit = (
  git: GitService["Type"],
  ai: AIService["Type"],
  commit: ProposedCommit,
  options: {
    speed: SpeedTier
    accept: boolean
    recentCommits: readonly { hash: string; message: string; author: string; date: Date }[]
  }
) =>
  Effect.gen(function* () {
    // Unstage everything first
    yield* git.unstageAll().pipe(Effect.catchAll(() => Effect.void))

    // Stage only this commit's files
    yield* git.stageFiles(commit.files)

    // Get the actual diff for these files
    const diff = yield* git.getDiffForFiles(commit.files)

    if (!diff || diff.trim().length === 0) {
      yield* Console.log(`  Skipping "${commit.title}" (no changes)`)
      return
    }

    // Generate full commit message
    yield* Console.log(`\n  Generating message for: ${commit.title}...`)
    const message = yield* ai.generateCommitMessage(DiffContent(diff), {
      speed: options.speed,
      recentCommits: options.recentCommits,
      context: `Commit title: ${commit.title}. Reason: ${commit.reason}`,
    })

    yield* Console.log(`\n  Message: ${message.split("\n")[0]}`)

    // Auto-accept or confirm
    const shouldCommit = options.accept ? true : yield* confirm("  Commit this?")

    if (shouldCommit) {
      const committed = yield* commitWithEditor(message)
      if (committed) {
        yield* Console.log(`  ✓ Committed`)
      } else {
        yield* Console.log(`  Aborted`)
      }
    } else {
      yield* Console.log(`  Skipped`)
    }
  })

/**
 * The compose command - intelligently splits changes into logical commits.
 */
export const composeCommand = Command.make(
  "compose",
  composeOptions,
  ({ fast, slow, dryRun, accept }) =>
    Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService
      const config = yield* ConfigService

      // Check if we're in a git repo
      const isRepo = yield* git.isGitRepo()
      if (!isRepo) {
        return yield* Effect.fail(
          new UserError({ message: "Not a git repository. Run this command inside a git project." })
        )
      }

      // Determine speed: CLI flags override config default
      const defaultSpeed = yield* config.getDefaultSpeed()
      const speed = fast ? "fast" : slow ? "slow" : defaultSpeed

      // Get all changed files
      const status = yield* git.getStatus()
      const allFiles = [...status.staged, ...status.unstaged, ...status.untracked]

      if (allFiles.length === 0) {
        return yield* Effect.fail(
          new NoStagedChangesError({
            message: "No changes found. Make some changes first!",
          })
        )
      }

      yield* Console.log(`Analyzing ${allFiles.length} changed files...`)

      // Get diffs for all files
      const filesWithDiffs: { path: string; diff: string }[] = []
      for (const file of allFiles) {
        const diff = yield* git.getFileDiff(file)
        if (diff.trim()) {
          filesWithDiffs.push({ path: file, diff })
        }
      }

      if (filesWithDiffs.length === 0) {
        return yield* Effect.fail(
          new NoStagedChangesError({
            message: "No actual changes found in files.",
          })
        )
      }

      // Main feedback loop
      let feedback: string | undefined
      let proposedCommits: readonly ProposedCommit[] = []

      while (true) {
        yield* Console.log(feedback ? "\nRe-analyzing with feedback..." : "\nAnalyzing changes with AI...")

        // Get AI to propose commit groupings
        proposedCommits = yield* ai.composeCommits(
          filesWithDiffs,
          feedback ? { speed, feedback } : { speed }
        )

        // Display proposed commits
        yield* Console.log(formatProposedCommits(proposedCommits))

        // Dry run stops here
        if (dryRun) {
          yield* Console.log("(Dry run - no commits created)")
          return
        }

        // Auto-accept skips confirmation
        if (accept) {
          break
        }

        // Ask for confirmation
        const response = yield* confirmWithFeedback("Proceed with these commits?")

        if (response === "yes") {
          break
        } else if (response === "no") {
          yield* Console.log("\nAborted.")
          return
        } else {
          // Get feedback
          feedback = yield* promptText("\nHow should the commits be grouped differently?\n> ")
          if (!feedback.trim()) {
            yield* Console.log("No feedback provided, keeping current grouping.")
            break
          }
        }
      }

      // Execute commits
      yield* Console.log("\nExecuting commits...\n")

      // Get recent commits for style
      const recentCommits = yield* git.getRecentCommits(10).pipe(
        Effect.catchAll(() => Effect.succeed([] as const))
      )

      for (const commit of proposedCommits) {
        yield* executeCommit(git, ai, commit, { speed, accept, recentCommits })
      }

      yield* Console.log(`\n✓ Compose complete`)
    }).pipe(
      Effect.catchTags({
        NoStagedChangesError: (e) => Console.error(`\n✗ ${e.message}`),
        UserError: (e) => Console.error(`\n✗ ${e.message}`),
        GitError: (e) =>
          Console.error(
            `\n✗ Git error: ${e.message}\n  Try: git status`
          ),
        AIError: (e) =>
          Console.error(
            e.retryable
              ? `\n✗ AI error: ${e.message}\n  This may be a rate limit - try again in a moment`
              : `\n✗ AI error: ${e.message}\n  Check your API key with: gritty auth status`
          ),
        ConfigError: (e) =>
          Console.error(
            `\n✗ Config error: ${e.message}\n  Check your .grittyrc file for syntax errors`
          ),
      })
    )
).pipe(Command.withDescription("Intelligently compose changes into logical commits"))
