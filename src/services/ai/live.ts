import { generateText } from "ai"
import { Effect, Layer } from "effect"
import { CommitMessage, type DiffContent } from "../../types/branded"
import { AIError } from "../../types/errors"
import type { GenerateOptions } from "../../types/models"
import type { FilePreview, FileGroup, ChunkReviewResult } from "../../types/review-state"
import { ConfigService } from "../config/service"
import { ProviderService } from "../provider/service"
import { AIService, type ProposedCommit, type PRDescription, type PRReview } from "./service"

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
 * Build the system prompt for PR description generation.
 */
const buildPRSystemPrompt = (): string => {
  return `You are an expert developer writing a pull request description.

<task>
Generate a clear, professional PR title and description from the commits and diff.
</task>

<guidelines>
- Title: Clear summary of what this PR does, max 72 chars
- Body: Concise bullet points describing what changed and why
- No test plans, no checklists - just describe the changes
</guidelines>

<output_format>
Return ONLY valid JSON, no markdown or explanation:
{
  "title": "Add user authentication with JWT",
  "body": "- Implement JWT token validation\\n- Add refresh token rotation\\n- Handle token expiry with automatic refresh"
}
</output_format>`
}

/**
 * Build the user prompt for PR description generation.
 */
const buildPRUserPrompt = (
  commits: readonly { message: string }[],
  diff: string,
  options: { context?: string; baseBranch: string; branchName: string }
): string => {
  const commitMessages = commits.map((c) => `- ${c.message}`).join("\n")
  const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + "\n[...truncated]" : diff

  let prompt = `<branch>
From: ${options.branchName}
To: ${options.baseBranch}
</branch>

<commits>
${commitMessages}
</commits>

<diff>
${truncatedDiff}
</diff>`

  if (options.context) {
    prompt += `\n\n<context>${options.context}</context>`
  }

  return prompt
}

/**
 * Parse the PR description response from AI.
 */
const parsePRResponse = (response: string): PRDescription => {
  try {
    const parsed = JSON.parse(response) as PRDescription
    return parsed
  } catch {
    // Try to extract JSON from the response if it's wrapped in markdown
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as PRDescription
      return parsed
    }
    throw new Error("Failed to parse AI response as JSON")
  }
}

/**
 * Build the system prompt for PR review.
 */
const buildReviewSystemPrompt = (options: { guidelines?: string; readme?: string }): string => {
  const guidelinesSection = options.guidelines
    ? `
<repo_guidelines>
The following are the repository's own guidelines. Enforce these as the source of truth for style, conventions, and patterns. Your opinions should come from here, not from general preferences.

${options.guidelines}
</repo_guidelines>
`
    : ""

  const readmeSection = options.readme
    ? `
<repo_readme>
Project context from README:

${options.readme}
</repo_readme>
`
    : ""

  return `You are a code reviewer analyzing a pull request.

<philosophy>
Be FACTUAL, not OPINIONATED. Your job is to identify:
- Objective issues: bugs, logic errors, security vulnerabilities, performance problems, race conditions
- Convention violations: ONLY if the repo has documented conventions (see repo_guidelines below)
- Improvements: concrete, measurable benefits (faster, safer, more maintainable) - not subjective preferences

Do NOT impose your own style preferences. If the repo has no documented convention for something, don't comment on it as a style issue.
</philosophy>
${guidelinesSection}${readmeSection}
<what_to_comment_on>
CRITICAL (objective issues that must be fixed):
- Bugs, logic errors, null pointer risks
- Security vulnerabilities
- Data loss or corruption risks
- Race conditions, deadlocks

SUGGESTION (concrete improvements with clear benefit):
- Performance improvements (with explanation of why)
- Missing error handling that could cause crashes
- Edge cases that would cause incorrect behavior

NITPICK (only if repo guidelines exist for this):
- Convention violations documented in repo_guidelines
- Inconsistencies with patterns established in repo_guidelines

PRAISE (acknowledge good work):
- Clever solutions to tricky problems
- Good test coverage
- Clean handling of edge cases
</what_to_comment_on>

<what_NOT_to_comment_on>
- Style preferences not in repo guidelines (naming, formatting, etc.)
- "I would have done it differently" suggestions
- Theoretical improvements with no concrete benefit
- Things already handled by linters/formatters
</what_NOT_to_comment_on>

<line_number_constraint>
CRITICAL: You can ONLY comment on lines visible in the diff.

The diff shows hunks like:
@@ -10,5 +10,8 @@
 unchanged line (context)
+added line        <- you CAN comment (line 11)
+another added     <- you CAN comment (line 12)
 more context      <- you CAN comment (visible)

Use NEW file line numbers (right side). NEVER use line numbers for code not in the diff.
</line_number_constraint>

<output_format>
Return ONLY valid JSON:
{
  "summary": "Brief factual assessment (1-2 sentences) - ALWAYS provide this",
  "verdict": "approve" | "request_changes" | "comment",
  "comments": []  // Can be empty if no specific issues - that's fine!
}

The summary is REQUIRED - it confirms the review was done and gives an overall assessment.
An empty comments array is perfectly acceptable for clean code with no issues.
</output_format>

<verdict_guidelines>
- approve: No objective issues, code works correctly
- request_changes: Has bugs, security issues, or breaks documented conventions
- comment: Suggestions exist but nothing objectively wrong
</verdict_guidelines>`
}

/**
 * Build the user prompt for PR review.
 */
const buildReviewUserPrompt = (
  diff: string,
  options: { title: string; description: string }
): string => {
  const truncatedDiff = diff.length > 12000 ? diff.slice(0, 12000) + "\n[...truncated]" : diff

  return `<pr>
<title>${options.title}</title>
<description>
${options.description}
</description>
</pr>

<diff>
${truncatedDiff}
</diff>`
}

/**
 * Parse the PR review response from AI.
 */
const parseReviewResponse = (response: string): PRReview => {
  try {
    const parsed = JSON.parse(response) as PRReview
    return parsed
  } catch {
    // Try to extract JSON from the response if it's wrapped in markdown
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as PRReview
      return parsed
    }
    throw new Error("Failed to parse AI response as JSON")
  }
}

/**
 * Build the system prompt for file grouping.
 */
const buildGroupingSystemPrompt = (): string => {
  return `You are an expert code reviewer organizing files for a parallel review process.

<task>
Analyze the PR files and group them into logical chunks that can be reviewed independently.
Each chunk should contain files that are related and should be reviewed together.
</task>

<grouping_principles>
1. Group files by logical concern (e.g., all auth-related files together)
2. Keep tests with their implementation files
3. Keep type definitions with files that use them
4. Configuration files can be their own group or with related code
5. Aim for 2-5 files per group (adjust based on complexity)
6. A single large/complex file can be its own group
7. Prefer fewer groups over many tiny groups
</grouping_principles>

<output_format>
Return ONLY valid JSON, no markdown or explanation:
{
  "groups": [
    {
      "name": "Authentication middleware",
      "reasoning": "Auth implementation with tests and types",
      "files": ["src/auth/middleware.ts", "src/auth/middleware.test.ts", "src/types/auth.ts"]
    }
  ]
}
</output_format>`
}

/**
 * Build the user prompt for file grouping.
 */
const buildGroupingUserPrompt = (
  files: readonly FilePreview[],
  pr: { title: string; description: string }
): string => {
  const fileList = files
    .map((f) => {
      const contentSection = f.contentPreview
        ? `<content_preview>\n${f.contentPreview}\n</content_preview>`
        : "<content_preview>(file deleted or empty)</content_preview>"
      const diffSection = f.diffPreview
        ? `<diff_preview>\n${f.diffPreview}\n</diff_preview>`
        : "<diff_preview>(no changes)</diff_preview>"
      return `<file path="${f.path}">\n${contentSection}\n${diffSection}\n</file>`
    })
    .join("\n\n")

  return `<pr>
<title>${pr.title}</title>
<description>${pr.description}</description>
</pr>

<files count="${files.length}">
${fileList}
</files>

Group these files for parallel review.`
}

/**
 * Parse the grouping response from AI.
 */
