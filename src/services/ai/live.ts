import Anthropic from "@anthropic-ai/sdk"
import { Effect, Layer } from "effect"
import { CommitMessage, type DiffContent } from "../../types/branded"
import { AIError } from "../../types/errors"
import { MODEL_IDS, type GenerateOptions } from "../../types/models"
import { AuthService } from "../auth/service"
import { AIService, type ProposedCommit } from "./service"

/**
 * Format recent commits as examples for the prompt.
 */
const formatRecentCommits = (commits: GenerateOptions["recentCommits"]): string => {
  if (!commits || commits.length === 0) {
    return ""
  }

  const examples = commits
    .slice(0, 10) // Max 10 examples
    .map((c) => c.message)
    .join("\n")

  return `
Here are recent commits from this repository - match their style and tone:
<recent_commits>
${examples}
</recent_commits>
`
}

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

  const recentCommitsSection = formatRecentCommits(options.recentCommits)

  return `You are an expert developer writing a git commit message. Analyze the diff and generate a clear, concise commit message.
${recentCommitsSection}
${styleGuidance}

Guidelines:
1. Subject line: imperative mood, max 72 chars, no trailing period
2. Include body if change is complex (blank line after subject, wrapped at 72 chars)
3. Note any breaking changes with "BREAKING CHANGE:" prefix
4. Focus on WHY, not just WHAT changed
5. Match the style and format of the recent commits shown above

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
 * Build the system prompt for commit composition.
 */
const buildComposeSystemPrompt = (): string => {
  return `You are an expert developer helping to organize code changes into logical commits.

Analyze the provided file changes and group them into logical commits that:
1. Keep related changes together (e.g., a feature and its tests)
2. Separate unrelated changes (e.g., bug fixes vs new features vs refactoring)
3. Maintain atomic commits (each commit should be self-contained and buildable)
4. Follow the single responsibility principle for commits

For each proposed commit, provide:
- A concise title (imperative mood, max 72 chars)
- The files that belong in this commit
- A brief reason explaining why these files are grouped together

Output your response as valid JSON in this exact format:
{
  "commits": [
    {
      "title": "Add user authentication middleware",
      "files": ["src/middleware/auth.ts", "src/middleware/auth.test.ts"],
      "reason": "Auth middleware and its tests are logically coupled"
    }
  ]
}

Output ONLY the JSON, no explanation or markdown.`
}

/**
 * Build the user prompt for commit composition.
 */
const buildComposeUserPrompt = (
  files: readonly { path: string; diff: string }[],
  feedback?: string
): string => {
  const filesSummary = files
    .map((f) => `=== ${f.path} ===\n${f.diff.slice(0, 2000)}${f.diff.length > 2000 ? "\n[...truncated]" : ""}`)
    .join("\n\n")

  let prompt = `Analyze these ${files.length} changed files and group them into logical commits:\n\n${filesSummary}`

  if (feedback) {
    prompt += `\n\nUser feedback on previous grouping: ${feedback}\nPlease adjust the groupings based on this feedback.`
  }

  return prompt
}

/**
 * Parse the compose response from AI.
 */
const parseComposeResponse = (response: string): readonly ProposedCommit[] => {
  try {
    const parsed = JSON.parse(response) as { commits: ProposedCommit[] }
    return parsed.commits
  } catch {
    // Try to extract JSON from the response if it's wrapped in markdown
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { commits: ProposedCommit[] }
      return parsed.commits
    }
    throw new Error("Failed to parse AI response as JSON")
  }
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

      composeCommits: (files, options) =>
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
                max_tokens: 4096,
                system: buildComposeSystemPrompt(),
                messages: [
                  {
                    role: "user",
                    content: buildComposeUserPrompt(files, options.feedback),
                  },
                ],
              })

              // Extract text from response
              const textBlock = response.content.find((block) => block.type === "text")
              if (!textBlock || textBlock.type !== "text") {
                throw new Error("No text content in response")
              }

              return parseComposeResponse(textBlock.text.trim())
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
