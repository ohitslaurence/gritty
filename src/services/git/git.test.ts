import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { DiffContent, BranchName } from "../../types/branded"
import { GitService } from "./service"
import { TestGitService } from "./test"

describe("GitService", () => {
  describe("TestGitService.withStagedDiff", () => {
    it("returns the configured diff", async () => {
      const diff = "diff --git a/file.ts b/file.ts\n+added line"
      const layer = TestGitService.withStagedDiff(diff)

      const result = await Effect.gen(function* () {
        const git = yield* GitService
        return yield* git.getStagedDiff()
      }).pipe(Effect.provide(layer), Effect.runPromise)

      expect(String(result)).toBe(diff)
    })
  })

  describe("TestGitService.withCommitCapture", () => {
    it("captures the commit message", async () => {
      let capturedMessage = ""
      const layer = TestGitService.withCommitCapture((msg) => {
        capturedMessage = msg
      })

      await Effect.gen(function* () {
        const git = yield* GitService
        yield* git.commit("test: my commit message")
      }).pipe(Effect.provide(layer), Effect.runPromise)

      expect(capturedMessage).toBe("test: my commit message")
    })
  })
})

describe("GitService integration", () => {
  it("provides correct service implementation", async () => {
    const layer = TestGitService.make({
      isGitRepo: () => Effect.succeed(true),
      getBranchName: () => Effect.succeed(BranchName("feature/test")),
      getStagedDiff: () => Effect.succeed(DiffContent("some diff content")),
    })

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      const isRepo = yield* git.isGitRepo()
      const branch = yield* git.getBranchName()
      const diff = yield* git.getStagedDiff()
      return { isRepo, branch: String(branch), diff: String(diff) }
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result.isRepo).toBe(true)
    expect(result.branch).toBe("feature/test")
    expect(result.diff).toBe("some diff content")
  })

  it("defaults to sensible values in empty layer", async () => {
    const layer = TestGitService.empty

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      const isRepo = yield* git.isGitRepo()
      const branch = yield* git.getBranchName()
      const diff = yield* git.getStagedDiff()
      const status = yield* git.getStatus()
      return { isRepo, branch: String(branch), diff: String(diff), status }
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result.isRepo).toBe(true)
    expect(result.branch).toBe("main")
    expect(result.diff).toBe("")
    expect(result.status).toEqual({ staged: [], unstaged: [], untracked: [] })
  })
})
