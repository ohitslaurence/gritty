import { Schema } from "effect"

/**
 * Speed tier for model selection.
 * - fast: Haiku - quick responses, good for simple changes
 * - medium: Sonnet - balanced speed and quality (default)
 * - slow: Opus - highest quality, for complex changes
 */
export const SpeedTier = Schema.Literal("fast", "medium", "slow")
export type SpeedTier = typeof SpeedTier.Type

/**
 * Commit style detection result.
 */
export const CommitStyle = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Conventional"),
    scopes: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Gitmoji"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Freeform"),
  })
)
export type CommitStyle = typeof CommitStyle.Type

/**
 * Options for generating a commit message.
 */
export interface GenerateOptions {
  readonly speed: SpeedTier
  readonly context?: string
  readonly style?: CommitStyle
  readonly recentCommits?: readonly Commit[]
}

/**
 * Options for the commit command.
 */
export interface CommitOptions {
  readonly speed: SpeedTier
  readonly dryRun: boolean
  readonly yes: boolean
  readonly stagedOnly: boolean
  readonly context?: string
  readonly conventional: boolean
}

/**
 * Git status information.
 */
export interface GitStatus {
  readonly staged: readonly string[]
  readonly unstaged: readonly string[]
  readonly untracked: readonly string[]
}

/**
 * A parsed commit from git log.
 */
export interface Commit {
  readonly hash: string
  readonly message: string
  readonly author: string
  readonly date: Date
}

/**
 * Prompt names for the state service.
 */
export const PromptName = Schema.Literal("commit", "review", "pr")
export type PromptName = typeof PromptName.Type
