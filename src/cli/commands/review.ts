import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { AIService } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { ReviewStateService } from "../../services/review-state/service"
import { UserError } from "../../types/errors"
import type { ReviewState, ChunkState, FilePreview } from "../../types/review-state"
import { requireGhCli } from "../../core/gh-utils"
import {
  listOpenPRs,
  getPRInfo,
  getPRFiles,
  getPRHeadSha,
  getRepoInfo,
  buildFilePreviews,
  parsePRNumber,
  type PRInfo,
  type PRFile,
} from "../../core/pr-utils"
import { getExistingComments, postReview, type ExistingComment } from "../../core/review-comments"
import { formatReview } from "../../core/review-format"
import { getRepoContext } from "../../core/repo-context"
import {
  aggregateChunkReviews,
  isStateStale,
  getIncompleteChunks,
  getCompletedChunks,
  createInitialState,
} from "../../core/chunked-review"

/**
 * Convert a glob pattern to a regex for matching file paths.
 * Supports: ** (any path), * (any segment), ? (single char)
 */
export const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*\*\//g, "{{GLOBSTAR_SLASH}}") // Placeholder for **/
    .replace(/\/\*\*/g, "{{SLASH_GLOBSTAR}}") // Placeholder for /**
    .replace(/\*\*/g, "{{GLOBSTAR}}") // Placeholder for standalone **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/\?/g, ".") // ? matches single char
    .replace(/{{GLOBSTAR_SLASH}}/g, "(.*\\/)?") // **/ matches zero or more dirs
    .replace(/{{SLASH_GLOBSTAR}}/g, "(\\/.*)?") // /** matches zero or more trailing
    .replace(/{{GLOBSTAR}}/g, ".*") // ** matches anything

  return new RegExp(`^${escaped}$`)
}

/**
 * Check if a file path matches any exclusion pattern.
 */
export const isExcluded = (filePath: string, patterns: readonly string[]): boolean => {
  for (const pattern of patterns) {
    if (globToRegex(pattern).test(filePath)) {
      return true
    }
  }
  return false
}

/**
 * Filter out excluded files based on config patterns.
 */
export const filterExcludedFiles = (
  files: readonly PRFile[],
  exclusions: readonly string[]
): readonly PRFile[] => {
  return files.filter((f) => !isExcluded(f.path, exclusions))
}

/**
 * PR option (number or URL).
 */
const prOption = Options.text("pr").pipe(
  Options.withAlias("r"),
  Options.withDescription("PR number or URL (optional - will list open PRs if not provided)"),
  Options.optional
)

/**
 * Other options.
 */
const postOption = Options.boolean("post").pipe(
  Options.withAlias("p"),
  Options.withDescription("Post review to GitHub (default: just display)")
)

const freshOption = Options.boolean("fresh").pipe(
  Options.withDescription("Ignore existing state, start fresh review")
)

const concurrencyOption = Options.integer("concurrency").pipe(
  Options.withAlias("c"),
  Options.withDefault(2),
  Options.withDescription("Number of chunks to review in parallel (default: 2)")
)

const reviewOptions = {
  pr: prOption,
  post: postOption,
  fresh: freshOption,
  concurrency: concurrencyOption,
}

/**
 * Interactive PR selection - show list and ask for number.
 */
const selectPR = (prs: readonly PRInfo[]): Effect.Effect<PRInfo | null, never> =>
  Effect.gen(function* () {
    yield* Console.log("\nOpen PRs:")
    yield* Console.log("")

    for (const pr of prs) {
      yield* Console.log(`  #${pr.number} - ${pr.title} (@${pr.author})`)
    }

    yield* Console.log("")
    yield* Console.log("Enter PR number to review (or press Enter to cancel):")

    // Read from stdin using readline
    const input = yield* Effect.tryPromise({
      try: async () => {
        const readline = await import("readline")
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        })
        return new Promise<string>((resolve) => {
          rl.question("", (answer) => {
            rl.close()
            resolve(answer.trim())
          })
        })
      },
      catch: () => "",
    }).pipe(Effect.catchAll(() => Effect.succeed("")))

    if (!input) {
      return null
    }

    const num = parseInt(input, 10)
    const selected = prs.find((pr) => pr.number === num)

    if (!selected) {
      yield* Console.log(`PR #${num} not found in open PRs`)
      return null
    }

    return selected
  })

/**
 * Review chunks in parallel with concurrency limit.
 */
