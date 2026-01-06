import { Effect, Layer } from "effect"
import { CommitMessage, type DiffContent } from "../../types/branded"
import type { AIError } from "../../types/errors"
import type { GenerateOptions } from "../../types/models"
import { AIService, type AIServiceImpl } from "./service"

/**
 * Default PR description for tests.
 */
const DEFAULT_PR_DESCRIPTION = {
  title: "feat: add new feature",
  body: "## Summary\n- Add new feature\n\n## Test plan\n- [ ] Test it",
}

/**
 * Default PR review for tests.
 */
const DEFAULT_PR_REVIEW = {
  summary: "Code looks good overall.",
  verdict: "approve" as const,
  comments: [],
}

/**
 * Create a test AIService with configurable behavior.
 */
export const TestAIService = {
  /**
   * Create a test layer with a fixed response.
   */
  withResponse: (response: string): Layer.Layer<AIService> =>
    Layer.succeed(
      AIService,
      AIService.of({
        generateCommitMessage: () => Effect.succeed(CommitMessage(response)),
        composeCommits: () =>
          Effect.succeed([
            { title: "test: default commit", files: [], reason: "test" },
          ]),
        generatePRDescription: () => Effect.succeed(DEFAULT_PR_DESCRIPTION),
        reviewPR: () => Effect.succeed(DEFAULT_PR_REVIEW),
      })
    ),

  /**
   * Create a test layer with a custom implementation.
   */
  make: (impl: Partial<AIServiceImpl>): Layer.Layer<AIService> =>
    Layer.succeed(
      AIService,
      AIService.of({
        generateCommitMessage:
          impl.generateCommitMessage ??
          (() => Effect.succeed(CommitMessage("test: default commit message"))),
        composeCommits:
          impl.composeCommits ??
          (() =>
            Effect.succeed([
              { title: "test: default commit", files: [], reason: "test" },
            ])),
        generatePRDescription:
          impl.generatePRDescription ??
          (() => Effect.succeed(DEFAULT_PR_DESCRIPTION)),
        reviewPR:
          impl.reviewPR ??
          (() => Effect.succeed(DEFAULT_PR_REVIEW)),
      })
    ),

  /**
   * Create a test layer that captures the prompt for inspection.
   */
  withCapture: (
    callback: (diff: DiffContent, options: GenerateOptions) => string
  ): Layer.Layer<AIService> =>
    Layer.succeed(
      AIService,
      AIService.of({
        generateCommitMessage: (diff, options) =>
          Effect.succeed(CommitMessage(callback(diff, options))),
        composeCommits: () =>
          Effect.succeed([
            { title: "test: captured commit", files: [], reason: "test" },
          ]),
        generatePRDescription: () => Effect.succeed(DEFAULT_PR_DESCRIPTION),
        reviewPR: () => Effect.succeed(DEFAULT_PR_REVIEW),
      })
    ),

  /**
   * Create a test layer that fails with an error.
   */
  withError: (error: AIError): Layer.Layer<AIService> =>
    Layer.succeed(
      AIService,
      AIService.of({
        generateCommitMessage: () => Effect.fail(error),
        composeCommits: () => Effect.fail(error),
        generatePRDescription: () => Effect.fail(error),
        reviewPR: () => Effect.fail(error),
      })
    ),

  /**
   * Default test layer with a generic commit message.
   */
  default: Layer.succeed(
    AIService,
    AIService.of({
      generateCommitMessage: () => Effect.succeed(CommitMessage("feat: add new feature")),
      composeCommits: () =>
        Effect.succeed([
          { title: "feat: add new feature", files: [], reason: "default test" },
        ]),
      generatePRDescription: () => Effect.succeed(DEFAULT_PR_DESCRIPTION),
      reviewPR: () => Effect.succeed(DEFAULT_PR_REVIEW),
    })
  ),
}
