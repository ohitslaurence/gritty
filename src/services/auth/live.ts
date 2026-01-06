import { Effect, Layer, Schema } from "effect"
import { ConfigError } from "../../types/errors"
import type { ProviderName } from "../config/service"
import { AuthService, type StoredCredentials } from "./service"

/**
 * Schema for provider credentials.
 */
const ProviderCredentialsSchema = Schema.Struct({
  apiKey: Schema.String,
  createdAt: Schema.String,
})

/**
 * Schema for the auth.json file (multi-provider).
 */
const AuthFileSchema = Schema.Struct({
  anthropic: Schema.optional(ProviderCredentialsSchema),
  openai: Schema.optional(ProviderCredentialsSchema),
})

/**
 * Legacy schema for backward compatibility (single Anthropic key).
 */
const LegacyAuthFileSchema = Schema.Struct({
  apiKey: Schema.String,
  createdAt: Schema.String,
})

/**
 * Get the auth file path.
 */
const getAuthFilePath = (): string => {
  const homeDir = process.env["HOME"] ?? ""
  return `${homeDir}/.config/gritty/auth.json`
}

/**
 * Ensure the config directory exists.
 */
const ensureConfigDir = (): Effect.Effect<void, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const homeDir = process.env["HOME"] ?? ""
      const configDir = `${homeDir}/.config/gritty`
      const { mkdir } = await import("node:fs/promises")
      await mkdir(configDir, { recursive: true, mode: 0o700 })
    },
    catch: (error) =>
      new ConfigError({
        message: "Failed to create config directory",
        cause: error,
      }),
  })

/**
 * Read stored credentials from file.
 * Handles both new multi-provider format and legacy single-key format.
 */
const readStoredCredentials = (): Effect.Effect<StoredCredentials, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const file = Bun.file(getAuthFilePath())
      if (!(await file.exists())) {
        return null
      }
      const content = await file.json()
      return content as unknown
    },
    catch: (error) =>
      new ConfigError({
        message: "Failed to read auth file",
        cause: error,
      }),
  }).pipe(
    Effect.flatMap((content) => {
      if (content === null) {
        return Effect.succeed({})
      }

      // Try legacy format first (has apiKey at root level)
      return Schema.decodeUnknown(LegacyAuthFileSchema)(content).pipe(
        Effect.map((legacy) => ({
          anthropic: {
            apiKey: legacy.apiKey,
            createdAt: legacy.createdAt,
          },
        })),
        Effect.catchAll(() =>
          // Fall back to new multi-provider format
          Schema.decodeUnknown(AuthFileSchema)(content).pipe(
            Effect.map((decoded) => decoded as StoredCredentials),
            Effect.catchAll(() => Effect.succeed({}))
          )
        )
      )
    })
  )

/**
 * Write credentials to file with restricted permissions.
 */
const writeCredentials = (credentials: StoredCredentials): Effect.Effect<void, ConfigError> =>
  Effect.gen(function* () {
    yield* ensureConfigDir()
    yield* Effect.tryPromise({
      try: async () => {
        const { writeFile, chmod } = await import("node:fs/promises")
        const path = getAuthFilePath()
        await writeFile(path, JSON.stringify(credentials, null, 2))
        await chmod(path, 0o600) // Owner read/write only
      },
      catch: (error) =>
        new ConfigError({
          message: "Failed to write auth file",
          cause: error,
        }),
    })
  })

/**
 * Delete the auth file.
 */
const deleteAuthFile = (): Effect.Effect<void, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const { unlink } = await import("node:fs/promises")
      const path = getAuthFilePath()
      const file = Bun.file(path)
      if (await file.exists()) {
        await unlink(path)
      }
    },
    catch: (error) =>
      new ConfigError({
        message: "Failed to delete auth file",
        cause: error,
      }),
  })

/**
 * Get the environment variable name for a provider.
 */
const getEnvVarName = (provider: ProviderName): string => {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY"
    case "openai":
      return "OPENAI_API_KEY"
  }
}

/**
 * Create the live auth service implementation.
 */
const makeAuthService = (): AuthService["Type"] => ({
  getApiKey: (provider: ProviderName = "anthropic") =>
    Effect.gen(function* () {
      // Check environment variable first (highest priority)
      const envKey = process.env[getEnvVarName(provider)]
      if (envKey) {
        return envKey
      }

      // Fall back to stored credentials
      const stored = yield* readStoredCredentials()
      return stored[provider]?.apiKey ?? null
    }),

  saveApiKey: (provider: ProviderName, apiKey: string) =>
    Effect.gen(function* () {
      const existing = yield* readStoredCredentials()
      const updated: StoredCredentials = {
        ...existing,
        [provider]: {
          apiKey,
          createdAt: new Date().toISOString(),
        },
      }
      yield* writeCredentials(updated)
    }),

  removeCredentials: (provider?: ProviderName) =>
    Effect.gen(function* () {
      if (!provider) {
        // Remove all credentials
        yield* deleteAuthFile()
        return
      }

      // Remove specific provider
      const existing = yield* readStoredCredentials()
      const updated = { ...existing }
      delete updated[provider]

      // If no credentials left, delete the file
      if (!updated.anthropic && !updated.openai) {
        yield* deleteAuthFile()
      } else {
        yield* writeCredentials(updated)
      }
    }),

  getCredentialsInfo: (provider: ProviderName = "anthropic") =>
    Effect.gen(function* () {
      const stored = yield* readStoredCredentials()
      return stored[provider] ?? null
    }),

  getAllCredentials: () => readStoredCredentials(),

  isAuthenticated: (provider: ProviderName = "anthropic") =>
    Effect.gen(function* () {
      const apiKey = yield* makeAuthService().getApiKey(provider)
      return apiKey !== null && apiKey.length > 0
    }),
})

/**
 * Live implementation of AuthService.
 */
export const AuthServiceLive = Layer.succeed(AuthService, makeAuthService())
