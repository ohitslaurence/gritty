import { Context, Effect, Schema } from "effect"
import type { ConfigError } from "../../types/errors"
import type { ModelId, SpeedTier } from "../../types/models"

/**
 * Configuration schema for .gritty.json files.
 */
export const GrittyConfigSchema = Schema.Struct({
  version: Schema.optional(Schema.Number),
  commit: Schema.optional(
    Schema.Struct({
      style: Schema.optional(Schema.Literal("conventional", "gitmoji", "freeform")),
      scopes: Schema.optional(Schema.Array(Schema.String)),
      maxSubjectLength: Schema.optional(Schema.Number),
      includeBody: Schema.optional(Schema.Literal("auto", "always", "never")),
      model: Schema.optional(
        Schema.Struct({
          default: Schema.optional(Schema.Literal("fast", "medium", "slow")),
          override: Schema.optional(Schema.String),
        })
      ),
    })
  ),
})

export type GrittyConfig = typeof GrittyConfigSchema.Type

/**
 * Service interface for configuration management.
 */
export interface ConfigServiceImpl {
  /**
   * Load configuration from the current directory or defaults.
   */
  readonly load: () => Effect.Effect<GrittyConfig, ConfigError>

  /**
   * Get the model ID for a given speed tier.
   */
  readonly getModel: (speed: SpeedTier) => ModelId

  /**
   * Get the default speed tier from config.
   */
  readonly getDefaultSpeed: () => Effect.Effect<SpeedTier, ConfigError>
}

/**
 * Config service tag for dependency injection.
 */
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceImpl
>() {}
