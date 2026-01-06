import { describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import { AIError } from "../../types/errors"
import { ProviderService } from "./service"
import { TestProviderService } from "./test"

describe("ProviderService", () => {
  describe("TestProviderService.default", () => {
    it("returns a mock model", async () => {
      const program = Effect.gen(function* () {
        const provider = yield* ProviderService
        return yield* provider.getModel({ provider: "anthropic", modelId: "test" })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestProviderService.default))
      )

      expect(result).toBeDefined()
      // The mock model has these properties but TS union type is complex
      expect((result as unknown as { provider: string }).provider).toBe("mock")
      expect((result as unknown as { modelId: string }).modelId).toBe("mock-model")
    })
  })

  describe("TestProviderService.withMockModel", () => {
    it("returns the specified mock model", async () => {
      const customModel = {
        specificationVersion: "v1" as const,
        provider: "custom-provider",
        modelId: "custom-model-id",
        defaultObjectGenerationMode: "json" as const,
        doGenerate: async () => ({
          rawCall: { rawPrompt: "", rawSettings: {} },
          finishReason: "stop" as const,
          usage: { promptTokens: 0, completionTokens: 0 },
          text: "custom response",
        }),
        doStream: async () => ({
          rawCall: { rawPrompt: "", rawSettings: {} },
          stream: new ReadableStream(),
        }),
      }

      const program = Effect.gen(function* () {
        const provider = yield* ProviderService
        return yield* provider.getModel({ provider: "openai", modelId: "gpt-4" })
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestProviderService.withMockModel(customModel as unknown as import("ai").LanguageModel)))
      )

      expect((result as unknown as { provider: string }).provider).toBe("custom-provider")
      expect((result as unknown as { modelId: string }).modelId).toBe("custom-model-id")
    })
  })

  describe("TestProviderService.withError", () => {
    it("fails with the specified error", async () => {
      const error = new AIError({
        message: "No API key found",
        retryable: false,
      })

      const program = Effect.gen(function* () {
        const provider = yield* ProviderService
        return yield* provider.getModel({ provider: "anthropic", modelId: "test" })
      })

      const result = await Effect.runPromiseExit(
        program.pipe(Effect.provide(TestProviderService.withError(error)))
      )

      expect(Exit.isFailure(result)).toBe(true)
    })

    it("provides correct error message", async () => {
      const error = new AIError({
        message: "Rate limit exceeded",
        retryable: true,
      })

      const program = Effect.gen(function* () {
        const provider = yield* ProviderService
        return yield* provider.getModel({ provider: "anthropic", modelId: "test" })
      })

      const result = await Effect.runPromiseExit(
        program.pipe(Effect.provide(TestProviderService.withError(error)))
      )

      if (Exit.isFailure(result)) {
        const cause = result.cause
        // The error should contain our message
        expect(String(cause)).toContain("Rate limit exceeded")
      }
    })
  })

  describe("TestProviderService.make", () => {
    it("allows custom implementation", async () => {
      let getModelCalled = false

      const program = Effect.gen(function* () {
        const provider = yield* ProviderService
        return yield* provider.getModel({ provider: "anthropic", modelId: "test" })
      })

      await Effect.runPromise(
        program.pipe(
          Effect.provide(
            TestProviderService.make({
              getModel: () => {
                getModelCalled = true
                return Effect.succeed({
                  specificationVersion: "v1",
                  provider: "tracked",
                  modelId: "tracked-model",
                } as unknown as import("ai").LanguageModel)
              },
            })
          )
        )
      )

      expect(getModelCalled).toBe(true)
    })
  })
})
