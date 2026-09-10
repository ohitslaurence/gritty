import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { DiffContent } from "../../types/branded"
import { NoStagedChangesError, UserError } from "../../types/errors"
import { AIService } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { GitService } from "../../services/git/service"
import { confirmWithEdit, confirm } from "../../core/prompt"
import { isDiffTooLarge } from "../../core/split"
import { commitWithEditor } from "../../core/git-utils"
import { makeOutput, reportError, type Output } from "../../core/output"
import {
  executeComposedCommits,
  formatProposedCommits,
  type CommittedResult,
} from "../../core/compose-executor"

/**
 * File count threshold for triage.
 * Below this, skip triage and commit normally.
 */
const TRIAGE_THRESHOLD = 4

/**
 * Speed tier options - mutually exclusive flags.
 */
const fastOption = Options.boolean("fast").pipe(
  Options.withAlias("f"),
  Options.withDescription("Use Haiku for speed (~1s, good for simple changes)")
)

const slowOption = Options.boolean("slow").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use Opus for quality (best for complex refactors)")
)

/**
 * Other options.
 */
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Preview message without committing")
)

const acceptOption = Options.boolean("accept").pipe(
  Options.withAlias("a"),
  Options.withDescription("Skip confirmation prompt (for automation)")
)

const allOption = Options.boolean("all").pipe(
  Options.withAlias("A"),
  Options.withDescription("Stage all changes, even if files are already staged")
)

const stagedOnlyOption = Options.boolean("staged-only").pipe(
  Options.withDescription("Never auto-stage; fail if nothing is staged")
)

const contextOption = Options.text("context").pipe(
  Options.withAlias("c"),
  Options.withDescription("Context for AI (e.g., 'fixes issue #123')"),
  Options.optional
)

const trailerOption = Options.text("trailer").pipe(
  Options.withAlias("t"),
  Options.withDescription("Trailer to append (repeatable), e.g. 'Co-Authored-By: Name <email>'"),
  Options.repeated
)

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable result on stdout; progress goes to stderr")
)

/**
 * Combine options into the commit command options.
 */
