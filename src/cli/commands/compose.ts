import { Command, Options } from "@effect/cli"
import { Effect } from "effect"
import { NoStagedChangesError, UserError } from "../../types/errors"
import type { ProposedCommit } from "../../services/ai/service"
import { AIService } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { GitService } from "../../services/git/service"
import { confirmWithFeedback, promptText } from "../../core/prompt"
import { executeComposedCommits, formatProposedCommits } from "../../core/compose-executor"
import { makeOutput, reportError } from "../../core/output"

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

const trailerOption = Options.text("trailer").pipe(
  Options.withAlias("t"),
  Options.withDescription("Trailer to append to every commit (repeatable)"),
  Options.repeated
)

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable result on stdout; progress goes to stderr")
)

const composeOptions = {
  fast: fastOption,
  slow: slowOption,
  dryRun: dryRunOption,
  accept: acceptOption,
  trailer: trailerOption,
  json: jsonOption,
}

/**
 * The compose command - intelligently splits changes into logical commits.
 */
export const composeCommand = Command.make(
  "compose",
  composeOptions,
  ({ fast, slow, dryRun, accept, trailer, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService
      const config = yield* ConfigService
      const output = makeOutput(json)
      const { log, emit } = output

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

      const configTrailers = yield* config.getCommitTrailers()
      const trailers = [...configTrailers, ...trailer]

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

      yield* log(`Analyzing ${allFiles.length} changed files...`)

      // Get diffs for all files in parallel
      const diffResults = yield* Effect.all(
        allFiles.map((file) =>
          git.getFileDiff(file).pipe(
            Effect.map((diff) => ({ path: file, diff }))
          )
        ),
        { concurrency: 10 }
      )
      const filesWithDiffs = diffResults.filter((f) => f.diff.trim())

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
        yield* log(feedback ? "\nRe-analyzing with feedback..." : "\nAnalyzing changes with AI...")

        // Get AI to propose commit groupings
        proposedCommits = yield* ai.composeCommits(
          filesWithDiffs,
          feedback ? { speed, feedback } : { speed }
        )

        // Display proposed commits
        yield* log(formatProposedCommits(proposedCommits))

        // Dry run stops here
        if (dryRun) {
          yield* log("(Dry run - no commits created)")
          yield* emit({ command: "compose", dryRun: true, proposed: proposedCommits })
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
          yield* log("\nAborted.")
          return
        } else {
          // Get feedback
          feedback = yield* promptText("\nHow should the commits be grouped differently?\n> ")
          if (!feedback.trim()) {
            yield* log("No feedback provided, keeping current grouping.")
            break
          }
        }
      }

      // Get recent commits for style
      const recentCommits = yield* git.getRecentCommits(10).pipe(
        Effect.catchAll(() => Effect.succeed([] as const))
      )

      // Execute commits using shared executor
      const commits = yield* executeComposedCommits(proposedCommits, {
        speed,
        accept,
        recentCommits,
        trailers,
        output,
      })
      yield* emit({ command: "compose", dryRun: false, commits })
    }).pipe(
      Effect.catchTags({
        NoStagedChangesError: (e) => reportError(makeOutput(json), e),
        UserError: (e) => reportError(makeOutput(json), e),
        GitError: (e) => reportError(makeOutput(json), e),
        AIError: (e) => reportError(makeOutput(json), e),
        ConfigError: (e) => reportError(makeOutput(json), e),
      })
    )
).pipe(Command.withDescription("Analyze all changes (staged, unstaged, untracked) and compose into logical commits"))
