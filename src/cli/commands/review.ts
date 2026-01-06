import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { DiffContent } from "../../types/branded"
import { AIService } from "../../services/ai/service"
import { UserError } from "../../types/errors"
import { requireGhCli } from "../../core/gh-utils"
import { listOpenPRs, getPRInfo, getPRDiff, parsePRNumber, type PRInfo } from "../../core/pr-utils"
import { getExistingComments, postReview, type ExistingComment } from "../../core/review-comments"
import { formatReview } from "../../core/review-format"

/**
 * Optional PR argument (number or URL).
 */
const prArg = Args.text({ name: "pr" }).pipe(
  Args.withDescription("PR number or URL (optional - will list open PRs if not provided)"),
  Args.optional
)

/**
 * Speed tier options.
 * Review defaults to Opus (slow) for thorough analysis.
 */
const fastOption = Options.boolean("fast").pipe(
  Options.withAlias("f"),
  Options.withDescription("Use Haiku for speed (default: Opus)")
)

const slowOption = Options.boolean("slow").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use Opus for quality (default)")
)

/**
 * Other options.
 */
const postOption = Options.boolean("post").pipe(
  Options.withAlias("p"),
  Options.withDescription("Post review to GitHub (default: just display)")
)

const reviewOptions = {
  pr: prArg,
  fast: fastOption,
  slow: slowOption,
  post: postOption,
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
 * The review command implementation.
 */
export const reviewCommand = Command.make(
  "review",
  reviewOptions,
  ({ pr, fast, slow, post }) =>
    Effect.gen(function* () {
      const ai = yield* AIService

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

      // Get PR diff
      const diff = yield* getPRDiff(prInfo.number)
      if (!diff.trim()) {
        return yield* Effect.fail(
          new UserError({ message: "PR has no diff (empty or already merged?)" })
        )
      }

      // Determine speed - review defaults to slow (Opus) for better analysis
      const speed = fast ? "fast" : slow ? "slow" : "slow"

      yield* Console.log(`Analyzing diff (${speed} mode)...`)

      // Get AI review
      const review = yield* ai.reviewPR(DiffContent(diff), {
        speed,
        title: prInfo.title,
        description: prInfo.body,
      })

      // Display review
      yield* Console.log(formatReview(review, prInfo.number))

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
      })
    )
).pipe(Command.withDescription("AI-powered code review for PRs"))
