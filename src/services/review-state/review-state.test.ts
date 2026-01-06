import { describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import type { ReviewState, FileGroup, ChunkReviewResult } from "../../types/review-state"
import { ReviewStateService } from "./service"
import { TestReviewStateService } from "./test"

// Test fixtures
const createFileGroup = (overrides: Partial<FileGroup> = {}): FileGroup => ({
  id: "group-1",
  name: "Core files",
  reasoning: "Related core functionality",
  files: ["src/index.ts"],
  ...overrides,
})

const createChunkResult = (overrides: Partial<ChunkReviewResult> = {}): ChunkReviewResult => ({
  groupId: "group-1",
  summary: "Looks good.",
  verdict: "approve",
  comments: [],
  ...overrides,
})

const createReviewState = (overrides: Partial<ReviewState> = {}): ReviewState => ({
  version: 1,
  prNumber: 123,
  owner: "testowner",
  repo: "testrepo",
  headSha: "abc123",
  files: [],
  chunks: [
    { group: createFileGroup({ id: "g1" }), status: "pending" },
    { group: createFileGroup({ id: "g2", name: "Tests" }), status: "pending" },
  ],
  startedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
})

describe("ReviewStateService", () => {
  describe("TestReviewStateService.withState", () => {
    it("returns null when no state exists", async () => {
      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.load("owner", "repo", 1)
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.withState(null)))
      )

      expect(result).toBeNull()
    })

    it("returns state when it exists", async () => {
      const state = createReviewState()
      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.load("testowner", "testrepo", 123)
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.withState(state)))
      )

      expect(result).not.toBeNull()
      expect(result?.prNumber).toBe(123)
      expect(result?.owner).toBe("testowner")
    })

    it("saves state and makes it retrievable", async () => {
      const state = createReviewState()
      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        yield* service.save(state)
        return yield* service.load("testowner", "testrepo", 123)
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.withState(null)))
      )

      expect(result).not.toBeNull()
      expect(result?.prNumber).toBe(123)
    })

    it("delete clears the state", async () => {
      const state = createReviewState()
      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        yield* service.delete("testowner", "testrepo", 123)
        return yield* service.load("testowner", "testrepo", 123)
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.withState(state)))
      )

      expect(result).toBeNull()
    })
  })

  describe("TestReviewStateService.inMemory", () => {
    it("stores and retrieves multiple states", async () => {
      const state1 = createReviewState({ prNumber: 1, owner: "org1", repo: "repo1" })
      const state2 = createReviewState({ prNumber: 2, owner: "org1", repo: "repo1" })

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        yield* service.save(state1)
        yield* service.save(state2)

        const loaded1 = yield* service.load("org1", "repo1", 1)
        const loaded2 = yield* service.load("org1", "repo1", 2)
        const loaded3 = yield* service.load("org1", "repo1", 999)

        return { loaded1, loaded2, loaded3 }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.inMemory()))
      )

      expect(result.loaded1?.prNumber).toBe(1)
      expect(result.loaded2?.prNumber).toBe(2)
      expect(result.loaded3).toBeNull()
    })

    it("clearAll removes all states", async () => {
      const state1 = createReviewState({ prNumber: 1, owner: "org1", repo: "repo1" })
      const state2 = createReviewState({ prNumber: 2, owner: "org1", repo: "repo1" })

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        yield* service.save(state1)
        yield* service.save(state2)

        const cleared = yield* service.clearAll()

        const loaded1 = yield* service.load("org1", "repo1", 1)
        const loaded2 = yield* service.load("org1", "repo1", 2)

        return { cleared, loaded1, loaded2 }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.inMemory()))
      )

      expect(result.cleared.count).toBe(2)
      expect(result.loaded1).toBeNull()
      expect(result.loaded2).toBeNull()
    })
  })

  describe("updateChunk", () => {
    it("updates chunk status", async () => {
      const state = createReviewState()

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.updateChunk(state, "g1", { status: "in_progress" })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.default))
      )

      expect(result.chunks[0]?.status).toBe("in_progress")
      expect(result.chunks[1]?.status).toBe("pending") // Other chunks unchanged
    })

    it("updates chunk with result", async () => {
      const state = createReviewState()
      const chunkResult = createChunkResult({ groupId: "g1" })

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.updateChunk(state, "g1", {
          status: "completed",
          result: chunkResult,
        })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.default))
      )

      expect(result.chunks[0]?.status).toBe("completed")
      expect(result.chunks[0]?.result?.verdict).toBe("approve")
    })

    it("updates chunk with error", async () => {
      const state = createReviewState()

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.updateChunk(state, "g1", {
          status: "failed",
          error: "API rate limit exceeded",
        })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.default))
      )

      expect(result.chunks[0]?.status).toBe("failed")
      expect(result.chunks[0]?.error).toBe("API rate limit exceeded")
    })

    it("sets timestamps", async () => {
      const state = createReviewState()
      const startTime = new Date().toISOString()

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.updateChunk(state, "g1", {
          status: "in_progress",
          startedAt: startTime,
        })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.default))
      )

      expect(result.chunks[0]?.startedAt).toBe(startTime)
    })

    it("updates updatedAt timestamp", async () => {
      const oldTime = "2020-01-01T00:00:00.000Z"
      const state = createReviewState({ updatedAt: oldTime })

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.updateChunk(state, "g1", { status: "in_progress" })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.default))
      )

      expect(result.updatedAt).not.toBe(oldTime)
      expect(new Date(result.updatedAt).getTime()).toBeGreaterThan(
        new Date(oldTime).getTime()
      )
    })
  })

  describe("getStatePath", () => {
    it("generates correct path format", async () => {
      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return service.getStatePath("myorg", "myrepo", 42)
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestReviewStateService.default))
      )

      expect(result).toContain("myorg-myrepo-42.json")
    })
  })

  describe("TestReviewStateService.withCapture", () => {
    it("captures save operations", async () => {
      const savedStates: ReviewState[] = []
      const state = createReviewState()

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        yield* service.save(state)
        yield* service.save({ ...state, prNumber: 456 })
      })

      await Effect.runPromise(
        program.pipe(
          Effect.provide(
            TestReviewStateService.withCapture({
              onSave: (s) => savedStates.push(s),
            })
          )
        )
      )

      expect(savedStates).toHaveLength(2)
      expect(savedStates[0]?.prNumber).toBe(123)
      expect(savedStates[1]?.prNumber).toBe(456)
    })

    it("provides custom load responses", async () => {
      const customState = createReviewState({ prNumber: 999 })

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.load("any", "repo", 999)
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(
            TestReviewStateService.withCapture({
              onLoad: (_owner, _repo, prNumber) =>
                prNumber === 999 ? customState : null,
            })
          )
        )
      )

      expect(result?.prNumber).toBe(999)
    })
  })

  describe("TestReviewStateService.withError", () => {
    it("fails all operations with error", async () => {
      const { StateError } = await import("../../types/errors")
      const error = new StateError({
        operation: "test",
        message: "Test error",
      })

      const program = Effect.gen(function* () {
        const service = yield* ReviewStateService
        return yield* service.load("owner", "repo", 1)
      })

      const result = await Effect.runPromiseExit(
        program.pipe(Effect.provide(TestReviewStateService.withError(error)))
      )

      expect(Exit.isFailure(result)).toBe(true)
    })
  })
})
