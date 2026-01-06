import type { PRReview, ReviewComment } from "../services/ai/service"
import type { ReviewState, ChunkState, ChunkReviewResult } from "../types/review-state"
import { isDuplicateComment, type ExistingComment } from "./review-comments"

/**
 * Aggregate multiple chunk reviews into a single PRReview.
 */
export const aggregateChunkReviews = (
  chunks: readonly ChunkReviewResult[]
): PRReview => {
  // Collect all comments with deduplication
  const allComments: ReviewComment[] = []
  const summaries: string[] = []

  for (const chunk of chunks) {
    summaries.push(chunk.summary)

    for (const comment of chunk.comments) {
      // Convert to ExistingComment format for dedup check
      const existingFormat: ExistingComment[] = allComments.map((c) => ({
        path: c.file,
        line: c.line ?? null,
        body: c.comment,
      }))

      if (!isDuplicateComment(comment, existingFormat)) {
        allComments.push(comment)
      }
    }
  }

  // Determine verdict: worst across all chunks
  const verdicts = chunks.map((c) => c.verdict)
  let finalVerdict: PRReview["verdict"] = "approve"
  if (verdicts.includes("request_changes")) {
    finalVerdict = "request_changes"
  } else if (verdicts.includes("comment")) {
    finalVerdict = "comment"
  }

  // Synthesize summary
  const summary = synthesizeSummary(summaries, finalVerdict, allComments.length)

  return {
    summary,
    verdict: finalVerdict,
    comments: allComments,
  }
}

/**
 * Clean up a chunk summary by removing "This chunk..." prefix.
 */
const cleanSummary = (summary: string): string => {
  // Remove common prefixes like "This chunk...", "This section..."
  return summary
    .replace(/^This chunk\s+/i, "")
    .replace(/^This section\s+/i, "")
    .replace(/^The chunk\s+/i, "")
    .replace(/^The section\s+/i, "")
}

/**
 * Synthesize a summary from chunk summaries.
 */
const synthesizeSummary = (
  summaries: readonly string[],
  verdict: PRReview["verdict"],
  commentCount: number
): string => {
  // Clean all summaries first
  const cleaned = summaries.map(cleanSummary)

  // For small PRs with 1-2 chunks, just join summaries
  if (cleaned.length <= 2) {
    return cleaned.join(" ")
  }

  // For larger PRs, create an overview
  const verdictText =
    verdict === "approve"
      ? "Approved"
      : verdict === "request_changes"
        ? "Changes requested"
        : "Comments provided"

  const header = `**${verdictText}** - Reviewed ${cleaned.length} sections with ${commentCount} comment(s).\n\n`

  return header + cleaned.map((s, i) => `- **Section ${i + 1}**: ${s}`).join("\n")
}

/**
 * Check if a review state is stale (PR has new commits).
 */
export const isStateStale = (state: ReviewState, currentSha: string): boolean => {
  return state.headSha !== currentSha
}

/**
 * Get incomplete chunks that need review.
 */
export const getIncompleteChunks = (state: ReviewState): readonly ChunkState[] => {
  return state.chunks.filter((c) => c.status !== "completed")
}

/**
 * Get completed chunks with results.
 */
export const getCompletedChunks = (state: ReviewState): readonly ChunkReviewResult[] => {
  return state.chunks
    .filter((c): c is ChunkState & { result: ChunkReviewResult } => c.status === "completed" && c.result !== undefined)
    .map((c) => c.result)
}

/**
 * Create initial review state from grouped files.
 */
export const createInitialState = (
  repoInfo: { owner: string; repo: string },
  prInfo: { number: number },
  headSha: string,
  files: ReviewState["files"],
  groups: readonly ReviewState["chunks"][number]["group"][]
): ReviewState => {
  const now = new Date().toISOString()

  return {
    version: 1,
    prNumber: prInfo.number,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    headSha,
    files,
    chunks: groups.map((group) => ({
      group,
      status: "pending" as const,
    })),
    startedAt: now,
    updatedAt: now,
  }
}
