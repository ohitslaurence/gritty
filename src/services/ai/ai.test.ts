import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { DiffContent } from "../../types/branded"
import { AIError } from "../../types/errors"
import { AIService } from "./service"
import { TestAIService } from "./test"

describe("AIService", () => {
  describe("TestAIService.withResponse", () => {
    it("returns the configured response", async () => {
      const response = "feat: add user authentication"
      const layer = TestAIService.withResponse(response)

      const result = await Effect.gen(function* () {
        const ai = yield* AIService
        return yield* ai.generateCommitMessage(DiffContent("some diff"), { speed: "medium" })
      }).pipe(Effect.provide(layer), Effect.runPromise)

      expect(String(result)).toBe(response)
    })
  })

  describe("TestAIService.withCapture", () => {
    it("captures diff and options", async () => {
      let capturedDiff = ""
      let capturedSpeed = ""

      const layer = TestAIService.withCapture((diff, options) => {
        capturedDiff = String(diff)
        capturedSpeed = options.speed
        return "captured: " + options.speed
      })

      const diff = DiffContent("diff --git a/file.ts\n+new line")
      const result = await Effect.gen(function* () {
        const ai = yield* AIService
        return yield* ai.generateCommitMessage(diff, { speed: "fast" })
      }).pipe(Effect.provide(layer), Effect.runPromise)

      expect(capturedDiff).toBe(String(diff))
      expect(capturedSpeed).toBe("fast")
      expect(String(result)).toBe("captured: fast")
    })

    it("captures context when provided", async () => {
      let capturedContext = ""

      const layer = TestAIService.withCapture((_, options) => {
        capturedContext = options.context ?? "none"
        return "ok"
      })

      await Effect.gen(function* () {
        const ai = yield* AIService
        yield* ai.generateCommitMessage(DiffContent("diff"), {
          speed: "medium",
          context: "fixing bug in auth",
        })
      }).pipe(Effect.provide(layer), Effect.runPromise)

      expect(capturedContext).toBe("fixing bug in auth")
    })
  })

  describe("TestAIService.withError", () => {
    it("returns the configured error", async () => {
      const error = new AIError({
        message: "Rate limited",
        retryable: true,
        cause: undefined,
      })
      const layer = TestAIService.withError(error)

      const result = await Effect.gen(function* () {
        const ai = yield* AIService
        return yield* ai.generateCommitMessage(DiffContent("diff"), { speed: "medium" })
      }).pipe(
        Effect.provide(layer),
        Effect.either,
        Effect.runPromise
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AIError")
        expect(result.left.message).toBe("Rate limited")
      }
    })
  })

  describe("TestAIService.default", () => {
    it("returns a default commit message", async () => {
      const layer = TestAIService.default

      const result = await Effect.gen(function* () {
        const ai = yield* AIService
        return yield* ai.generateCommitMessage(DiffContent("diff"), { speed: "medium" })
      }).pipe(Effect.provide(layer), Effect.runPromise)

      expect(String(result)).toBe("feat: add new feature")
    })
  })
})

describe("AIService speed tiers", () => {
  it("accepts fast speed tier", async () => {
    let usedSpeed = ""
    const layer = TestAIService.withCapture((_, options) => {
      usedSpeed = options.speed
      return "ok"
    })

    await Effect.gen(function* () {
      const ai = yield* AIService
      yield* ai.generateCommitMessage(DiffContent("diff"), { speed: "fast" })
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(usedSpeed).toBe("fast")
  })

  it("accepts medium speed tier", async () => {
    let usedSpeed = ""
    const layer = TestAIService.withCapture((_, options) => {
      usedSpeed = options.speed
      return "ok"
    })

    await Effect.gen(function* () {
      const ai = yield* AIService
      yield* ai.generateCommitMessage(DiffContent("diff"), { speed: "medium" })
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(usedSpeed).toBe("medium")
  })

  it("accepts slow speed tier", async () => {
    let usedSpeed = ""
    const layer = TestAIService.withCapture((_, options) => {
      usedSpeed = options.speed
      return "ok"
    })

    await Effect.gen(function* () {
      const ai = yield* AIService
      yield* ai.generateCommitMessage(DiffContent("diff"), { speed: "slow" })
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(usedSpeed).toBe("slow")
  })
})
