import Anthropic from "@anthropic-ai/sdk"
import { Effect, Layer } from "effect"
import { CommitMessage, type DiffContent } from "../../types/branded"
import { AIError } from "../../types/errors"
import type { GenerateOptions } from "../../types/models"
import { AuthService } from "../auth/service"
import { ConfigService } from "../config/service"
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
  return `You are an expert developer organizing code changes into logical commits.

<task>
Analyze the provided diffs and determine the optimal commit structure.
A single commit is often the right answer - only split when genuinely beneficial.
Your job is purely to analyze the code and suggest groupings - nothing will be executed.
</task>

<when_to_use_single_commit>
- All changes are part of the same feature or fix
- Changes are small and cohesive (even across multiple files)
- Files are tightly coupled (e.g., implementation + tests + types)
- Splitting would create commits that don't make sense alone
</when_to_use_single_commit>

<when_to_split>
- Changes address genuinely different concerns (unrelated bug fix + feature)
- Changes could realistically be reviewed or reverted independently
- Changes touch completely unrelated parts of the codebase
- There's a clear logical separation (e.g., refactor then feature)
</when_to_split>

<rules>
- Each commit should be logically atomic (don't split tightly coupled changes)
- Always keep implementations with their tests in the same commit
- Commit titles: imperative mood, max 72 chars, no trailing period
- Order commits logically: dependencies/setup before features
- Bias toward fewer, cohesive commits over many small ones
</rules>

<output_format>
Return ONLY valid JSON, no markdown or explanation:
{
  "commits": [
    {
      "title": "Add user authentication",
      "files": ["src/auth.ts", "src/auth.test.ts"],
      "reason": "Auth implementation with its tests"
    }
  ]
}
</output_format>`
}

/**
 * Max characters per file diff to include in the prompt.
 */
const MAX_DIFF_PER_FILE = 4000

/**
 * Build the user prompt for commit composition.
 */
const buildComposeUserPrompt = (
  files: readonly { path: string; diff: string }[],
  feedback?: string
): string => {
  const filesSummary = files
    .map((f) => {
      const truncated = f.diff.length > MAX_DIFF_PER_FILE
      const diff = truncated ? f.diff.slice(0, MAX_DIFF_PER_FILE) + "\n[...truncated]" : f.diff
      return `<file path="${f.path}">\n${diff}\n</file>`
    })
    .join("\n\n")

  let prompt = `<changed_files count="${files.length}">\n${filesSummary}\n</changed_files>`

  if (feedback) {
    prompt += `\n\n<user_feedback>\n${feedback}\n</user_feedback>\n\nPlease adjust the groupings based on the feedback above.`
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
 * Gets model configuration from ConfigService.
 */
export const AIServiceLive = Layer.effect(
  AIService,
  Effect.gen(function* () {
    const auth = yield* AuthService
    const config = yield* ConfigService

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

          // Get model from config (with fallback to defaults)
          const model = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Create client with the API key
          const client = new Anthropic({ apiKey })

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await client.messages.create({
                model,
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

          // Get model from config (with fallback to defaults)
          const model = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Create client with the API key
          const client = new Anthropic({ apiKey })

          return yield* Effect.tryPromise({
            try: async () => {
              const response = await client.messages.create({
                model,
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
