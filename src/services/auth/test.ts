import { Effect, Layer } from "effect"
import type { ConfigError } from "../../types/errors"
import type { ProviderName } from "../config/service"
import {
  AuthService,
  type AuthServiceImpl,
  type StoredCredentials,
} from "./service"

/**
 * Default credentials for tests.
 */
const DEFAULT_CREDENTIALS: StoredCredentials = {}

/**
 * Create a test AuthService with configurable behavior.
 */
export const TestAuthService = {
  /**
   * Create a test layer with stored credentials.
   */
  withCredentials: (credentials: StoredCredentials): Layer.Layer<AuthService> =>
    Layer.succeed(
      AuthService,
      AuthService.of({
        getApiKey: (provider: ProviderName = "anthropic") =>
          Effect.succeed(credentials[provider]?.apiKey ?? null),
        saveApiKey: () => Effect.succeed(undefined),
        removeCredentials: () => Effect.succeed(undefined),
        getCredentialsInfo: (provider: ProviderName = "anthropic") =>
          Effect.succeed(credentials[provider] ?? null),
        getAllCredentials: () => Effect.succeed(credentials),
        isAuthenticated: (provider: ProviderName = "anthropic") =>
          Effect.succeed(!!credentials[provider]?.apiKey),
      })
    ),

  /**
   * Create a test layer with a specific API key.
   */
  withApiKey: (provider: ProviderName, apiKey: string): Layer.Layer<AuthService> =>
    TestAuthService.withCredentials({
      [provider]: {
        apiKey,
        createdAt: new Date().toISOString(),
      },
    }),

  /**
   * Create a test layer with a custom implementation.
   */
  make: (impl: Partial<AuthServiceImpl>): Layer.Layer<AuthService> =>
    Layer.succeed(
      AuthService,
      AuthService.of({
        getApiKey:
          impl.getApiKey ?? (() => Effect.succeed(null)),
        saveApiKey:
          impl.saveApiKey ?? (() => Effect.succeed(undefined)),
        removeCredentials:
          impl.removeCredentials ?? (() => Effect.succeed(undefined)),
        getCredentialsInfo:
          impl.getCredentialsInfo ?? (() => Effect.succeed(null)),
        getAllCredentials:
          impl.getAllCredentials ?? (() => Effect.succeed(DEFAULT_CREDENTIALS)),
        isAuthenticated:
          impl.isAuthenticated ?? (() => Effect.succeed(false)),
      })
    ),

  /**
   * Create a test layer that tracks save operations.
   */
  withSaveCapture: (
    callback: (provider: ProviderName, apiKey: string) => void
  ): Layer.Layer<AuthService> =>
    Layer.succeed(
      AuthService,
      AuthService.of({
        getApiKey: () => Effect.succeed(null),
        saveApiKey: (provider, apiKey) => {
          callback(provider, apiKey)
          return Effect.succeed(undefined)
        },
        removeCredentials: () => Effect.succeed(undefined),
        getCredentialsInfo: () => Effect.succeed(null),
        getAllCredentials: () => Effect.succeed(DEFAULT_CREDENTIALS),
        isAuthenticated: () => Effect.succeed(false),
      })
    ),

  /**
   * Create a test layer that fails with an error.
   */
  withError: (error: ConfigError): Layer.Layer<AuthService> =>
    Layer.succeed(
      AuthService,
      AuthService.of({
        getApiKey: () => Effect.fail(error),
        saveApiKey: () => Effect.fail(error),
        removeCredentials: () => Effect.fail(error),
        getCredentialsInfo: () => Effect.fail(error),
        getAllCredentials: () => Effect.fail(error),
        isAuthenticated: () => Effect.fail(error),
      })
    ),

  /**
   * Default test layer with no credentials.
   */
  default: Layer.succeed(
    AuthService,
    AuthService.of({
      getApiKey: () => Effect.succeed(null),
      saveApiKey: () => Effect.succeed(undefined),
      removeCredentials: () => Effect.succeed(undefined),
      getCredentialsInfo: () => Effect.succeed(null),
      getAllCredentials: () => Effect.succeed(DEFAULT_CREDENTIALS),
      isAuthenticated: () => Effect.succeed(false),
    })
  ),
}
