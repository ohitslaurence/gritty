import { Effect } from "effect"
import { unlink } from "fs/promises"
import type { PRReview } from "../services/ai/service"
import { GitError } from "../types/errors"

/**
 * Existing comment on a PR.
 */
export interface ExistingComment {
  path: string
  line: number | null
  body: string
}

/**
 * Get existing review comments on a PR.
 */
export const getExistingComments = (prNumber: number): Effect.Effect<readonly ExistingComment[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      const comments: ExistingComment[] = []

      // Get inline review comments and general comments in parallel
      const [inlineProc, generalProc] = await Promise.all([
        (async () => {
          const proc = Bun.spawn(
            ["gh", "api", `repos/{owner}/{repo}/pulls/${prNumber}/comments`],
            { stdout: "pipe", stderr: "pipe" }
          )
          const json = await new Response(proc.stdout).text()
          await proc.exited
          return { exitCode: proc.exitCode, json }
        })(),
        (async () => {
          const proc = Bun.spawn(
            ["gh", "pr", "view", String(prNumber), "--json", "comments", "--jq", ".comments[].body"],
            { stdout: "pipe", stderr: "pipe" }
          )
          const stdout = await new Response(proc.stdout).text()
          await proc.exited
          return { exitCode: proc.exitCode, stdout }
        })(),
      ])

      // Parse inline comments
      if (inlineProc.exitCode === 0 && inlineProc.json.trim()) {
        try {
          const parsed = JSON.parse(inlineProc.json) as Array<{ path: string; line: number | null; body: string }>
          for (const c of parsed) {
            comments.push({ path: c.path, line: c.line, body: c.body })
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Add general PR comments (no file/line)
      if (generalProc.exitCode === 0) {
        for (const line of generalProc.stdout.split("\n").filter(Boolean)) {
          comments.push({ path: "", line: null, body: line })
        }
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
export const isDuplicateComment = (
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
      const keywords = newLower.split(/\s+/).filter((w) => w.length > 5)
      const matchCount = keywords.filter((k) => existingLower.includes(k)).length
      if (matchCount > keywords.length * 0.5) {
        return true
      }
    }
  }
  return false
}

/**
 * PR metadata for posting comments.
 */
interface PRMetadata {
  sha: string
  isOwnPR: boolean
}

/**
 * Get PR metadata (SHA and author) for inline comments.
 */
const getPRMetadata = async (prNumber: number): Promise<PRMetadata | null> => {
  const proc = Bun.spawn(
    ["gh", "pr", "view", String(prNumber), "--json", "headRefOid,author", "--jq", ".headRefOid + \" \" + .author.login"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const output = (await new Response(proc.stdout).text()).trim()
  await proc.exited

  if (proc.exitCode !== 0 || !output) return null

  const [sha, prAuthor] = output.split(" ")
  if (!sha) return null

  // Check if current user is the PR author
  const whoamiProc = Bun.spawn(["gh", "api", "user", "--jq", ".login"], { stdout: "pipe", stderr: "pipe" })
  const currentUser = (await new Response(whoamiProc.stdout).text()).trim()
  await whoamiProc.exited

  return { sha, isOwnPR: currentUser === prAuthor }
}

/**
 * Post a single inline comment. Returns true if successful.
 */
const postInlineComment = async (
  prNumber: number,
  sha: string,
  comment: { path: string; line: number; body: string }
): Promise<boolean> => {
  const payload = {
    body: comment.body,
    commit_id: sha,
    path: comment.path,
    line: comment.line,
    side: "RIGHT", // Comment on the new version
  }

  const tmpFile = `/tmp/gritty-comment-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
      await unlink(tmpFile)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Format severity emoji for comment body.
 */
const severityEmoji = (severity: string): string => {
  switch (severity) {
    case "critical":
      return "🚨"
    case "suggestion":
      return "💡"
    case "nitpick":
      return "📝"
    default:
      return "✨"
  }
}

/**
 * Result of posting a review.
 */
export interface PostReviewResult {
  posted: number
  inlinePosted: number
  inlineFailed: number
  skipped: number
}

/**
 * Post review to GitHub with inline comments.
 * Strategy: Post inline comments one-by-one, then post the summary review.
 */
export const postReview = (
  prNumber: number,
  review: PRReview,
  existingComments: readonly ExistingComment[]
): Effect.Effect<PostReviewResult, GitError> =>
  Effect.tryPromise({
    try: async () => {
      // Get PR metadata upfront (SHA for inline comments, isOwnPR for verdict)
      const metadata = await getPRMetadata(prNumber)
      if (!metadata) {
        throw new Error("Failed to fetch PR metadata (SHA/author)")
      }

      // Determine event - can't request changes on own PR, so use COMMENT instead
      let event =
        review.verdict === "approve"
          ? "APPROVE"
          : review.verdict === "request_changes"
            ? "REQUEST_CHANGES"
            : "COMMENT"

      if (metadata.isOwnPR && event === "REQUEST_CHANGES") {
        event = "COMMENT" // Can't request changes on own PR
      }

      // Filter out duplicate comments
      const newComments = review.comments.filter((c) => !isDuplicateComment(c, existingComments))
      const skipped = review.comments.length - newComments.length

      // Separate comments with and without line numbers
      const inlineComments = newComments.filter((c) => c.line)
      const bodyComments = newComments.filter((c) => !c.line)

      // Post inline comments one-by-one (sequential to avoid rate limits)
      const inlineResults: { comment: (typeof inlineComments)[0]; success: boolean }[] = []

      for (const comment of inlineComments) {
        const emoji = severityEmoji(comment.severity)
        const commentBody = `${emoji} **${comment.severity.toUpperCase()}**: ${comment.comment}`
        const line = comment.line ?? 0

        // Post sequentially to track individual success/failure
        // oxlint-disable-next-line no-await-in-loop
        const success = line > 0 ? await postInlineComment(prNumber, metadata.sha, { path: comment.file, line, body: commentBody }) : false

        inlineResults.push({ comment, success })
      }

      const inlinePosted = inlineResults.filter((r) => r.success).length
      const inlineFailed = inlineResults.filter((r) => !r.success).length
      const failedComments = inlineResults.filter((r) => !r.success).map((r) => r.comment)

      // Build review body with summary
      let body = review.summary

      // Add comments that don't have line numbers
      if (bodyComments.length > 0) {
        body += "\n\n---\n\n"
        for (const comment of bodyComments) {
          const emoji = severityEmoji(comment.severity)
          body += `${emoji} **${comment.file}**\n${comment.comment}\n\n`
        }
      }

      // Add failed inline comments to body
      if (failedComments.length > 0) {
        body += "\n\n---\n\n**Additional comments** (couldn't post inline):\n\n"
        for (const comment of failedComments) {
          const emoji = severityEmoji(comment.severity)
          body += `${emoji} **${comment.file}:${comment.line}**\n${comment.comment}\n\n`
        }
      }

      // Post the main review (summary + verdict)
      const eventFlag =
        event === "APPROVE" ? "--approve" : event === "REQUEST_CHANGES" ? "--request-changes" : "--comment"

      const proc = Bun.spawn(["gh", "pr", "review", String(prNumber), eventFlag, "--body", body], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || "Failed to post review")
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
