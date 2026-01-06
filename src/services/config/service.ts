import { Context, Effect, Schema } from "effect"
import type { ConfigError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"

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
          // Custom model IDs for each speed tier
          fast: Schema.optional(Schema.String),
          medium: Schema.optional(Schema.String),
          slow: Schema.optional(Schema.String),
        })
      ),
    })
  ),
  review: Schema.optional(
    Schema.Struct({
      // Glob patterns to exclude from review (e.g., ["**/generated/**", "**/*.gen.ts"])
      exclude: Schema.optional(Schema.Array(Schema.String)),
    })
  ),
})

export type GrittyConfig = typeof GrittyConfigSchema.Type

/**
 * Default exclusion patterns for review.
 * Excludes common generated file patterns.
 */
export const DEFAULT_REVIEW_EXCLUSIONS = [
  "**/generated/**",
  "**/*.generated.*",
  "**/*.gen.*",
  "**/codegen/**",
  "**/__generated__/**",
]

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
   * Returns configured model or falls back to defaults.
   */
  readonly getModel: (speed: SpeedTier) => Effect.Effect<string, ConfigError>

  /**
   * Get the default speed tier from config.
   */
  readonly getDefaultSpeed: () => Effect.Effect<SpeedTier, ConfigError>

  /**
   * Get review exclusion patterns.
   * Returns configured patterns merged with defaults.
   */
  readonly getReviewExclusions: () => Effect.Effect<readonly string[], ConfigError>
}

/**
 * Config service tag for dependency injection.
 */
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceImpl
>() {}
