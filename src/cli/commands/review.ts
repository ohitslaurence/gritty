import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { DiffContent } from "../../types/branded"
import { AIService, type PRReview } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { UserError, GitError } from "../../types/errors"

/**
 * Optional PR argument (number or URL).
 */
const prArg = Args.text({ name: "pr" }).pipe(
  Args.withDescription("PR number or URL (optional - will list open PRs if not provided)"),
  Args.optional
)

/**
 * Speed tier options.
 */
const fastOption = Options.boolean("fast").pipe(
  Options.withAlias("f"),
  Options.withDescription("Use Haiku for speed")
)

const slowOption = Options.boolean("slow").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use Opus for quality")
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
 * Check if gh CLI is installed.
 */
const checkGhInstalled = (): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "--version"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

/**
 * Check if gh CLI is authenticated.
 */
const checkGhAuth = (): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

/**
 * PR info from gh CLI.
 */
interface PRInfo {
  number: number
  title: string
  body: string
  author: string
}

/**
 * List open PRs.
 */
const listOpenPRs = (): Effect.Effect<readonly PRInfo[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["gh", "pr", "list", "--json", "number,title,body,author", "--limit", "20"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || "Failed to list PRs")
      }

      const prs = JSON.parse(stdout) as Array<{
        number: number
        title: string
        body: string
        author: { login: string }
      }>

      return prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        author: pr.author.login,
      }))
    },
    catch: (error) =>
      new GitError({
        operation: "pr list",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Get PR info by number.
 */
const getPRInfo = (prNumber: number): Effect.Effect<PRInfo, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["gh", "pr", "view", String(prNumber), "--json", "number,title,body,author"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || `Failed to get PR #${prNumber}`)
      }

      const pr = JSON.parse(stdout) as {
        number: number
        title: string
        body: string
        author: { login: string }
      }

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        author: pr.author.login,
      }
    },
    catch: (error) =>
      new GitError({
        operation: "pr view",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Get PR diff.
 */
const getPRDiff = (prNumber: number): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "pr", "diff", String(prNumber)], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || `Failed to get diff for PR #${prNumber}`)
      }

      return stdout
    },
    catch: (error) =>
      new GitError({
        operation: "pr diff",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Existing comment on a PR.
 */
interface ExistingComment {
  path: string
  line: number | null
  body: string
}

/**
 * Get existing review comments on a PR.
 */
const getExistingComments = (prNumber: number): Effect.Effect<readonly ExistingComment[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      // Get review comments (inline comments)
      const proc = Bun.spawn(
        ["gh", "api", `repos/{owner}/{repo}/pulls/${prNumber}/comments`, "--jq", ".[].path, .[].line, .[].body"],
        { stdout: "pipe", stderr: "pipe" }
      )
      await proc.exited

      // Also get issue comments (general PR comments)
      const proc2 = Bun.spawn(
        ["gh", "pr", "view", String(prNumber), "--json", "comments", "--jq", ".comments[].body"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stdout2 = await new Response(proc2.stdout).text()
      await proc2.exited

      // Parse review comments - gh api returns JSON array
      const comments: ExistingComment[] = []

      try {
        const proc3 = Bun.spawn(
          ["gh", "api", `repos/{owner}/{repo}/pulls/${prNumber}/comments`],
          { stdout: "pipe", stderr: "pipe" }
        )
        const json = await new Response(proc3.stdout).text()
        await proc3.exited

        const parsed = JSON.parse(json) as Array<{ path: string; line: number | null; body: string }>
        for (const c of parsed) {
          comments.push({ path: c.path, line: c.line, body: c.body })
        }
      } catch {
        // Ignore parse errors
      }

      // Add general comments (no file/line)
      for (const line of stdout2.split("\n").filter(Boolean)) {
        comments.push({ path: "", line: null, body: line })
      }

      return comments
    },
    catch: (error) =>
      new GitError({
        operation: "get comments",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Check if a comment is similar to an existing one.
 */
const isDuplicateComment = (
  newComment: { file: string; line?: number; comment: string },
  existing: readonly ExistingComment[]
): boolean => {
  for (const e of existing) {
    // Same file and line
    if (e.path === newComment.file && e.line === newComment.line) {
      // Check if content is similar (contains key phrases)
      const newLower = newComment.comment.toLowerCase()
      const existingLower = e.body.toLowerCase()

      // If existing comment contains similar keywords, consider it duplicate
      const keywords = newLower.split(/\s+/).filter(w => w.length > 5)
      const matchCount = keywords.filter(k => existingLower.includes(k)).length
      if (matchCount > keywords.length * 0.5) {
        return true
      }
    }
  }
  return false
}

/**
 * Post a single inline comment. Returns true if successful.
 */
const postInlineComment = async (
  prNumber: number,
  comment: { path: string; line: number; body: string }
): Promise<boolean> => {
  const payload = {
    body: comment.body,
    commit_id: "", // Will be filled by getting latest commit
    path: comment.path,
    line: comment.line,
    side: "RIGHT", // Comment on the new version
  }

  // First get the latest commit SHA for the PR
  const shaProc = Bun.spawn(
    ["gh", "pr", "view", String(prNumber), "--json", "headRefOid", "--jq", ".headRefOid"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const sha = (await new Response(shaProc.stdout).text()).trim()
  await shaProc.exited
  if (!sha) return false

  payload.commit_id = sha

  const tmpFile = `/tmp/gritty-comment-${Date.now()}.json`
  await Bun.write(tmpFile, JSON.stringify(payload))

  try {
    const proc = Bun.spawn(
      ["gh", "api", "--method", "POST", `repos/{owner}/{repo}/pulls/${prNumber}/comments`, "--input", tmpFile],
      { stdout: "pipe", stderr: "pipe" }
    )
    await proc.exited
    return proc.exitCode === 0
  } finally {
    try {
      await Bun.file(tmpFile).exists() && await Bun.write(tmpFile, "")
    } catch {
      // Ignore
    }
  }
}

/**
 * Post review to GitHub with inline comments.
 * Strategy: Post inline comments one-by-one, then post the summary review.
 */
const postReview = (
  prNumber: number,
  review: PRReview,
  existingComments: readonly ExistingComment[]
): Effect.Effect<{ posted: number; inlinePosted: number; inlineFailed: number; skipped: number }, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const event =
        review.verdict === "approve"
          ? "APPROVE"
          : review.verdict === "request_changes"
            ? "REQUEST_CHANGES"
            : "COMMENT"

      // Filter out duplicate comments
      const newComments = review.comments.filter(c => !isDuplicateComment(c, existingComments))
      const skipped = review.comments.length - newComments.length

      // Separate comments with and without line numbers
      const inlineComments = newComments.filter(c => c.line)
      const bodyComments = newComments.filter(c => !c.line)

      // Post inline comments one-by-one (sequential to avoid rate limits)
      const inlineResults: { comment: typeof inlineComments[0]; success: boolean }[] = []

      for (const comment of inlineComments) {
        const severity = comment.severity === "critical" ? "🚨" : comment.severity === "suggestion" ? "💡" : comment.severity === "nitpick" ? "📝" : "✨"
        const commentBody = `${severity} **${comment.severity.toUpperCase()}**: ${comment.comment}`
        const line = comment.line ?? 0

        // eslint-disable-next-line no-await-in-loop -- intentional: post sequentially to track individual success/failure
        const success = line > 0 ? await postInlineComment(prNumber, {
          path: comment.file,
          line,
          body: commentBody,
        }) : false

        inlineResults.push({ comment, success })
      }

      const inlinePosted = inlineResults.filter(r => r.success).length
      const inlineFailed = inlineResults.filter(r => !r.success).length
      const failedComments = inlineResults.filter(r => !r.success).map(r => r.comment)

      // Build review body with summary
      let body = review.summary

      // Add comments that don't have line numbers
      if (bodyComments.length > 0) {
        body += "\n\n---\n\n"
        for (const comment of bodyComments) {
          const severity =
            comment.severity === "critical"
              ? "🚨"
              : comment.severity === "suggestion"
                ? "💡"
                : comment.severity === "nitpick"
                  ? "📝"
                  : "✨"
          body += `${severity} **${comment.file}**\n${comment.comment}\n\n`
        }
      }

      // Add failed inline comments to body
      if (failedComments.length > 0) {
        body += "\n\n---\n\n**Additional comments** (couldn't post inline):\n\n"
        for (const comment of failedComments) {
          const severity =
            comment.severity === "critical"
              ? "🚨"
              : comment.severity === "suggestion"
                ? "💡"
                : comment.severity === "nitpick"
                  ? "📝"
                  : "✨"
          body += `${severity} **${comment.file}:${comment.line}**\n${comment.comment}\n\n`
        }
      }

      // Post the main review (summary + verdict)
      const eventFlag =
        event === "APPROVE"
          ? "--approve"
          : event === "REQUEST_CHANGES"
            ? "--request-changes"
            : "--comment"

      const proc = Bun.spawn(
        ["gh", "pr", "review", String(prNumber), eventFlag, "--body", body],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        // Can't request changes on your own PR - fallback to comment
        if (stderr.includes("your own pull request") && event !== "COMMENT") {
          const fallbackProc = Bun.spawn(
            ["gh", "pr", "review", String(prNumber), "--comment", "--body", body],
            { stdout: "pipe", stderr: "pipe" }
          )
          const fallbackStderr = await new Response(fallbackProc.stderr).text()
          await fallbackProc.exited

          if (fallbackProc.exitCode !== 0) {
            throw new Error(fallbackStderr || "Failed to post review")
          }
        } else {
          throw new Error(stderr || "Failed to post review")
        }
      }

      return { posted: newComments.length, inlinePosted, inlineFailed, skipped }
    },
    catch: (error) =>
      new GitError({
        operation: "pr review",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Extract PR number from URL or string.
 */
const parsePRNumber = (input: string): number | null => {
  // Direct number
  const num = parseInt(input, 10)
  if (!isNaN(num) && num > 0) {
    return num
  }

  // GitHub URL: https://github.com/owner/repo/pull/123
  const urlMatch = input.match(/\/pull\/(\d+)/)
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10)
  }

  return null
}

/**
 * Format severity with emoji.
 */
const formatSeverity = (severity: string): string => {
  switch (severity) {
    case "critical":
      return "🚨 CRITICAL"
    case "suggestion":
      return "💡 Suggestion"
    case "nitpick":
      return "📝 Nitpick"
    case "praise":
      return "✨ Praise"
    default:
      return severity
  }
}

/**
 * Format verdict with emoji.
 */
const formatVerdict = (verdict: string): string => {
  switch (verdict) {
    case "approve":
      return "✅ APPROVE"
    case "request_changes":
      return "🔴 REQUEST CHANGES"
    case "comment":
      return "💬 COMMENT"
    default:
      return verdict
  }
}

/**
 * Format review for display.
 */
const formatReview = (review: PRReview, prNumber: number): string => {
  const separator = "─".repeat(60)
  const lines = [
    "",
    separator,
    `PR #${prNumber} Review`,
    separator,
    "",
    `Verdict: ${formatVerdict(review.verdict)}`,
    "",
    review.summary,
    "",
  ]

  if (review.comments.length > 0) {
    lines.push(separator)
    lines.push("Comments:")
    lines.push("")

    for (const comment of review.comments) {
      const location = comment.line ? `:${comment.line}` : ""
      lines.push(`${formatSeverity(comment.severity)}`)
      lines.push(`  ${comment.file}${location}`)
      lines.push(`  ${comment.comment}`)
      lines.push("")
    }
  }

  lines.push(separator)
  return lines.join("\n")
}

/**
 * Simple PR selection - just show list and ask for number.
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
      const config = yield* ConfigService

      // Check gh CLI
      const ghInstalled = yield* checkGhInstalled()
      if (!ghInstalled) {
        return yield* Effect.fail(
          new UserError({
            message: "GitHub CLI (gh) not found.\n  Install: https://cli.github.com/",
          })
        )
      }

      const ghAuthed = yield* checkGhAuth()
      if (!ghAuthed) {
        return yield* Effect.fail(
          new UserError({
            message: "GitHub CLI not authenticated.\n  Run: gh auth login",
          })
        )
      }

      // Determine which PR to review
      let prInfo: PRInfo | null = null
      const prArg = Option.getOrUndefined(pr)

      if (prArg) {
        // PR number or URL provided
        const prNumber = parsePRNumber(prArg)
        if (!prNumber) {
          return yield* Effect.fail(
            new UserError({
              message: `Invalid PR: ${prArg}\n  Use PR number (e.g., 123) or URL`,
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

      // Determine speed
      const defaultSpeed = yield* config.getDefaultSpeed()
      const speed = fast ? "fast" : slow ? "slow" : defaultSpeed

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
        ConfigError: (e) =>
          Console.error(
            `\n✗ Config error: ${e.message}\n  Check your .grittyrc file for syntax errors`
          ),
      })
    )
).pipe(Command.withDescription("AI-powered code review for PRs"))
