import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { Effect, Layer } from "effect"
import type { LanguageModel } from "ai"
import { AIError } from "../../types/errors"
import { AuthService } from "../auth/service"
import { ConfigService, type ModelRef, type ProviderName } from "../config/service"
import { ProviderService } from "./service"

/**
 * SDK cache key type.
 */
type SDKCacheKey = `${ProviderName}:${string}`

/**
 * SDK instance types.
 */
type AnthropicSDK = ReturnType<typeof createAnthropic>
type OpenAISDK = ReturnType<typeof createOpenAI>
type SDK = AnthropicSDK | OpenAISDK

/**
 * Live implementation of ProviderService.
 * Uses AI SDK providers for Anthropic and OpenAI.
 */
export const ProviderServiceLive = Layer.effect(
  ProviderService,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const auth = yield* AuthService

    // Cache for SDK instances (keyed by provider + config hash)
    const sdkCache = new Map<SDKCacheKey, SDK>()

    /**
     * Get or create an SDK instance for the given provider.
     */
    const getSDK = (provider: ProviderName): Effect.Effect<SDK, AIError> =>
      Effect.gen(function* () {
        const providerConfig = yield* config.getProviderConfig(provider).pipe(
          Effect.mapError(
            (e) =>
              new AIError({
                message: `Config error: ${e.message}`,
                retryable: false,
                cause: e,
              })
          )
        )

        // Check stored credentials as fallback for the provider
        let apiKey = providerConfig.apiKey
        if (!apiKey) {
          const storedKey = yield* auth.getApiKey(provider).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Auth error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )
          apiKey = storedKey ?? undefined
        }

        // Create cache key based on provider and config
        const cacheKey: SDKCacheKey = `${provider}:${providerConfig.baseURL ?? "default"}`

        // Check cache first
        const cached = sdkCache.get(cacheKey)
        if (cached) {
          return cached
        }

        // Validate API key
        if (!apiKey) {
          return yield* Effect.fail(
            new AIError({
              message: `No API key found for ${provider}. Set ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} or configure in .gritty.json`,
              retryable: false,
              cause: undefined,
            })
          )
        }

        // Create SDK based on provider
        let sdk: SDK
        switch (provider) {
          case "anthropic":
            sdk = createAnthropic({
              apiKey,
              ...(providerConfig.baseURL && { baseURL: providerConfig.baseURL }),
            })
            break
          case "openai":
            sdk = createOpenAI({
              apiKey,
              ...(providerConfig.baseURL && { baseURL: providerConfig.baseURL }),
            })
            break
        }

        // Cache and return
        sdkCache.set(cacheKey, sdk)
        return sdk
      })

    return ProviderService.of({
      getModel: (ref: ModelRef): Effect.Effect<LanguageModel, AIError> =>
        Effect.gen(function* () {
          const sdk = yield* getSDK(ref.provider)

          // Get the language model from the SDK
          // AI SDK providers use function call syntax: sdk("model-id")
          try {
            const model = sdk(ref.modelId) as LanguageModel
            return model
          } catch (error) {
            return yield* Effect.fail(
              new AIError({
                message: `Failed to get model ${ref.provider}/${ref.modelId}: ${error instanceof Error ? error.message : String(error)}`,
                retryable: false,
                cause: error,
              })
            )
          }
        }),
    })
  })
)
