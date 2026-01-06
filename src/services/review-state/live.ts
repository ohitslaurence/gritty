import { mkdir, unlink, readdir, rename } from "node:fs/promises"
import { Effect, Layer, Schema } from "effect"
import { StateError } from "../../types/errors"
import { ReviewState } from "../../types/review-state"
import { ReviewStateService } from "./service"

/**
 * Create the live review state service implementation.
 */
const makeReviewStateService = (): ReviewStateService["Type"] => {
  const homeDir = process.env["HOME"] ?? ""
  const stateDir = `${homeDir}/.gritty`
  const reviewsDir = `${stateDir}/reviews`

  const getStatePath = (owner: string, repo: string, prNumber: number): string =>
    `${reviewsDir}/${owner}-${repo}-${prNumber}.json`

  const ensureReviewsDir = (): Effect.Effect<void, StateError> =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(reviewsDir, { recursive: true })
      },
      catch: (error) =>
        new StateError({
          operation: "ensureReviewsDir",
          message: `Failed to create reviews directory: ${reviewsDir}`,
          cause: error,
        }),
    })

  return {
    getStatePath,

    load: (owner, repo, prNumber) =>
      Effect.gen(function* () {
        const path = getStatePath(owner, repo, prNumber)
        const file = Bun.file(path)

        if (!(yield* Effect.promise(() => file.exists()))) {
          return null
        }

        const text = yield* Effect.tryPromise({
          try: () => file.text(),
          catch: (error) =>
            new StateError({
              operation: "load",
              message: `Failed to read review state: ${path}`,
              cause: error,
            }),
        })

        const json = yield* Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (error) =>
            new StateError({
              operation: "load",
              message: `Invalid JSON in review state: ${path}`,
              cause: error,
            }),
        })

        const decoded = yield* Schema.decodeUnknown(ReviewState)(json).pipe(
          Effect.mapError(
            (error) =>
              new StateError({
                operation: "load",
                message: `Invalid review state schema: ${path}`,
                cause: error,
              })
          )
        )

        return decoded
      }),

    save: (state) =>
      Effect.gen(function* () {
        yield* ensureReviewsDir()

        const path = getStatePath(state.owner, state.repo, state.prNumber)
        const tempPath = `${path}.tmp.${Date.now()}`

        // Update timestamp
        const stateWithTimestamp = {
          ...state,
          updatedAt: new Date().toISOString(),
        }

        const json = JSON.stringify(stateWithTimestamp, null, 2)

        // Atomic write: write to temp file, then rename
        yield* Effect.tryPromise({
          try: () => Bun.write(tempPath, json),
          catch: (error) =>
            new StateError({
              operation: "save",
              message: `Failed to write temp state file: ${tempPath}`,
              cause: error,
            }),
        })

        yield* Effect.tryPromise({
          try: () => rename(tempPath, path),
          catch: (error) =>
            new StateError({
              operation: "save",
              message: `Failed to rename temp state file: ${tempPath} -> ${path}`,
              cause: error,
            }),
        })
      }),

    updateChunk: (state, groupId, update) =>
      Effect.gen(function* () {
        const chunkIndex = state.chunks.findIndex((c) => c.group.id === groupId)
        const existingChunk = state.chunks[chunkIndex]
        if (chunkIndex === -1 || !existingChunk) {
          return yield* Effect.fail(
            new StateError({
              operation: "updateChunk",
              message: `Chunk not found: ${groupId}`,
            })
          )
        }

        const updatedChunk = {
          group: existingChunk.group,
          status: update.status ?? existingChunk.status,
          result: update.result !== undefined ? update.result : existingChunk.result,
          error: update.error !== undefined ? update.error : existingChunk.error,
          startedAt: update.startedAt !== undefined ? update.startedAt : existingChunk.startedAt,
          completedAt: update.completedAt !== undefined ? update.completedAt : existingChunk.completedAt,
        }

        const updatedChunks = state.chunks.map((c, i) =>
          i === chunkIndex ? updatedChunk : c
        )

        const updatedState: ReviewState = {
          ...state,
          chunks: updatedChunks,
        }

        yield* makeReviewStateService().save(updatedState)

        return updatedState
      }),

    delete: (owner, repo, prNumber) =>
      Effect.tryPromise({
        try: async () => {
          const path = getStatePath(owner, repo, prNumber)
          const file = Bun.file(path)
          if (await file.exists()) {
            await unlink(path)
          }
        },
        catch: (error) =>
          new StateError({
            operation: "delete",
            message: `Failed to delete review state`,
            cause: error,
          }),
      }),

    clearAll: () =>
      Effect.gen(function* () {
        // Check if directory exists
        const dir = Bun.file(reviewsDir)
        if (!(yield* Effect.promise(() => dir.exists()))) {
          return { count: 0 }
        }

        const files = yield* Effect.tryPromise({
          try: () => readdir(reviewsDir),
          catch: (error) =>
            new StateError({
              operation: "clearAll",
              message: `Failed to read reviews directory`,
              cause: error,
            }),
        })

        const jsonFiles = files.filter((f) => f.endsWith(".json"))
        let count = 0

        for (const file of jsonFiles) {
          const deleted = yield* Effect.tryPromise({
            try: async () => {
              await unlink(`${reviewsDir}/${file}`)
              return true
            },
            catch: () =>
              new StateError({
                operation: "clearAll",
                message: `Failed to delete ${file}`,
              }),
          }).pipe(Effect.catchAll(() => Effect.succeed(false)))

          if (deleted) count++
        }

        return { count }
      }),
  }
}

/**
 * Live implementation of ReviewStateService.
 */
export const ReviewStateServiceLive = Layer.succeed(ReviewStateService, makeReviewStateService())
