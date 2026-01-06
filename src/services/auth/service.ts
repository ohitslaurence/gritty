import { Context, Effect } from "effect"
import type { ConfigError } from "../../types/errors"
import type { ProviderName } from "../config/service"

/**
 * Stored credentials for a single provider.
 */
export interface ProviderCredentials {
  readonly apiKey: string
  readonly createdAt: string
}

/**
 * All stored credentials (keyed by provider).
 */
export interface StoredCredentials {
  readonly anthropic?: ProviderCredentials | undefined
  readonly openai?: ProviderCredentials | undefined
}

/**
 * Service interface for authentication management.
 */
export interface AuthServiceImpl {
  /**
   * Get the API key for a provider - checks env var first, then stored credentials.
   */
  readonly getApiKey: (provider?: ProviderName) => Effect.Effect<string | null, ConfigError>

  /**
   * Store API key credentials for a provider.
   */
  readonly saveApiKey: (provider: ProviderName, apiKey: string) => Effect.Effect<void, ConfigError>

  /**
   * Remove stored credentials for a provider (or all if not specified).
   */
  readonly removeCredentials: (provider?: ProviderName) => Effect.Effect<void, ConfigError>

  /**
   * Get stored credentials info for a provider (for status display).
   */
  readonly getCredentialsInfo: (provider?: ProviderName) => Effect.Effect<ProviderCredentials | null, ConfigError>

  /**
   * Get all stored credentials.
   */
  readonly getAllCredentials: () => Effect.Effect<StoredCredentials, ConfigError>

  /**
   * Check if authenticated for a provider (has valid API key from any source).
   */
  readonly isAuthenticated: (provider?: ProviderName) => Effect.Effect<boolean, ConfigError>
}

/**
 * Auth service tag for dependency injection.
 */
export class AuthService extends Context.Tag("AuthService")<AuthService, AuthServiceImpl>() {}
