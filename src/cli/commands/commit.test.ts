import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { DiffContent } from "../../types/branded"
import { TestAIService } from "../../services/ai/test"
import { TestGitService } from "../../services/git/test"

/**
 * Helper to create a test layer combining Git and AI services.
 */
const makeTestLayer = (opts: {
  diff?: string
  isGitRepo?: boolean
  aiResponse?: string
  onCommit?: (msg: string) => void
}) => {
  const gitLayer = TestGitService.make({
    isGitRepo: () => Effect.succeed(opts.isGitRepo ?? true),
    getStagedDiff: () => Effect.succeed(DiffContent(opts.diff ?? "diff content")),
    stageAll: () => Effect.void,
    commit: opts.onCommit
      ? (msg) => {
          opts.onCommit?.(msg)
          return Effect.void
        }
      : () => Effect.void,
  })

  const aiLayer = TestAIService.withResponse(opts.aiResponse ?? "feat: test commit")

  return Layer.merge(gitLayer, aiLayer)
}

describe("commit command logic", () => {
  describe("getSpeedTier", () => {
    it("returns fast when fast flag is set", () => {
      const getSpeedTier = (fast: boolean, _medium: boolean, slow: boolean) => {
        if (fast) return "fast"
        if (slow) return "slow"
        return "medium"
      }

      expect(getSpeedTier(true, false, false)).toBe("fast")
    })

    it("returns slow when slow flag is set", () => {
      const getSpeedTier = (fast: boolean, _medium: boolean, slow: boolean) => {
        if (fast) return "fast"
        if (slow) return "slow"
        return "medium"
      }

      expect(getSpeedTier(false, false, true)).toBe("slow")
    })

    it("returns medium by default", () => {
      const getSpeedTier = (fast: boolean, _medium: boolean, slow: boolean) => {
        if (fast) return "fast"
        if (slow) return "slow"
        return "medium"
      }

      expect(getSpeedTier(false, false, false)).toBe("medium")
      expect(getSpeedTier(false, true, false)).toBe("medium")
    })
  })

  describe("formatMessage", () => {
    it("formats message with separator", () => {
      const formatMessage = (message: string): string => {
        const separator = "─".repeat(60)
        return `
Generated commit message:
${separator}
${message}
${separator}`
      }

      const result = formatMessage("feat: add feature")
      expect(result).toContain("Generated commit message:")
      expect(result).toContain("feat: add feature")
      expect(result).toContain("─".repeat(60))
    })
  })
})

describe("commit workflow integration", () => {
  it("generates commit message from diff", async () => {
    const layer = makeTestLayer({
      diff: "diff --git a/file.ts\n+new code",
      aiResponse: "feat(core): add new functionality",
    })

    const { GitService } = await import("../../services/git/service")
    const { AIService } = await import("../../services/ai/service")

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService

      const diff = yield* git.getStagedDiff()
      const message = yield* ai.generateCommitMessage(diff, { speed: "medium" })
      return String(message)
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toBe("feat(core): add new functionality")
  })

  it("commits with generated message", async () => {
    let committedMessage = ""
    const layer = makeTestLayer({
      diff: "some diff",
      aiResponse: "fix: resolve bug",
      onCommit: (msg) => {
        committedMessage = msg
      },
    })

    const { GitService } = await import("../../services/git/service")
    const { AIService } = await import("../../services/ai/service")

    await Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService

      const diff = yield* git.getStagedDiff()
      const message = yield* ai.generateCommitMessage(diff, { speed: "fast" })
      yield* git.commit(String(message))
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(committedMessage).toBe("fix: resolve bug")
  })

  it("respects speed tier option", async () => {
    let capturedSpeed = ""
    const gitLayer = TestGitService.make({
      getStagedDiff: () => Effect.succeed(DiffContent("diff")),
    })
    const aiLayer = TestAIService.withCapture((_, options) => {
      capturedSpeed = options.speed
      return "test commit"
    })
    const layer = Layer.merge(gitLayer, aiLayer)

    const { GitService } = await import("../../services/git/service")
    const { AIService } = await import("../../services/ai/service")

    await Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService

      const diff = yield* git.getStagedDiff()
      yield* ai.generateCommitMessage(diff, { speed: "slow" })
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(capturedSpeed).toBe("slow")
  })

  it("passes context to AI when provided", async () => {
    let capturedContext = ""
    const gitLayer = TestGitService.make({
      getStagedDiff: () => Effect.succeed(DiffContent("diff")),
    })
    const aiLayer = TestAIService.withCapture((_, options) => {
      capturedContext = options.context ?? ""
      return "test commit"
    })
    const layer = Layer.merge(gitLayer, aiLayer)

    const { GitService } = await import("../../services/git/service")
    const { AIService } = await import("../../services/ai/service")

    await Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService

      const diff = yield* git.getStagedDiff()
      yield* ai.generateCommitMessage(diff, {
        speed: "medium",
        context: "fixing the auth bug from issue #123",
      })
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(capturedContext).toBe("fixing the auth bug from issue #123")
  })

  it("handles empty diff", async () => {
    const layer = makeTestLayer({
      diff: "",
      aiResponse: "should not reach",
    })

    const { GitService } = await import("../../services/git/service")

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      const diff = yield* git.getStagedDiff()
      return String(diff).trim().length === 0
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toBe(true)
  })

  it("handles not a git repo", async () => {
    const layer = makeTestLayer({
      isGitRepo: false,
    })

    const { GitService } = await import("../../services/git/service")

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      return yield* git.isGitRepo()
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toBe(false)
  })
})
