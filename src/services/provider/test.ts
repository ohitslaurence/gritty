import { Effect, Layer } from "effect"
import type { LanguageModelV1 } from "ai"
import type { AIError } from "../../types/errors"
import type { ModelRef } from "../config/service"
import { ProviderService, type ProviderServiceImpl } from "./service"

/**
 * Mock language model for testing.
 * Returns a minimal mock that satisfies the LanguageModelV1 interface.
 */
const createMockModel = (): LanguageModelV1 =>
  ({
    specificationVersion: "v1",
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json",
    doGenerate: async () => ({
      rawCall: { rawPrompt: "", rawSettings: {} },
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
      text: "mock response",
    }),
    doStream: async () => ({
      rawCall: { rawPrompt: "", rawSettings: {} },
      stream: new ReadableStream(),
    }),
  }) as unknown as LanguageModelV1

/**
 * Create a test ProviderService with configurable behavior.
 */
export const TestProviderService = {
  /**
   * Create a test layer with custom implementation.
   */
  make: (impl: Partial<ProviderServiceImpl>): Layer.Layer<ProviderService> =>
    Layer.succeed(
      ProviderService,
      ProviderService.of({
        getModel: impl.getModel ?? (() => Effect.succeed(createMockModel())),
      })
    ),

  /**
   * Create a test layer that returns a specific mock model.
   */
  withMockModel: (model: LanguageModelV1): Layer.Layer<ProviderService> =>
    Layer.succeed(
      ProviderService,
      ProviderService.of({
        getModel: () => Effect.succeed(model),
      })
    ),

  /**
   * Create a test layer that fails with an error.
   */
  withError: (error: AIError): Layer.Layer<ProviderService> =>
    Layer.succeed(
      ProviderService,
      ProviderService.of({
        getModel: () => Effect.fail(error),
      })
    ),

  /**
   * Default test layer with a mock model.
   */
  default: Layer.succeed(
    ProviderService,
    ProviderService.of({
      getModel: () => Effect.succeed(createMockModel()),
    })
  ),
}
