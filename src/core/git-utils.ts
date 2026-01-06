/**
 * Shared git utilities for CLI commands.
 */
import { Effect } from "effect"
import { GitError } from "../types/errors"
import type { SpeedTier } from "../types/models"

/**
 * Determine speed tier from flags.
 */
export const getSpeedTier = (fast: boolean, slow: boolean): SpeedTier => {
  if (fast) return "fast"
  if (slow) return "slow"
  return "medium"
}

/**
 * Execute git commit with editor for review.
 * Returns true if commit succeeded, false if aborted.
 */
export const commitWithEditor = (message: string): Effect.Effect<boolean, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", "commit", "-e", "-m", message], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      const exitCode = await proc.exited
      // Exit code 0 = success, anything else = aborted or failed
      return exitCode === 0
    },
    catch: (error) =>
      new GitError({
        operation: "commit",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })
