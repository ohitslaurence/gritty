import { Effect, Layer, Schema } from "effect"
import { ConfigError } from "../../types/errors"
import type { SpeedTier } from "../../types/models"
import {
  ConfigService,
  DEFAULT_MODELS,
  DEFAULT_REVIEW_EXCLUSIONS,
  GrittyConfigSchema,
  type GrittyConfig,
  type ModelRef,
  type ProviderConfig,
  type ProviderName,
} from "./service"

/**
 * Default configuration when no .gritty.json is found.
 */
const DEFAULT_CONFIG: GrittyConfig = {
  version: 1,
  model: DEFAULT_MODELS.medium,
  fastModel: DEFAULT_MODELS.fast,
  slowModel: DEFAULT_MODELS.slow,
  commit: {
    style: "conventional",
    maxSubjectLength: 72,
    includeBody: "auto",
    model: {
      default: "medium",
    },
  },
}

/**
 * Parse a model string in provider/model format.
 * @example parseModelString("anthropic/claude-sonnet-4-5") => { provider: "anthropic", modelId: "claude-sonnet-4-5" }
 */
const parseModelString = (model: string): ModelRef | null => {
  const parts = model.split("/")
  if (parts.length !== 2) {
    return null
  }
  const [provider, modelId] = parts
  if (!provider || !modelId) {
    return null
  }
  // Validate provider is one we support
  if (provider !== "anthropic" && provider !== "openai") {
    return null
  }
  return { provider, modelId }
}

/**
 * Resolve environment variable substitution in config values.
 * Supports {env:VAR_NAME} syntax.
 * @example resolveEnvValue("{env:ANTHROPIC_API_KEY}") => "sk-ant-..."
 */
const resolveEnvValue = (value: string | undefined): string | undefined => {
  if (!value) return value
  const match = value.match(/^\{env:([^}]+)\}$/)
  if (match) {
    return process.env[match[1]] ?? undefined
  }
  return value
}

/**
 * Get environment variable name for a provider's API key.
 */
const getEnvKeyForProvider = (provider: ProviderName): string => {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY"
    case "openai":
      return "OPENAI_API_KEY"
  }
}

/**
 * Try to load and parse a config file.
 */
const loadConfigFile = (path: string): Effect.Effect<GrittyConfig | null, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const file = Bun.file(path)
      if (!(await file.exists())) {
        return null
      }
      const content = await file.json()
      return content as unknown
    },
    catch: (error) =>
      new ConfigError({
        message: `Failed to read config file: ${path}`,
        cause: error,
      }),
  }).pipe(
    Effect.flatMap((content) => {
      if (content === null) {
        return Effect.succeed(null)
      }
      return Schema.decodeUnknown(GrittyConfigSchema)(content).pipe(
        Effect.mapError(
          (error) =>
            new ConfigError({
              message: `Invalid config file: ${error.message}`,
              cause: error,
            })
        )
      )
    })
  )

/**
 * Create the live config service implementation.
 */
const makeConfigService = (): ConfigService["Type"] => {
  let cachedConfig: GrittyConfig | null = null

  const load = (): Effect.Effect<GrittyConfig, ConfigError> =>
    Effect.gen(function* () {
      if (cachedConfig) {
        return cachedConfig
      }

      // Try local .grittyrc first (like .prettierrc)
      const rcConfig = yield* loadConfigFile(".grittyrc")
      if (rcConfig) {
        cachedConfig = rcConfig
        return rcConfig
      }

      // Try local .gritty.json
      const localConfig = yield* loadConfigFile(".gritty.json")
      if (localConfig) {
        cachedConfig = localConfig
        return localConfig
      }

      // Try home directory config
      const homeDir = process.env["HOME"] ?? ""
      const homeConfig = yield* loadConfigFile(`${homeDir}/.gritty/config.json`)
      if (homeConfig) {
        cachedConfig = homeConfig
        return homeConfig
      }

      // Return defaults
      cachedConfig = DEFAULT_CONFIG
      return DEFAULT_CONFIG
    })

  return {
    load,

    getModel: (speed: SpeedTier) =>
      Effect.gen(function* () {
        const config = yield* load()

        // Get the model string based on speed tier
        let modelString: string | undefined

        // Check new top-level config first
        switch (speed) {
          case "fast":
            modelString = config.fastModel
            break
          case "medium":
            modelString = config.model
            break
          case "slow":
            modelString = config.slowModel
            break
        }

        // Fall back to legacy config if present
        if (!modelString) {
          const legacyModel = config.commit?.model?.[speed]
          if (legacyModel) {
            // Legacy format might be bare model ID (assume anthropic)
            modelString = legacyModel.includes("/") ? legacyModel : `anthropic/${legacyModel}`
          }
        }

        // Fall back to defaults
        if (!modelString) {
          modelString = DEFAULT_MODELS[speed]
        }

        // Parse the model string
        const parsed = parseModelString(modelString)
        if (!parsed) {
          return yield* Effect.fail(
            new ConfigError({
              message: `Invalid model format: ${modelString}. Expected provider/model (e.g., anthropic/claude-sonnet-4-5)`,
            })
          )
        }

        return parsed
      }),

    getDefaultSpeed: () =>
      Effect.gen(function* () {
        const config = yield* load()
        return config.commit?.model?.default ?? "medium"
      }),

    getReviewExclusions: () =>
      Effect.gen(function* () {
        const config = yield* load()
        const customExclusions = config.review?.exclude ?? []
        // Merge custom exclusions with defaults, removing duplicates
        return [...new Set([...DEFAULT_REVIEW_EXCLUSIONS, ...customExclusions])]
      }),

    getProviderConfig: (provider: ProviderName) =>
      Effect.gen(function* () {
        const config = yield* load()

        // Get provider-specific config
        const providerCfg = config.provider?.[provider]

        // Resolve API key: config (with env substitution) -> env var -> undefined
        const configApiKey = resolveEnvValue(providerCfg?.apiKey)
        const envApiKey = process.env[getEnvKeyForProvider(provider)]
        const apiKey = configApiKey ?? envApiKey

        return {
          apiKey,
          baseURL: providerCfg?.baseURL,
        }
      }),
  }
}

/**
 * Live implementation of ConfigService.
 */
export const ConfigServiceLive = Layer.succeed(ConfigService, makeConfigService())