const parseGroupingResponse = (response: string): FileGroup[] => {
  try {
    const parsed = JSON.parse(response) as { groups: Array<{ name: string; reasoning: string; files: string[] }> }
    // Add unique IDs to each group
    return parsed.groups.map((g, i) => ({
      id: `group-${i}-${Date.now()}`,
      name: g.name,
      reasoning: g.reasoning,
      files: g.files,
    }))
  } catch {
    // Try to extract JSON from the response if it's wrapped in markdown
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { groups: Array<{ name: string; reasoning: string; files: string[] }> }
      return parsed.groups.map((g, i) => ({
        id: `group-${i}-${Date.now()}`,
        name: g.name,
        reasoning: g.reasoning,
        files: g.files,
      }))
    }
    throw new Error("Failed to parse grouping response as JSON")
  }
}

/**
 * Build the system prompt for chunk review.
 * Similar to full review but with chunk context.
 */
const buildChunkReviewSystemPrompt = (options: { guidelines?: string; readme?: string }): string => {
  const guidelinesSection = options.guidelines
    ? `
<repo_guidelines>
The following are the repository's own guidelines. Enforce these as the source of truth for style, conventions, and patterns.

${options.guidelines}
</repo_guidelines>
`
    : ""

  const readmeSection = options.readme
    ? `
<repo_readme>
Project context from README:

${options.readme}
</repo_readme>
`
    : ""

  return `You are a code reviewer analyzing a subset of files from a pull request.

<context>
You are reviewing ONE CHUNK of a larger PR. Other chunks are being reviewed in parallel.
Focus only on the files in this chunk - don't worry about files not shown.
</context>

<philosophy>
Be FACTUAL, not OPINIONATED. Your job is to identify:
- Objective issues: bugs, logic errors, security vulnerabilities, performance problems
- Convention violations: ONLY if the repo has documented conventions
- Improvements: concrete, measurable benefits - not subjective preferences

Do NOT impose your own style preferences.
</philosophy>
${guidelinesSection}${readmeSection}
<what_to_comment_on>
CRITICAL: bugs, security issues, data loss risks, race conditions
SUGGESTION: performance improvements, missing error handling, edge cases
NITPICK: convention violations (only if documented in repo_guidelines)
PRAISE: clever solutions, good test coverage, clean edge case handling
</what_to_comment_on>

<line_number_constraint>
CRITICAL: You can ONLY comment on lines visible in the diff.
Use NEW file line numbers (right side). NEVER use line numbers for code not in the diff.
</line_number_constraint>

<output_format>
Return ONLY valid JSON:
{
  "summary": "Brief factual assessment of this chunk (1-2 sentences)",
  "verdict": "approve" | "request_changes" | "comment",
  "comments": []  // Can be empty if no issues
}

Each comment should have: file, line (optional), severity, comment
</output_format>`
}

/**
 * Build the user prompt for chunk review.
 */
const buildChunkReviewUserPrompt = (
  chunk: {
    groupName: string
    groupReasoning: string
    files: readonly { path: string; diff: string }[]
  },
  pr: { title: string; description: string }
): string => {
  const filesContent = chunk.files
    .map((f) => `<file path="${f.path}">\n${f.diff}\n</file>`)
    .join("\n\n")

  return `<pr>
<title>${pr.title}</title>
<description>${pr.description}</description>
</pr>

<chunk>
<name>${chunk.groupName}</name>
<reasoning>${chunk.groupReasoning}</reasoning>
</chunk>

<files count="${chunk.files.length}">
${filesContent}
</files>

Review this chunk of the PR.`
}

/**
 * Parse the chunk review response from AI.
 */
const parseChunkReviewResponse = (response: string, groupId: string): ChunkReviewResult => {
  try {
    const parsed = JSON.parse(response) as Omit<ChunkReviewResult, "groupId">
    return { groupId, ...parsed }
  } catch {
    // Try to extract JSON from the response if it's wrapped in markdown
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Omit<ChunkReviewResult, "groupId">
      return { groupId, ...parsed }
    }
    throw new Error("Failed to parse chunk review response as JSON")
  }
}

/**
 * Build the system prompt for changelog generation.
 */
