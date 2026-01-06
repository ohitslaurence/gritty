import { Context, Effect, Schema } from "effect"
import type { ConfigError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"

/**
 * Supported AI providers.
 */
export type ProviderName = "anthropic" | "openai"

/**
 * Provider-specific configuration schema.
 */
const ProviderConfigSchema = Schema.Struct({
  // API key - can use {env:VAR_NAME} syntax for env substitution
  apiKey: Schema.optional(Schema.String),
  // Custom base URL for API (e.g., for proxies)
  baseURL: Schema.optional(Schema.String),
})

/**
 * Configuration schema for .gritty.json files.
 */
export const GrittyConfigSchema = Schema.Struct({
  version: Schema.optional(Schema.Number),
  // Model configuration using provider/model format (e.g., "anthropic/claude-sonnet-4-5")
  model: Schema.optional(Schema.String),
  fastModel: Schema.optional(Schema.String),
  slowModel: Schema.optional(Schema.String),
  // Provider-specific configuration
  provider: Schema.optional(
    Schema.Struct({
      anthropic: Schema.optional(ProviderConfigSchema),
      openai: Schema.optional(ProviderConfigSchema),
    })
  ),
  commit: Schema.optional(
    Schema.Struct({
      style: Schema.optional(Schema.Literal("conventional", "gitmoji", "freeform")),
      scopes: Schema.optional(Schema.Array(Schema.String)),
      maxSubjectLength: Schema.optional(Schema.Number),
      includeBody: Schema.optional(Schema.Literal("auto", "always", "never")),
      // Legacy model config - still supported for backward compatibility
      model: Schema.optional(
        Schema.Struct({
          default: Schema.optional(Schema.Literal("fast", "medium", "slow")),
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
 * Parsed model reference with provider and model ID.
 */
export interface ModelRef {
  readonly provider: ProviderName
  readonly modelId: string
}

/**
 * Provider configuration for SDK initialization.
 */
export interface ProviderConfig {
  readonly apiKey?: string | undefined
  readonly baseURL?: string | undefined
}

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
 * Default model IDs using provider/model format.
 */
export const DEFAULT_MODELS = {
  fast: "anthropic/claude-3-5-haiku-latest",
  medium: "anthropic/claude-sonnet-4-20250514",
  slow: "anthropic/claude-opus-4-20250514",
} as const

/**
 * Service interface for configuration management.
 */
export interface ConfigServiceImpl {
  /**
   * Load configuration from the current directory or defaults.
   */
  readonly load: () => Effect.Effect<GrittyConfig, ConfigError>

  /**
   * Get the model reference for a given speed tier.
   * Returns parsed provider/model reference.
   */
  readonly getModel: (speed: SpeedTier) => Effect.Effect<ModelRef, ConfigError>

  /**
   * Get the default speed tier from config.
   */
  readonly getDefaultSpeed: () => Effect.Effect<SpeedTier, ConfigError>

  /**
   * Get review exclusion patterns.
   * Returns configured patterns merged with defaults.
   */
  readonly getReviewExclusions: () => Effect.Effect<readonly string[], ConfigError>

  /**
   * Get provider configuration (API key, base URL, etc.).
   */
  readonly getProviderConfig: (provider: ProviderName) => Effect.Effect<ProviderConfig, ConfigError>
}

/**
 * Config service tag for dependency injection.
 */
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  ConfigServiceImpl
>() {}