const reviewChunksInParallel = (
  ai: AIService["Type"],
  reviewState: ReviewStateService["Type"],
  state: ReviewState,
  incompleteChunks: readonly ChunkState[],
  options: {
    title: string
    description: string
    guidelines?: string
    readme?: string
    concurrency: number
  }
): Effect.Effect<ReviewState, import("../../types/errors").AIError | import("../../types/errors").StateError> =>
  Effect.gen(function* () {
    let currentState = state

    // Process chunks with limited concurrency
    const chunkEffects = incompleteChunks.map((chunkState) =>
      Effect.gen(function* () {
        const { group } = chunkState

        // Mark as in_progress
        currentState = yield* reviewState.updateChunk(currentState, group.id, {
          status: "in_progress",
          startedAt: new Date().toISOString(),
        })

        yield* Console.log(`  Reviewing: ${group.name}...`)

        // Get full diffs for files in this group
        const filesWithDiff = state.files
          .filter((f) => group.files.includes(f.path))
          .map((f) => ({ path: f.path, diff: f.fullDiff }))

        // Review the chunk - build options object conditionally for exactOptionalPropertyTypes
        const chunkOptions: {
          title: string
          description: string
          guidelines?: string
          readme?: string
        } = {
          title: options.title,
          description: options.description,
        }
        if (options.guidelines) chunkOptions.guidelines = options.guidelines
        if (options.readme) chunkOptions.readme = options.readme

        const result = yield* ai.reviewChunk(
          {
            groupId: group.id,
            groupName: group.name,
            groupReasoning: group.reasoning,
            files: filesWithDiff,
          },
          chunkOptions
        )

        // Mark as completed
        currentState = yield* reviewState.updateChunk(currentState, group.id, {
          status: "completed",
          result,
          completedAt: new Date().toISOString(),
        })

        yield* Console.log(`  ✓ ${group.name} (${result.comments.length} comments)`)

        return result
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            // Mark as failed
            currentState = yield* reviewState.updateChunk(currentState, chunkState.group.id, {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            })
            yield* Console.log(`  ✗ ${chunkState.group.name}: ${error instanceof Error ? error.message : String(error)}`)
            return yield* Effect.fail(error)
          })
        )
      )
    )

    // Run with concurrency limit
    yield* Effect.all(chunkEffects, { concurrency: options.concurrency })

    return currentState
  })

/**
 * The review command implementation.
 */