const buildChangelogSystemPrompt = (): string => `You are an expert at writing clear, concise changelogs.

<task>
Generate a changelog from git commit messages. Group related changes and produce clean markdown.
</task>

<rules>
1. Group commits by type: Features, Fixes, Improvements, Documentation, Other
2. Combine related commits into single entries (e.g., "Add X" and "Fix X typo" become one entry)
3. Rewrite commit messages to be user-friendly and consistent
4. Use past tense ("Added" not "Add")
5. Remove commit hashes, PR numbers, and technical details
6. Skip merge commits, version bumps, and trivial changes
7. If a section would be empty, omit it entirely
</rules>

<format>
## Features
- Added new feature description

## Fixes
- Fixed bug description

## Improvements
- Improved something description
</format>

Output ONLY the markdown changelog, no preamble or explanation.`

/**
 * Build the user prompt for changelog generation.
 */
const buildChangelogUserPrompt = (
  commits: readonly { hash: string; message: string; author: string; date: string }[]
): string => {
  const commitList = commits
    .map((c) => `- ${c.hash.slice(0, 7)} | ${c.date} | ${c.author} | ${c.message}`)
    .join("\n")

  return `Generate a changelog from these ${commits.length} commits:

${commitList}`
}

/**
 * Check if an error is a rate limit error.
 */
const isRateLimitError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("rate limit") ||
      message.includes("rate_limit") ||
      message.includes("429") ||
      message.includes("too many requests")
    )
  }
  return false
}

/**
 * Live implementation of AIService using AI SDK.
 * Uses ProviderService for multi-provider support.
 * Gets model configuration from ConfigService.
 */
export const AIServiceLive = Layer.effect(
  AIService,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const provider = yield* ProviderService

    return AIService.of({
      generateCommitMessage: (diff, options) =>
        Effect.gen(function* () {
          // Get model reference from config
          const modelRef = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 1024,
                system: buildSystemPrompt(options),
                prompt: buildUserPrompt(diff, options.context),
              })

              return CommitMessage(text.trim())
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),

      composeCommits: (files, options) =>
        Effect.gen(function* () {
          // Get model reference from config
          const modelRef = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 4096,
                system: buildComposeSystemPrompt(),
                prompt: buildComposeUserPrompt(files, options.feedback),
              })

              return parseComposeResponse(text.trim())
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),

      generatePRDescription: (commits, diff, options) =>
        Effect.gen(function* () {
          // Get model reference from config
          const modelRef = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 2048,
                system: buildPRSystemPrompt(),
                prompt: buildPRUserPrompt(commits, diff, options),
              })

              return parsePRResponse(text.trim())
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),

      reviewPR: (diff, options) =>
        Effect.gen(function* () {
          // Get model reference from config
          const modelRef = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 4096,
                system: buildReviewSystemPrompt(options),
                prompt: buildReviewUserPrompt(diff, options),
              })

              return parseReviewResponse(text.trim())
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),

      groupFilesForReview: (files, options) =>
        Effect.gen(function* () {
          // Use fast model for grouping
          const modelRef = yield* config.getModel("fast").pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 2048,
                system: buildGroupingSystemPrompt(),
                prompt: buildGroupingUserPrompt(files, options),
              })

              return parseGroupingResponse(text.trim())
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),

      reviewChunk: (chunk, options) =>
        Effect.gen(function* () {
          // Use slow model for quality review
          const modelRef = yield* config.getModel("slow").pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 4096,
                system: buildChunkReviewSystemPrompt(options),
                prompt: buildChunkReviewUserPrompt(chunk, options),
              })

              return parseChunkReviewResponse(text.trim(), chunk.groupId)
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),

      generateChangelog: (commits, options) =>
        Effect.gen(function* () {
          // Get model reference from config
          const modelRef = yield* config.getModel(options.speed).pipe(
            Effect.mapError(
              (e) =>
                new AIError({
                  message: `Config error: ${e.message}`,
                  retryable: false,
                  cause: e,
                })
            )
          )

          // Get the language model from provider service
          const model = yield* provider.getModel(modelRef)

          return yield* Effect.tryPromise({
            try: async () => {
              const { text } = await generateText({
                model,
                maxTokens: 4096,
                system: buildChangelogSystemPrompt(),
                prompt: buildChangelogUserPrompt(commits),
              })

              return text.trim()
            },
            catch: (error) =>
              new AIError({
                message: error instanceof Error ? error.message : String(error),
                retryable: isRateLimitError(error),
                cause: error,
              }),
          })
        }),
    })
  })
)
