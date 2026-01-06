import Anthropic from "@anthropic-ai/sdk"
import { Effect, Layer } from "effect"
import { CommitMessage, type DiffContent } from "../../types/branded"
import { AIError } from "../../types/errors"
import { MODEL_IDS, type GenerateOptions } from "../../types/models"
import { AuthService } from "../auth/service"
import { AIService } from "./service"

/**
 * Build the system prompt for commit message generation.
 */
const buildSystemPrompt = (options: GenerateOptions): string => {
  const styleGuidance =
    options.style?._tag === "Conventional"
      ? `Follow the Conventional Commits format: type(scope): description
Available scopes from repo history: ${options.style.scopes.join(", ")}`
      : options.style?._tag === "Gitmoji"
        ? "Use gitmoji format with an appropriate emoji at the start."
        : "Use a clear, professional commit message format."

  return `You are an expert developer writing a git commit message. Analyze the diff and generate a clear, concise commit message.

${styleGuidance}

Guidelines:
1. Subject line: imperative mood, max 72 chars, no trailing period
2. Include body if change is complex (blank line after subject, wrapped at 72 chars)
3. Note any breaking changes with "BREAKING CHANGE:" prefix
4. Focus on WHY, not just WHAT changed

Output ONLY the commit message, no explanation or markdown.`
}

/**
 * Build the user prompt with the diff and optional context.
 */
const buildUserPrompt = (diff: DiffContent, context?: string): string => {
  let prompt = `Generate a commit message for this diff:\n\n${diff}`

  if (context) {
    prompt += `\n\nAdditional context: ${context}`
  }

  return prompt
}

/**
 * Live implementation of AIService using Anthropic SDK.
 * Gets API key from AuthService (env var or stored credentials).
 */
export const AIServiceLive = Layer.effect(
  AIService,
  Effect.gen(function* () {
    const auth = yield* AuthService

    return AIService.of({
      generateCommitMessage: (diff, options) =>
        Effect.gen(function* () {
          // Get API key from auth service
          const apiKey = yield* auth.getApiKey().pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Auth error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          if (!apiKey) {
            return yield* Effect.fail(
              new AIError({
                message:
                  "Not authenticated. Run 'gritty auth login' or set ANTHROPIC_API_KEY.",
                retryable: false,
                cause: undefined,
              })
            )
          }

          // Create client with the API key
          const client = new Anthropic({ apiKey })

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await client.messages.create({
                model: MODEL_IDS[options.speed],
                max_tokens: 1024,
                system: buildSystemPrompt(options),
                messages: [
                  {
                    role: "user",
                    content: buildUserPrompt(diff, options.context),
                  },
                ],
              })

              // Extract text from response
              const textBlock = response.content.find((block) => block.type === "text")
              if (!textBlock || textBlock.type !== "text") {
                throw new Error("No text content in response")
              }

              return CommitMessage(textBlock.text.trim())
            },
            catch: (error) => {
              const isRateLimit =
                error instanceof Anthropic.RateLimitError ||
                (error instanceof Error && error.message.includes("rate limit"))

              return new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimit,
                cause: error,
              })
            },
          })
        }),
    })
  })
)