export const reviewCommand = Command.make(
  "review",
  reviewOptions,
  ({ pr, post, fresh, concurrency }) =>
    Effect.gen(function* () {
      const ai = yield* AIService
      const reviewState = yield* ReviewStateService
      const config = yield* ConfigService

      // Check gh CLI is installed and authenticated
      yield* requireGhCli()

      // Determine which PR to review
      let prInfo: PRInfo | null = null
      const prArgValue = Option.getOrUndefined(pr)

      if (prArgValue) {
        // PR number or URL provided
        const prNumber = parsePRNumber(prArgValue)
        if (!prNumber) {
          return yield* Effect.fail(
            new UserError({
              message: `Invalid PR: ${prArgValue}\n  Use PR number (e.g., 123) or URL`,
            })
          )
        }
        prInfo = yield* getPRInfo(prNumber)
      } else {
        // List open PRs and select
        const openPRs = yield* listOpenPRs()
        if (openPRs.length === 0) {
          return yield* Effect.fail(
            new UserError({ message: "No open PRs found in this repository" })
          )
        }
        prInfo = yield* selectPR(openPRs)
        if (!prInfo) {
          yield* Console.log("\nCancelled.")
          return
        }
      }

      yield* Console.log(`\nReviewing PR #${prInfo.number}: ${prInfo.title}`)

      // Get repo info and head SHA
      const repoInfo = yield* getRepoInfo()
      const headSha = yield* getPRHeadSha(prInfo.number)

      // Check for existing state
      let state: ReviewState | null = null
      if (!fresh) {
        state = yield* reviewState.load(repoInfo.owner, repoInfo.repo, prInfo.number).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        )

        if (state && isStateStale(state, headSha)) {
          yield* Console.log("PR has new commits since last review, starting fresh...")
          yield* reviewState.delete(repoInfo.owner, repoInfo.repo, prInfo.number)
          state = null
        }
      }

      // Fetch repo context
      const repoContext = yield* getRepoContext()
      if (repoContext.guidelines) {
        yield* Console.log("Found repo guidelines")
      }

      // Start new or resume
      if (!state) {
        // Fetch PR files
        yield* Console.log("Fetching PR files...")
        const allPrFiles = yield* getPRFiles(prInfo.number)

        if (allPrFiles.length === 0) {
          return yield* Effect.fail(
            new UserError({ message: "PR has no changed files" })
          )
        }

        // Filter out excluded files (generated files, etc.)
        const exclusions = yield* config.getReviewExclusions()
        const prFiles = filterExcludedFiles(allPrFiles, exclusions)
        const excludedCount = allPrFiles.length - prFiles.length

        if (excludedCount > 0) {
          yield* Console.log(`Found ${allPrFiles.length} changed file(s), excluding ${excludedCount} generated/excluded`)
        } else {
          yield* Console.log(`Found ${prFiles.length} changed file(s)`)
        }

        if (prFiles.length === 0) {
          yield* Console.log("All files are excluded from review")
          return
        }

        // Build file previews
        yield* Console.log("Building file previews...")
        const filePreviews = yield* buildFilePreviews(prFiles)

        // Group files using AI
        yield* Console.log("Grouping files for parallel review...")
        const groups = yield* ai.groupFilesForReview(filePreviews, {
          title: prInfo.title,
          description: prInfo.body,
        })

        yield* Console.log(`Created ${groups.length} review group(s):`)
        for (const group of groups) {
          yield* Console.log(`  - ${group.name} (${group.files.length} files)`)
        }

        // Create and save initial state
        state = createInitialState(repoInfo, prInfo, headSha, filePreviews as FilePreview[], groups)
        yield* reviewState.save(state)
      } else {
        const incomplete = getIncompleteChunks(state)
        const completed = getCompletedChunks(state)
        yield* Console.log(`Resuming review: ${completed.length} completed, ${incomplete.length} remaining`)
      }

      // Review incomplete chunks
      const incompleteChunks = getIncompleteChunks(state)

      if (incompleteChunks.length > 0) {
        yield* Console.log(`\nReviewing ${incompleteChunks.length} chunk(s) with concurrency ${concurrency}...`)

        const reviewOptions: {
          title: string
          description: string
          guidelines?: string
          readme?: string
          concurrency: number
        } = {
          title: prInfo.title,
          description: prInfo.body,
          concurrency,
        }
        if (repoContext.guidelines) reviewOptions.guidelines = repoContext.guidelines
        if (repoContext.readme) reviewOptions.readme = repoContext.readme

        state = yield* reviewChunksInParallel(ai, reviewState, state, incompleteChunks, reviewOptions)
      }

      // Aggregate results
      const completedResults = getCompletedChunks(state)

      if (completedResults.length === 0) {
        yield* Console.log("\nNo review results (all chunks failed?)")
        return
      }

      const review = aggregateChunkReviews(completedResults)

      // Display review
      yield* Console.log(formatReview(review, prInfo.number))

      // Clean up state on success
      yield* reviewState.delete(repoInfo.owner, repoInfo.repo, prInfo.number)

      // Post to GitHub if requested
      if (post) {
        // Fetch existing comments to avoid duplicates
        yield* Console.log("\nChecking for existing comments...")
        const existingComments = yield* getExistingComments(prInfo.number).pipe(
          Effect.catchAll(() => Effect.succeed([] as readonly ExistingComment[]))
        )

        if (existingComments.length > 0) {
          yield* Console.log(`Found ${existingComments.length} existing comment(s)`)
        }

        // --post flag means post without confirmation (for automation)
        yield* Console.log("\nPosting review to GitHub...")
        const result = yield* postReview(prInfo.number, review, existingComments)

        // Build status message
        const parts: string[] = []
        if (result.inlinePosted > 0) {
          parts.push(`${result.inlinePosted} inline`)
        }
        if (result.inlineFailed > 0) {
          parts.push(`${result.inlineFailed} in body`)
        }
        if (result.skipped > 0) {
          parts.push(`${result.skipped} skipped`)
        }

        const status = parts.length > 0 ? ` (${parts.join(", ")})` : ""
        yield* Console.log(`✓ Review posted${status}`)
      }
    }).pipe(
      Effect.catchTags({
        UserError: (e) => Console.error(`\n✗ ${e.message}`),
        GitError: (e) =>
          Console.error(`\n✗ Git error: ${e.message}\n  Try: gh pr list`),
        AIError: (e) =>
          Console.error(
            e.retryable
              ? `\n✗ AI error: ${e.message}\n  This may be a rate limit - try again in a moment`
              : `\n✗ AI error: ${e.message}\n  Check your API key with: gritty auth status`
          ),
        StateError: (e) =>
          Console.error(`\n✗ State error: ${e.message}`),
        ConfigError: (e) =>
          Console.error(`\n✗ Config error: ${e.message}`),
      })
    )
).pipe(Command.withDescription("AI-powered chunked code review for PRs"))
