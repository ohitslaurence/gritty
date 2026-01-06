import { Context, Effect } from "effect"
import type { StateError } from "../../types/errors"
import type { ReviewState, ChunkState } from "../../types/review-state"

/**
 * Service interface for review state persistence.
 * Manages ~/.gritty/reviews/ directory contents.
 */
export interface ReviewStateServiceImpl {
  /**
   * Get the path for a review state file.
   */
  readonly getStatePath: (owner: string, repo: string, prNumber: number) => string

  /**
   * Load existing review state, or null if none exists.
   */
  readonly load: (
    owner: string,
    repo: string,
    prNumber: number
  ) => Effect.Effect<ReviewState | null, StateError>

  /**
   * Save review state to disk.
   */
  readonly save: (state: ReviewState) => Effect.Effect<void, StateError>

  /**
   * Update a single chunk's state and save.
   */
  readonly updateChunk: (
    state: ReviewState,
    groupId: string,
    update: Partial<Pick<ChunkState, "status" | "result" | "error" | "startedAt" | "completedAt">>
  ) => Effect.Effect<ReviewState, StateError>

  /**
   * Delete review state for a PR.
   */
  readonly delete: (owner: string, repo: string, prNumber: number) => Effect.Effect<void, StateError>

  /**
   * Clear all review state files.
   */
  readonly clearAll: () => Effect.Effect<{ count: number }, StateError>
}

/**
 * Review state service tag for dependency injection.
 */
export class ReviewStateService extends Context.Tag("ReviewStateService")<
  ReviewStateService,
  ReviewStateServiceImpl
>() {}
