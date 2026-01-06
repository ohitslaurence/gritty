import { Schema } from "effect"

/**
 * Status of a single chunk in the review process.
 */
export const ChunkStatus = Schema.Literal("pending", "in_progress", "completed", "failed")
export type ChunkStatus = typeof ChunkStatus.Type

/**
 * A file with preview information for grouping.
 */
export const FilePreview = Schema.Struct({
  path: Schema.String,
  /** First 30 lines of the file content (imports, structure) */
  contentPreview: Schema.String,
  /** First ~100 lines of the diff */
  diffPreview: Schema.String,
  /** Full diff for this file */
  fullDiff: Schema.String,
})
export type FilePreview = typeof FilePreview.Type

/**
 * A group of related files determined by AI.
 */
export const FileGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  reasoning: Schema.String,
  files: Schema.Array(Schema.String),
})
export type FileGroup = typeof FileGroup.Type

/**
 * A single review comment.
 */
export const ReviewCommentSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  severity: Schema.Literal("critical", "suggestion", "nitpick", "praise"),
  comment: Schema.String,
})
export type ReviewCommentSchema = typeof ReviewCommentSchema.Type

/**
 * Result from reviewing a single chunk.
 */
export const ChunkReviewResult = Schema.Struct({
  groupId: Schema.String,
  summary: Schema.String,
  verdict: Schema.Literal("approve", "request_changes", "comment"),
  comments: Schema.Array(ReviewCommentSchema),
})
export type ChunkReviewResult = typeof ChunkReviewResult.Type

/**
 * State of a single chunk.
 */
export const ChunkState = Schema.Struct({
  group: FileGroup,
  status: ChunkStatus,
  result: Schema.optional(ChunkReviewResult),
  error: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
})
export type ChunkState = typeof ChunkState.Type

/**
 * Full review state persisted to disk.
 */
export const ReviewState = Schema.Struct({
  version: Schema.Literal(1),
  prNumber: Schema.Number,
  owner: Schema.String,
  repo: Schema.String,
  /** SHA at time review started - to detect if PR changed */
  headSha: Schema.String,
  /** All file previews */
  files: Schema.Array(FilePreview),
  /** Grouped chunks with their status */
  chunks: Schema.Array(ChunkState),
  /** When the review was started */
  startedAt: Schema.String,
  /** Last update time */
  updatedAt: Schema.String,
})
export type ReviewState = typeof ReviewState.Type
