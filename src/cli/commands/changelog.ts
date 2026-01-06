import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { AIService } from "../../services/ai/service"
import { GitError } from "../../types/errors"

/**
 * Range option for commit range (e.g., main..HEAD, abc123..def456).
 */
const rangeOption = Options.text("range").pipe(
  Options.withAlias("R"),
  Options.withDescription("Commit range (e.g., main..HEAD, origin/main..main)"),
  Options.optional
)

/**
 * Since option for time-based filtering.
 */
const sinceOption = Options.text("since").pipe(
  Options.withAlias("s"),
  Options.withDescription("Show commits since date (e.g., yesterday, '2 weeks ago', 2024-01-01)"),
  Options.optional
)

/**
 * Count option for limiting commits.
 */
const countOption = Options.integer("count").pipe(
  Options.withAlias("n"),
  Options.withDescription("Maximum number of commits to include"),
  Options.optional
)

const changelogOptions = {
  range: rangeOption,
  since: sinceOption,
  count: countOption,
}

/**
 * Get commits using git log.
 */
const getCommits = (options: {
  range?: string | undefined
  since?: string | undefined
  count?: number | undefined
}): Effect.Effect<
  readonly { hash: string; message: string; author: string; date: string }[],
  GitError
> =>
  Effect.tryPromise({
    try: async () => {
      // Use null byte as delimiter to handle any characters in commit messages
      const args = ["git", "log", "--format=%H%x00%ad%x00%an%x00%s", "--date=short"]

      // Add range if specified
      if (options.range) {
        args.push(options.range)
      }

      // Add since if specified
      if (options.since) {
        args.push(`--since=${options.since}`)
      }

      // Add count if specified
      if (options.count) {
        args.push(`-n`, String(options.count))
      }

      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || "Failed to get commits")
      }

      const lines = stdout.trim().split("\n").filter(Boolean)

      return lines.map((line) => {
        const [hash, date, author, message] = line.split("\0")
        return {
          hash: hash ?? "",
          date: date ?? "",
          author: author ?? "",
          message: message ?? "",
        }
      })
    },
    catch: (error) =>
      new GitError({
        operation: "log",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * The changelog command implementation.
 */
export const changelogCommand = Command.make(
  "changelog",
  changelogOptions,
  ({ range, since, count }) =>
    Effect.gen(function* () {
      const ai = yield* AIService

      // Build options from provided flags
      const rangeValue = Option.getOrUndefined(range)
      const sinceValue = Option.getOrUndefined(since)
      const countValue = Option.getOrUndefined(count)

      // Default to main..HEAD if no options provided
      const effectiveRange = !rangeValue && !sinceValue && !countValue ? "main..HEAD" : rangeValue

      // Get commits
      yield* Console.log("Fetching commits...")

      const commits = yield* getCommits({
        range: effectiveRange,
        since: sinceValue,
        count: countValue,
      })

      if (commits.length === 0) {
        yield* Console.log("No commits found")
        return
      }

      yield* Console.log(`Found ${commits.length} commit(s)`)
      yield* Console.log("Generating changelog...\n")

      // Generate changelog with AI
      const changelog = yield* ai.generateChangelog(commits, { speed: "fast" })

      yield* Console.log(changelog)
    }).pipe(
      Effect.catchTags({
        GitError: (e) => Console.error(`\n✗ Git error: ${e.message}`),
        AIError: (e) =>
          Console.error(
            e.retryable
              ? `\n✗ AI error: ${e.message}\n  This may be a rate limit - try again in a moment`
              : `\n✗ AI error: ${e.message}\n  Check your API key with: gritty auth status`
          ),
      })
    )
).pipe(
  Command.withDescription("Generate a changelog from commits")
)