const commitOptions = {
  fast: fastOption,
  slow: slowOption,
  dryRun: dryRunOption,
  accept: acceptOption,
  all: allOption,
  stagedOnly: stagedOnlyOption,
  context: contextOption,
  trailer: trailerOption,
  json: jsonOption,
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
 * Decide what to stage.
 * - `--all`: stage everything.
 * - index already has files: use them as-is (respect deliberate staging).
 * - `--staged-only` with empty index: fail.
 * - otherwise: stage everything.
 */
export const prepareIndex = (
  git: GitService["Type"],
  output: Output,
  flags: { all: boolean; stagedOnly: boolean }
) =>
  Effect.gen(function* () {
    const before = yield* git.getStatus()

    if (flags.all) {
      yield* output.log("Staging all changes...")
      yield* git.stageAll()
      return
    }

    if (before.staged.length > 0) {
      yield* output.log(
        `Using ${before.staged.length} already-staged file(s) (pass --all to stage everything)`
      )
      return
    }

    if (flags.stagedOnly) {
      return yield* Effect.fail(
        new NoStagedChangesError({
          message: "No staged changes found. Stage files with `git add` first.",
        })
      )
    }

    yield* output.log("Staging all changes...")
    yield* git.stageAll()
  })

/**
 * The commit command implementation.
 */
export const commitCommand = Command.make(
  "commit",
  commitOptions,
  ({ fast, slow, dryRun, accept, all, stagedOnly, context, trailer, json }) =>
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
      const contextValue = Option.getOrUndefined(context)

      // Trailers: config first, then CLI
      const configTrailers = yield* config.getCommitTrailers()
      const trailers = [...configTrailers, ...trailer]

      yield* prepareIndex(git, output, { all, stagedOnly })

      const diff = yield* git.getStagedDiff()

      if (!diff || diff.trim().length === 0) {
        return yield* Effect.fail(
          new NoStagedChangesError({
            message: "No changes found (staged or unstaged). Make some changes first!",
          })
        )
      }

      // Get status to check file count for triage
      const status = yield* git.getStatus()
      const stagedFiles = status.staged
      const fileCount = stagedFiles.length

      // Triage: decide if we should compose instead
      if (fileCount >= TRIAGE_THRESHOLD) {
        yield* log(`Analyzing ${fileCount} files for commit strategy...`)

        // Get diffs for staged files
        const diffResults = yield* Effect.all(
          stagedFiles.map((file) =>
            git.getFileDiff(file).pipe(
              Effect.map((fileDiff) => ({ path: file, diff: fileDiff }))
            )
          ),
          { concurrency: 10 }
        )
        const filesWithDiffs = diffResults.filter((f) => f.diff.trim())

        // Run triage
        const triage = yield* ai.triageCommit(filesWithDiffs)

        if (triage.shouldCompose) {
          yield* log(`\n⚠ Triage suggests multiple commits: ${triage.reason}`)

          // In accept mode, auto-switch to compose
          if (accept) {
            yield* log("Switching to compose mode...")

            // Get AI to propose commit groupings
            const proposedCommits = yield* ai.composeCommits(filesWithDiffs, { speed })

            // Display proposed commits
            yield* log(formatProposedCommits(proposedCommits))

            // Dry run stops here
            if (dryRun) {
              yield* log("(Dry run - no commits created)")
              yield* emit({
                command: "commit",
                mode: "compose",
                dryRun: true,
                staged: stagedFiles,
                proposed: proposedCommits,
              })
              return
            }

            // Fetch recent commits for style
            const recentCommits = yield* git.getRecentCommits(10).pipe(
              Effect.catchAll(() => Effect.succeed([] as const))
            )

            // Execute composed commits
            const commits: readonly CommittedResult[] = yield* executeComposedCommits(
              proposedCommits,
              { speed, accept, recentCommits, trailers, output }
            )
            yield* emit({
              command: "commit",
              mode: "compose",
              dryRun: false,
              staged: stagedFiles,
              commits,
            })
            return
          }

          // Interactive: ask user if they want to compose
          const shouldCompose = yield* confirm("Would you like to compose into multiple commits?")

          if (shouldCompose) {
            yield* log("\nAnalyzing changes for commit groupings...")

            // Get AI to propose commit groupings
            const proposedCommits = yield* ai.composeCommits(filesWithDiffs, { speed })

            // Display proposed commits
            yield* log(formatProposedCommits(proposedCommits))

            // Dry run stops here
            if (dryRun) {
              yield* log("(Dry run - no commits created)")
              return
            }

            const proceedWithCompose = yield* confirm("Proceed with these commits?")

            if (proceedWithCompose) {
              // Fetch recent commits for style
              const recentCommits = yield* git.getRecentCommits(10).pipe(
                Effect.catchAll(() => Effect.succeed([] as const))
              )

              // Execute composed commits
              yield* executeComposedCommits(proposedCommits, {
                speed,
                accept,
                recentCommits,
                trailers,
                output,
              })
              return
            }

            yield* log("\nContinuing with single commit...")
          }
        }
      }

      yield* log(`Analyzing changes (${speed} mode)...`)

      // Fetch recent commits for style detection
      const recentCommits = yield* git.getRecentCommits(10).pipe(
        Effect.catchAll(() => Effect.succeed([] as const))
      )

      // Truncate diff if too large
      const diffTruncated = isDiffTooLarge(diff)
      if (diffTruncated) {
        yield* log("⚠ Large diff detected - truncating for analysis")
      }
      const safeDiff = diffTruncated
        ? diff.slice(0, 80000) + "\n\n[... diff truncated ...]"
        : diff

      // Generate commit message
      const message = yield* ai.generateCommitMessage(
        DiffContent(safeDiff),
        contextValue
          ? { speed, context: contextValue, recentCommits }
          : { speed, recentCommits }
      )
      const subject = message.split("\n")[0] ?? ""

      yield* log(formatMessage(message))

      // Dry run stops here
      if (dryRun) {
        yield* emit({
          command: "commit",
          mode: "single",
          dryRun: true,
          staged: stagedFiles,
          message,
          trailers,
        })
        return
      }

      // Auto-accept if flag is set
      if (accept) {
        const hash = yield* git.commit(message, { trailers })
        yield* log(`\n✓ Committed ${hash.slice(0, 7)}: ${subject}`)
        yield* emit({
          command: "commit",
          mode: "single",
          dryRun: false,
          staged: stagedFiles,
          message,
          commits: [{ hash, subject, files: stagedFiles }],
        })
        return
      }

      // Interactive confirmation
      const response = yield* confirmWithEdit("\nCommit with this message?")

      switch (response) {
        case "yes": {
          const hash = yield* git.commit(message, { trailers })
          yield* log(`\n✓ Committed ${hash.slice(0, 7)}: ${subject}`)
          break
        }
        case "edit": {
          const committed = yield* commitWithEditor(message, trailers)
          if (committed) {
            yield* log(`\n✓ Committed`)
          } else {
            yield* log("\nAborted.")
          }
          break
        }
        case "no":
          yield* log("\nAborted.")
          break
      }
    }).pipe(
      Effect.catchTags({
        NoStagedChangesError: (e) => reportError(makeOutput(json), e),
        UserError: (e) => reportError(makeOutput(json), e),
        GitError: (e) => reportError(makeOutput(json), e),
        AIError: (e) => reportError(makeOutput(json), e),
        ConfigError: (e) => reportError(makeOutput(json), e),
      })
    )
).pipe(
  Command.withDescription(
    "Generate a commit message (uses staged files if any, otherwise stages everything)"
  )
)
