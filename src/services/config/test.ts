import { Effect, Layer } from "effect"
import {
  ConfigService,
  DEFAULT_MODELS,
  DEFAULT_REVIEW_EXCLUSIONS,
  type ConfigServiceImpl,
  type GrittyConfig,
  type ModelRef,
  type ProviderConfig,
  type ProviderName,
} from "./service"

/**
 * Parse a model string into a ModelRef.
 */
const parseModelString = (model: string): ModelRef => {
  const [provider, modelId] = model.split("/")
  return {
    provider: (provider as ProviderName) ?? "anthropic",
    modelId: modelId ?? model,
  }
}

/**
 * Default model refs for each speed tier.
 */
const DEFAULT_MODEL_REFS: Record<"fast" | "medium" | "slow", ModelRef> = {
  fast: parseModelString(DEFAULT_MODELS.fast),
  medium: parseModelString(DEFAULT_MODELS.medium),
  slow: parseModelString(DEFAULT_MODELS.slow),
}

/**
 * Default test configuration.
 */
const DEFAULT_TEST_CONFIG: GrittyConfig = {
  version: 1,
  model: DEFAULT_MODELS.medium,
  fastModel: DEFAULT_MODELS.fast,
  slowModel: DEFAULT_MODELS.slow,
  commit: {
    style: "conventional",
    model: {
      default: "medium",
    },
  },
}

/**
 * Default provider config for tests.
 */
const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  apiKey: "test-api-key",
}

/**
 * Create a test ConfigService with configurable behavior.
 */
export const TestConfigService = {
  /**
   * Create a test layer with custom implementation.
   */
  make: (impl: Partial<ConfigServiceImpl>): Layer.Layer<ConfigService> =>
    Layer.succeed(
      ConfigService,
      ConfigService.of({
        load: impl.load ?? (() => Effect.succeed(DEFAULT_TEST_CONFIG)),
        getModel: impl.getModel ?? ((speed) => Effect.succeed(DEFAULT_MODEL_REFS[speed])),
        getDefaultSpeed: impl.getDefaultSpeed ?? (() => Effect.succeed("medium")),
        getReviewExclusions: impl.getReviewExclusions ?? (() => Effect.succeed(DEFAULT_REVIEW_EXCLUSIONS)),
        getProviderConfig: impl.getProviderConfig ?? (() => Effect.succeed(DEFAULT_PROVIDER_CONFIG)),
      })
    ),

  /**
   * Create a test layer with a specific config.
   */
  withConfig: (config: GrittyConfig): Layer.Layer<ConfigService> =>
    TestConfigService.make({
      load: () => Effect.succeed(config),
      getModel: (speed) => {
        const modelString =
          speed === "fast"
            ? config.fastModel
            : speed === "slow"
              ? config.slowModel
              : config.model
        return Effect.succeed(
          modelString ? parseModelString(modelString) : DEFAULT_MODEL_REFS[speed]
        )
      },
      getDefaultSpeed: () => Effect.succeed(config.commit?.model?.default ?? "medium"),
    }),

  /**
   * Create a test layer with a specific default speed.
   */
  withDefaultSpeed: (speed: "fast" | "medium" | "slow"): Layer.Layer<ConfigService> =>
    TestConfigService.make({
      getDefaultSpeed: () => Effect.succeed(speed),
    }),

  /**
   * Create a test layer with custom models.
   */
  withModels: (models: Partial<Record<"fast" | "medium" | "slow", string>>): Layer.Layer<ConfigService> =>
    TestConfigService.make({
      getModel: (speed) =>
        Effect.succeed(
          models[speed] ? parseModelString(models[speed]) : DEFAULT_MODEL_REFS[speed]
        ),
    }),

  /**
   * Default test layer with medium speed.
   */
  default: Layer.succeed(
    ConfigService,
    ConfigService.of({
      load: () => Effect.succeed(DEFAULT_TEST_CONFIG),
      getModel: (speed) => Effect.succeed(DEFAULT_MODEL_REFS[speed]),
      getDefaultSpeed: () => Effect.succeed("medium"),
      getReviewExclusions: () => Effect.succeed(DEFAULT_REVIEW_EXCLUSIONS),
      getProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
    })
  ),
}
