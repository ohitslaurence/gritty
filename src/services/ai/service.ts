import { Context, Effect } from "effect"
import type { CommitMessage, DiffContent } from "../../types/branded"
import type { AIError } from "../../types/errors"
import type { GenerateOptions, SpeedTier } from "../../types/models"

/**
 * A proposed commit group from AI analysis.
 */
export interface ProposedCommit {
  readonly title: string
  readonly files: readonly string[]
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
  readonly line?: number
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
    options: { speed: SpeedTier; title: string; description: string }
  ) => Effect.Effect<PRReview, AIError>
}

/**
 * AI service tag for dependency injection.
 */
export class AIService extends Context.Tag("AIService")<AIService, AIServiceImpl>() {}
