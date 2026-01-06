import { Effect } from "effect"
import { UserError } from "../types/errors"

/**
 * Check if gh CLI is installed.
 */
export const checkGhInstalled = (): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "--version"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

/**
 * Check if gh CLI is authenticated.
 */
export const checkGhAuth = (): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

/**
 * Ensure gh CLI is installed and authenticated.
 * Returns Effect.void on success, fails with UserError otherwise.
 */
export const requireGhCli = (): Effect.Effect<void, UserError> =>
  Effect.gen(function* () {
    const installed = yield* checkGhInstalled()
    if (!installed) {
      return yield* Effect.fail(
        new UserError({
          message: "GitHub CLI (gh) not found.\n  Install: https://cli.github.com/",
        })
      )
    }

    const authed = yield* checkGhAuth()
    if (!authed) {
      return yield* Effect.fail(
        new UserError({
          message: "GitHub CLI not authenticated.\n  Run: gh auth login",
        })
      )
    }
  })
