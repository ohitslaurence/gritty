import { Context, Effect } from "effect"
import type { CommitMessage, DiffContent } from "../../types/branded"
import type { AIError } from "../../types/errors"
import type { GenerateOptions, SpeedTier } from "../../types/models"
import type { FilePreview, FileGroup, ChunkReviewResult } from "../../types/review-state"

/**
 * A proposed commit group from AI analysis.
 */
export interface ProposedCommit {
  readonly title: string
  readonly files: readonly string[]
  readonly reason: string
}

/**
 * Result of triaging whether changes should be composed into multiple commits.
 */
export interface TriageResult {
  readonly shouldCompose: boolean
  readonly reason: string
}

/**
 * Generated PR description.
 */
export interface PRDescription {
  readonly title: string
  readonly body: string
}

/**
 * A single review comment on a specific part of the code.
 */
export interface ReviewComment {
  readonly file: string
  readonly line?: number | undefined
  readonly severity: "critical" | "suggestion" | "nitpick" | "praise"
  readonly comment: string
}

/**
 * Generated PR review.
 */
export interface PRReview {
  readonly summary: string
  readonly verdict: "approve" | "request_changes" | "comment"
  readonly comments: readonly ReviewComment[]
}

/**
 * Service interface for AI operations.
 */
export interface AIServiceImpl {
  /**
   * Generate a commit message from a diff.
   * @param diff The staged diff content
   * @param options Generation options including speed tier and context
   */
  readonly generateCommitMessage: (
    diff: DiffContent,
    options: GenerateOptions
  ) => Effect.Effect<CommitMessage, AIError>

  /**
   * Analyze changes and propose logical commit groupings.
   * @param files List of changed files with their diffs
   * @param options Options including speed tier and optional feedback
   */
  readonly composeCommits: (
    files: readonly { path: string; diff: string }[],
    options: { speed: SpeedTier; feedback?: string }
  ) => Effect.Effect<readonly ProposedCommit[], AIError>

  /**
   * Generate a PR title and description from commits and diff.
   */
  readonly generatePRDescription: (
    commits: readonly { message: string }[],
    diff: DiffContent,
    options: { speed: SpeedTier; context?: string; baseBranch: string; branchName: string }
  ) => Effect.Effect<PRDescription, AIError>

  /**
   * Review a PR diff and provide feedback.
   */
  readonly reviewPR: (
    diff: DiffContent,
    options: {
      speed: SpeedTier
      title: string
      description: string
      /** Repository guidelines from CLAUDE.md/agents.md */
      guidelines?: string
      /** README content for project context */
      readme?: string
    }
  ) => Effect.Effect<PRReview, AIError>

  /**
   * Group PR files into logical chunks for parallel review.
   * Uses fast model (Haiku) for speed.
   */
  readonly groupFilesForReview: (
    files: readonly FilePreview[],
    options: {
      title: string
      description: string
    }
  ) => Effect.Effect<readonly FileGroup[], AIError>

  /**
   * Review a single chunk of related files.
   * Uses slow model (Opus) for quality.
   */
  readonly reviewChunk: (
    chunk: {
      groupId: string
      groupName: string
      groupReasoning: string
      files: readonly { path: string; diff: string }[]
    },
    options: {
      title: string
      description: string
      guidelines?: string
      readme?: string
    }
  ) => Effect.Effect<ChunkReviewResult, AIError>

  /**
   * Generate a changelog from commit messages.
   * Groups commits by type and produces clean markdown.
   */
  readonly generateChangelog: (
    commits: readonly { hash: string; message: string; author: string; date: string }[],
    options: { speed: SpeedTier }
  ) => Effect.Effect<string, AIError>

  /**
   * Triage changes to decide if they should be a single commit or composed.
   * Uses fast model for quick decision-making.
   * @param files List of changed files with their diffs (diffs will be truncated)
   */
  readonly triageCommit: (
    files: readonly { path: string; diff: string }[]
  ) => Effect.Effect<TriageResult, AIError>
}

/**
 * AI service tag for dependency injection.
 */
export class AIService extends Context.Tag("AIService")<AIService, AIServiceImpl>() {}
