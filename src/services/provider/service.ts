import { Context, Effect } from "effect"
import type { LanguageModel } from "ai"
import type { AIError } from "../../types/errors"
import type { ModelRef } from "../config/service"

/**
 * Service interface for AI provider management.
 * Handles SDK initialization and model resolution using AI SDK.
 */
export interface ProviderServiceImpl {
  /**
   * Get a language model instance for the given model reference.
   * Handles SDK initialization and caching.
   */
  readonly getModel: (ref: ModelRef) => Effect.Effect<LanguageModel, AIError>
}

/**
 * Provider service tag for dependency injection.
 */
export class ProviderService extends Context.Tag("ProviderService")<
  ProviderService,
  ProviderServiceImpl
>() {}
