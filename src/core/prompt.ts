/**
 * Interactive prompt utilities using readline.
 */
import { Effect } from "effect"
import * as readline from "readline"

/**
 * Prompt the user for a single key response.
 */
export const promptKey = (
  message: string,
  validKeys: readonly string[]
): Effect.Effect<string, never> =>
  Effect.async<string, never>((resume) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    // Enable raw mode for single keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }

    process.stdout.write(message)

    const onKeypress = (key: Buffer) => {
      const char = key.toString().toLowerCase()

      // Handle Ctrl+C
      if (char === "\x03") {
        cleanup()
        process.exit(0)
      }

      // Handle Enter as default (first valid key)
      if (char === "\r" || char === "\n") {
        const defaultKey = validKeys[0] ?? "y"
        cleanup()
        process.stdout.write(defaultKey + "\n")
        resume(Effect.succeed(defaultKey))
        return
      }

      if (validKeys.includes(char)) {
        cleanup()
        process.stdout.write(char + "\n")
        resume(Effect.succeed(char))
      }
    }

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.removeListener("data", onKeypress)
      rl.close()
    }

    process.stdin.on("data", onKeypress)
  })

/**
 * Prompt for yes/no confirmation.
 */
export const confirm = (message: string): Effect.Effect<boolean, never> =>
  promptKey(`${message} [y/n] `, ["y", "n"]).pipe(
    Effect.map((key) => key === "y")
  )

/**
 * Prompt for yes/no/edit.
 */
export const confirmWithEdit = (
  message: string
): Effect.Effect<"yes" | "no" | "edit", never> =>
  promptKey(`${message} [y/n/e] `, ["y", "n", "e"]).pipe(
    Effect.map((key) => {
      if (key === "y") return "yes"
      if (key === "n") return "no"
      return "edit"
    })
  )

/**
 * Prompt for yes/no/feedback.
 */
export const confirmWithFeedback = (
  message: string
): Effect.Effect<"yes" | "no" | "feedback", never> =>
  promptKey(`${message} [y/n/f] `, ["y", "n", "f"]).pipe(
    Effect.map((key) => {
      if (key === "y") return "yes"
      if (key === "n") return "no"
      return "feedback"
    })
  )

/**
 * Prompt for multi-line text input.
 */
export const promptText = (message: string): Effect.Effect<string, never> =>
  Effect.async<string, never>((resume) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(message, (answer) => {
      rl.close()
      resume(Effect.succeed(answer))
    })
  })
