import { Effect, Layer, Schema } from "effect"
import { ConfigError } from "../../types/errors"
import { AuthService, type StoredCredentials } from "./service"

/**
 * Schema for the auth.json file.
 */
const AuthFileSchema = Schema.Struct({
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
 */
const readStoredCredentials = (): Effect.Effect<StoredCredentials | null, ConfigError> =>
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
        return Effect.succeed(null)
      }
      return Schema.decodeUnknown(AuthFileSchema)(content).pipe(
        Effect.map((decoded) => decoded as StoredCredentials),
        Effect.catchAll(() => Effect.succeed(null))
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
const deleteCredentials = (): Effect.Effect<void, ConfigError> =>
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
 * Create the live auth service implementation.
 */
const makeAuthService = (): AuthService["Type"] => ({
  getApiKey: () =>
    Effect.gen(function* () {
      // Check environment variable first (highest priority)
      const envKey = process.env["ANTHROPIC_API_KEY"]
      if (envKey) {
        return envKey
      }

      // Fall back to stored credentials
      const stored = yield* readStoredCredentials()
      return stored?.apiKey ?? null
    }),

  saveApiKey: (apiKey: string) =>
    writeCredentials({
      apiKey,
      createdAt: new Date().toISOString(),
    }),

  removeCredentials: () => deleteCredentials(),

  getCredentialsInfo: () => readStoredCredentials(),

  isAuthenticated: () =>
    Effect.gen(function* () {
      const apiKey = yield* makeAuthService().getApiKey()
      return apiKey !== null && apiKey.length > 0
    }),
})

/**
 * Live implementation of AuthService.
 */
export const AuthServiceLive = Layer.succeed(AuthService, makeAuthService())
