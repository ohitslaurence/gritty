import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { ConfigError } from "../../types/errors"
import { AuthService } from "../../services/auth/service"

/**
 * Mask an API key for display (show first 7 and last 4 chars).
 */
const maskApiKey = (key: string): string => {
  if (key.length <= 15) {
    return "****"
  }
  return `${key.slice(0, 7)}...${key.slice(-4)}`
}

/**
 * Open a URL in the default browser.
 */
const openBrowser = (url: string): Effect.Effect<void, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const platform = process.platform
      const cmd =
        platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open"

      const proc = Bun.spawn([cmd, url], {
        stdout: "ignore",
        stderr: "ignore",
      })
      await proc.exited
    },
    catch: (error) =>
      new ConfigError({
        message: "Failed to open browser",
        cause: error,
      }),
  })

/**
 * Prompt for input from stdin.
 */
const promptInput = (prompt: string): Effect.Effect<string, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      process.stdout.write(prompt)

      // Use readline for cleaner input handling
      const readline = await import("node:readline")
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      return new Promise<string>((resolve) => {
        rl.on("line", (line) => {
          rl.close()
          resolve(line.trim())
        })
      })
    },
    catch: (error) =>
      new ConfigError({
        message: "Failed to read input",
        cause: error,
      }),
  })

/**
 * Validate API key format.
 */
const isValidApiKey = (key: string): boolean => {
  return key.startsWith("sk-ant-") && key.length > 20
}

/**
 * The auth login command.
 */
const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService

    // Check if already authenticated
    const existing = yield* auth.getCredentialsInfo()
    if (existing) {
      yield* Console.log(`Already authenticated (key: ${maskApiKey(existing.apiKey)})`)
      yield* Console.log("Use 'gritty auth logout' to remove credentials first.")
      return
    }

    // Check for env var
    if (process.env["ANTHROPIC_API_KEY"]) {
      yield* Console.log("ANTHROPIC_API_KEY environment variable is set.")
      yield* Console.log("This takes precedence over stored credentials.")
      return
    }

    yield* Console.log("Opening Anthropic Console to create an API key...")
    yield* Console.log("")

    // Try to open browser
    yield* openBrowser("https://console.anthropic.com/settings/keys").pipe(
      Effect.catchAll(() =>
        Console.log("Could not open browser. Please visit:")
      )
    )
    yield* Console.log("https://console.anthropic.com/settings/keys")
    yield* Console.log("")

    // Prompt for API key
    const apiKey = yield* promptInput("Paste your API key: ")

    if (!apiKey) {
      yield* Console.log("\nAborted.")
      return
    }

    if (!isValidApiKey(apiKey)) {
      yield* Console.error("\nInvalid API key format. Expected: sk-ant-...")
      return
    }

    // Save credentials
    yield* auth.saveApiKey(apiKey)
    yield* Console.log(`\n✓ Saved to ~/.config/gritty/auth.json`)
  }).pipe(
    Effect.catchTag("ConfigError", (e) => Console.error(`\n✗ ${e.message}`))
  )
).pipe(Command.withDescription("Store Anthropic API credentials"))

/**
 * Provider info for status display.
 */
const PROVIDERS = [
  { name: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { name: "OpenAI", envVar: "OPENAI_API_KEY" },
] as const

/**
 * The auth status command.
 */
const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService

    yield* Console.log("Provider Status:")
    yield* Console.log("")

    let anyAuthenticated = false

    // Check each provider
    for (const provider of PROVIDERS) {
      const envKey = process.env[provider.envVar]
      if (envKey) {
        yield* Console.log(`  ${provider.name}: ✓ ${provider.envVar} (${maskApiKey(envKey)})`)
        anyAuthenticated = true
      } else {
        yield* Console.log(`  ${provider.name}: ✗ ${provider.envVar} not set`)
      }
    }

    // Check stored Anthropic credentials (legacy)
    const stored = yield* auth.getCredentialsInfo()
    if (stored) {
      const createdDate = new Date(stored.createdAt).toLocaleDateString()
      yield* Console.log("")
      yield* Console.log(`Stored credentials (Anthropic):`)
      yield* Console.log(`  Key: ${maskApiKey(stored.apiKey)}`)
      yield* Console.log(`  Created: ${createdDate}`)
      yield* Console.log(`  Source: ~/.config/gritty/auth.json`)
      anyAuthenticated = true
    }

    if (!anyAuthenticated) {
      yield* Console.log("")
      yield* Console.log("Run 'gritty auth login' to authenticate with Anthropic.")
      yield* Console.log("For OpenAI, set OPENAI_API_KEY environment variable.")
    }
  }).pipe(
    Effect.catchTag("ConfigError", (e) => Console.error(`\n✗ ${e.message}`))
  )
).pipe(Command.withDescription("Show authentication status"))

/**
 * The auth logout command.
 */
const logoutCommand = Command.make("logout", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService

    // Check for env var
    if (process.env["ANTHROPIC_API_KEY"]) {
      yield* Console.log("Note: ANTHROPIC_API_KEY environment variable is still set.")
    }

    // Check if we have stored credentials
    const stored = yield* auth.getCredentialsInfo()
    if (!stored) {
      yield* Console.log("No stored credentials found.")
      return
    }

    // Remove credentials
    yield* auth.removeCredentials()
    yield* Console.log("✓ Removed credentials from ~/.config/gritty/auth.json")
  }).pipe(
    Effect.catchTag("ConfigError", (e) => Console.error(`\n✗ ${e.message}`))
  )
).pipe(Command.withDescription("Remove stored credentials"))

/**
 * The main auth command with subcommands.
 */
export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage AI provider authentication"),
  Command.withSubcommands([loginCommand, statusCommand, logoutCommand])
)
