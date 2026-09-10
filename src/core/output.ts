/**
 * Output routing for commands that support --json.
 *
 * In JSON mode, human-readable progress goes to stderr and a single JSON
 * result object goes to stdout, so agents can parse stdout reliably.
 */
import { Console, Effect } from "effect"

export interface Output {
  readonly json: boolean
  /** Human-readable progress. stdout normally, stderr in JSON mode. */
  readonly log: (message: string) => Effect.Effect<void>
  /** Final machine-readable result. Only prints in JSON mode. */
  readonly emit: (result: Record<string, unknown>) => Effect.Effect<void>
}

export const makeOutput = (json: boolean): Output => ({
  json,
  log: (message) => (json ? Console.error(message) : Console.log(message)),
  emit: (result) => (json ? Console.log(JSON.stringify({ ok: true, ...result })) : Effect.void),
})

/**
 * Errors every command can surface.
 */
interface CommandError {
  readonly _tag: string
  readonly message: string
}

/**
 * Human-readable hint per error tag.
 */
const hintFor = (error: CommandError): string => {
  switch (error._tag) {
    case "GitError":
      return "\n  Try: git status"
    case "AIError":
      return "retryable" in error && error.retryable
        ? "\n  This may be a rate limit - try again in a moment"
        : "\n  Check your API key with: gritty auth status"
    case "ConfigError":
      return "\n  Check your .grittyrc file for syntax errors"
    default:
      return ""
  }
}

const prefixFor = (error: CommandError): string => {
  switch (error._tag) {
    case "GitError":
      return "Git error: "
    case "AIError":
      return "AI error: "
    case "ConfigError":
      return "Config error: "
    default:
      return ""
  }
}

/**
 * Report a command failure and mark the process as failed.
 * Always sets exit code 1 so callers (agents, scripts) can detect failure.
 */
export const reportError = (output: Output, error: CommandError): Effect.Effect<void> =>
  Effect.gen(function* () {
    process.exitCode = 1
    if (output.json) {
      yield* Console.log(
        JSON.stringify({ ok: false, error: { _tag: error._tag, message: error.message } })
      )
      return
    }
    yield* Console.error(`\n✗ ${prefixFor(error)}${error.message}${hintFor(error)}`)
  })
