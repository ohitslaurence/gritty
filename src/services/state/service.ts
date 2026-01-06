import { Context, Effect } from "effect"
import type { StateError } from "../../types/errors"
import type { PromptName } from "../../types/models"

/**
 * Service interface for local state management.
 * Manages ~/.gritty/ directory contents.
 */
export interface StateServiceImpl {
  /**
   * Get a prompt by name (returns override if exists, else default).
   */
  readonly getPrompt: (name: PromptName) => Effect.Effect<string, StateError>

  /**
   * Get the default prompt (ignores any override).
   */
  readonly getDefaultPrompt: (name: PromptName) => Effect.Effect<string, StateError>

  /**
   * Save a custom prompt override.
   */
  readonly savePrompt: (name: PromptName, content: string) => Effect.Effect<void, StateError>

  /**
   * Reset a prompt to default (removes override).
   */
  readonly resetPrompt: (name: PromptName) => Effect.Effect<void, StateError>

  /**
   * Check if a prompt has a local override.
   */
  readonly hasOverride: (name: PromptName) => Effect.Effect<boolean, StateError>

  /**
   * Ensure the state directory exists.
   */
  readonly ensureStateDir: () => Effect.Effect<void, StateError>

  /**
   * Get the state directory path.
   */
  readonly getStateDir: () => string
}

/**
 * State service tag for dependency injection.
 */
export class StateService extends Context.Tag("StateService")<StateService, StateServiceImpl>() {}
