import { Effect, Layer } from "effect"
import type { StateError } from "../../types/errors"
import type { ReviewState } from "../../types/review-state"
import { ReviewStateService, type ReviewStateServiceImpl } from "./service"

/**
 * Create a test ReviewStateService with configurable behavior.
 */
export const TestReviewStateService = {
  /**
   * Create a test layer with a pre-loaded state.
   */
  withState: (state: ReviewState | null): Layer.Layer<ReviewStateService> => {
    let currentState = state

    return Layer.succeed(
      ReviewStateService,
      ReviewStateService.of({
        getStatePath: (owner, repo, prNumber) =>
          `/tmp/test-reviews/${owner}-${repo}-${prNumber}.json`,
        load: () => Effect.succeed(currentState),
        save: (newState) => {
          currentState = newState
          return Effect.succeed(undefined)
        },
        updateChunk: (existingState, groupId, update) => {
          const chunks = existingState.chunks.map((chunk) =>
            chunk.group.id === groupId ? { ...chunk, ...update } : chunk
          )
          const updated: ReviewState = {
            ...existingState,
            chunks,
            updatedAt: new Date().toISOString(),
          }
          currentState = updated
          return Effect.succeed(updated)
        },
        delete: () => {
          currentState = null
          return Effect.succeed(undefined)
        },
        clearAll: () => {
          currentState = null
          return Effect.succeed({ count: 1 })
        },
      })
    )
  },

  /**
   * Create a test layer with an in-memory store.
   */
  inMemory: (): Layer.Layer<ReviewStateService> => {
    const store = new Map<string, ReviewState>()

    return Layer.succeed(
      ReviewStateService,
      ReviewStateService.of({
        getStatePath: (owner, repo, prNumber) =>
          `${owner}-${repo}-${prNumber}`,
        load: (owner, repo, prNumber) => {
          const key = `${owner}-${repo}-${prNumber}`
          return Effect.succeed(store.get(key) ?? null)
        },
        save: (state) => {
          const key = `${state.owner}-${state.repo}-${state.prNumber}`
          store.set(key, state)
          return Effect.succeed(undefined)
        },
        updateChunk: (state, groupId, update) => {
          const chunks = state.chunks.map((chunk) =>
            chunk.group.id === groupId ? { ...chunk, ...update } : chunk
          )
          const updated: ReviewState = {
            ...state,
            chunks,
            updatedAt: new Date().toISOString(),
          }
          const key = `${state.owner}-${state.repo}-${state.prNumber}`
          store.set(key, updated)
          return Effect.succeed(updated)
        },
        delete: (owner, repo, prNumber) => {
          const key = `${owner}-${repo}-${prNumber}`
          store.delete(key)
          return Effect.succeed(undefined)
        },
        clearAll: () => {
          const count = store.size
          store.clear()
          return Effect.succeed({ count })
        },
      })
    )
  },

  /**
   * Create a test layer with save/load capture callbacks.
   */
  withCapture: (callbacks: {
    onSave?: (state: ReviewState) => void
    onLoad?: (owner: string, repo: string, prNumber: number) => ReviewState | null
  }): Layer.Layer<ReviewStateService> =>
    Layer.succeed(
      ReviewStateService,
      ReviewStateService.of({
        getStatePath: (owner, repo, prNumber) =>
          `/tmp/test-reviews/${owner}-${repo}-${prNumber}.json`,
        load: (owner, repo, prNumber) =>
          Effect.succeed(callbacks.onLoad?.(owner, repo, prNumber) ?? null),
        save: (state) => {
          callbacks.onSave?.(state)
          return Effect.succeed(undefined)
        },
        updateChunk: (state, groupId, update) => {
          const chunks = state.chunks.map((chunk) =>
            chunk.group.id === groupId ? { ...chunk, ...update } : chunk
          )
          const updated: ReviewState = {
            ...state,
            chunks,
            updatedAt: new Date().toISOString(),
          }
          callbacks.onSave?.(updated)
          return Effect.succeed(updated)
        },
        delete: () => Effect.succeed(undefined),
        clearAll: () => Effect.succeed({ count: 0 }),
      })
    ),

  /**
   * Create a test layer with a custom implementation.
   */
  make: (impl: Partial<ReviewStateServiceImpl>): Layer.Layer<ReviewStateService> =>
    Layer.succeed(
      ReviewStateService,
      ReviewStateService.of({
        getStatePath:
          impl.getStatePath ??
          ((owner, repo, prNumber) => `/tmp/test-reviews/${owner}-${repo}-${prNumber}.json`),
        load: impl.load ?? (() => Effect.succeed(null)),
        save: impl.save ?? (() => Effect.succeed(undefined)),
        updateChunk:
          impl.updateChunk ??
          ((state, groupId, update) => {
            const chunks = state.chunks.map((chunk) =>
              chunk.group.id === groupId ? { ...chunk, ...update } : chunk
            )
            return Effect.succeed({
              ...state,
              chunks,
              updatedAt: new Date().toISOString(),
            })
          }),
        delete: impl.delete ?? (() => Effect.succeed(undefined)),
        clearAll: impl.clearAll ?? (() => Effect.succeed({ count: 0 })),
      })
    ),

  /**
   * Create a test layer that fails with an error.
   */
  withError: (error: StateError): Layer.Layer<ReviewStateService> =>
    Layer.succeed(
      ReviewStateService,
      ReviewStateService.of({
        getStatePath: () => "/tmp/error",
        load: () => Effect.fail(error),
        save: () => Effect.fail(error),
        updateChunk: () => Effect.fail(error),
        delete: () => Effect.fail(error),
        clearAll: () => Effect.fail(error),
      })
    ),

  /**
   * Default test layer with no stored state.
   */
  default: Layer.succeed(
    ReviewStateService,
    ReviewStateService.of({
      getStatePath: (owner, repo, prNumber) =>
        `/tmp/test-reviews/${owner}-${repo}-${prNumber}.json`,
      load: () => Effect.succeed(null),
      save: () => Effect.succeed(undefined),
      updateChunk: (state, groupId, update) => {
        const chunks = state.chunks.map((chunk) =>
          chunk.group.id === groupId ? { ...chunk, ...update } : chunk
        )
        return Effect.succeed({
          ...state,
          chunks,
          updatedAt: new Date().toISOString(),
        })
      },
      delete: () => Effect.succeed(undefined),
      clearAll: () => Effect.succeed({ count: 0 }),
    })
  ),
}
