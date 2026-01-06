import { Context, Effect } from "effect"
import type { CommitMessage, DiffContent } from "../../types/branded"
import type { AIError } from "../../types/errors"
import type { GenerateOptions } from "../../types/models"

/**
 * Service interface for AI operations.
 */
export interface AIServiceImpl {
  /**
   * Generate a commit message from a diff.
   * @param diff The staged diff content
   * @param options Generation options including speed tier and context
   */
  readonly generateCommitMessage: (
    diff: DiffContent,
    options: GenerateOptions
  ) => Effect.Effect<CommitMessage, AIError>
}

/**
 * AI service tag for dependency injection.
 */
export class AIService extends Context.Tag("AIService")<AIService, AIServiceImpl>() {}
