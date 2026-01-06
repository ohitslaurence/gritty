import { Context, Effect } from "effect"
import type { ConfigError } from "../../types/errors"

/**
 * Stored credentials shape.
 */
export interface StoredCredentials {
  readonly apiKey: string
  readonly createdAt: string
}

/**
 * Service interface for authentication management.
 */
export interface AuthServiceImpl {
  /**
   * Get the API key - checks env var first, then stored credentials.
   */
  readonly getApiKey: () => Effect.Effect<string | null, ConfigError>

  /**
   * Store API key credentials.
   */
  readonly saveApiKey: (apiKey: string) => Effect.Effect<void, ConfigError>

  /**
   * Remove stored credentials.
   */
  readonly removeCredentials: () => Effect.Effect<void, ConfigError>

  /**
   * Get stored credentials info (for status display).
   */
  readonly getCredentialsInfo: () => Effect.Effect<StoredCredentials | null, ConfigError>

  /**
   * Check if authenticated (has valid API key from any source).
   */
  readonly isAuthenticated: () => Effect.Effect<boolean, ConfigError>
}

/**
 * Auth service tag for dependency injection.
 */
export class AuthService extends Context.Tag("AuthService")<AuthService, AuthServiceImpl>() {}
