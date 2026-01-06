import { Effect, Layer, Schema } from "effect"
import { ConfigError } from "../../types/errors"
import { MODEL_IDS, type ModelId, type SpeedTier } from "../../types/models"
import { ConfigService, GrittyConfigSchema, type GrittyConfig } from "./service"

/**
 * Default configuration when no .gritty.json is found.
 */
const DEFAULT_CONFIG: GrittyConfig = {
  version: 1,
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

    getModel: (speed: SpeedTier): ModelId => {
      return MODEL_IDS[speed]
    },

    getDefaultSpeed: () =>
      Effect.gen(function* () {
        const config = yield* load()
        return config.commit?.model?.default ?? "medium"
      }),
  }
}

/**
 * Live implementation of ConfigService.
 */
export const ConfigServiceLive = Layer.succeed(ConfigService, makeConfigService())
