import { Schema } from "effect"

/**
 * Error when git operations fail.
 */
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when there are no staged changes to commit.
 */
export class NoStagedChangesError extends Schema.TaggedError<NoStagedChangesError>()(
  "NoStagedChangesError",
  {
    message: Schema.String,
  }
) {}

/**
 * Error when AI service fails.
 */
export class AIError extends Schema.TaggedError<AIError>()("AIError", {
  message: Schema.String,
  retryable: Schema.Boolean,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when configuration is invalid or missing.
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error when state management operations fail.
 */
export class StateError extends Schema.TaggedError<StateError>()("StateError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error for user-facing messages (already formatted for display).
 */
export class UserError extends Schema.TaggedError<UserError>()("UserError", {
  message: Schema.String,
}) {}
