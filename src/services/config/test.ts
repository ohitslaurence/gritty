import { Effect, Layer } from "effect"
import { MODEL_IDS } from "../../types/models"
import { ConfigService, type ConfigServiceImpl, type GrittyConfig } from "./service"

/**
 * Default test configuration.
 */
const DEFAULT_TEST_CONFIG: GrittyConfig = {
  version: 1,
  commit: {
    style: "conventional",
    model: {
      default: "medium",
    },
  },
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
        getModel: impl.getModel ?? ((speed) => Effect.succeed(MODEL_IDS[speed])),
        getDefaultSpeed: impl.getDefaultSpeed ?? (() => Effect.succeed("medium")),
      })
    ),

  /**
   * Create a test layer with a specific config.
   */
  withConfig: (config: GrittyConfig): Layer.Layer<ConfigService> =>
    TestConfigService.make({
      load: () => Effect.succeed(config),
      getModel: (speed) => Effect.succeed(config.commit?.model?.[speed] ?? MODEL_IDS[speed]),
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
      getModel: (speed) => Effect.succeed(models[speed] ?? MODEL_IDS[speed]),
    }),

  /**
   * Default test layer with medium speed.
   */
  default: Layer.succeed(
    ConfigService,
    ConfigService.of({
      load: () => Effect.succeed(DEFAULT_TEST_CONFIG),
      getModel: (speed) => Effect.succeed(MODEL_IDS[speed]),
      getDefaultSpeed: () => Effect.succeed("medium"),
    })
  ),
}
