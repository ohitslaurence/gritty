import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { ConfigError } from "../../types/errors"
import type { ProviderName } from "../../services/config/service"
import { AuthService } from "../../services/auth/service"

/**
 * Provider configuration for auth flows.
 */
const PROVIDERS: Record<
  ProviderName,
  {
    name: string
    envVar: string
    keyPrefix: string
    consoleUrl: string
  }
> = {
  anthropic: {
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefix: "sk-ant-",
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    keyPrefix: "sk-",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
}

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
 * Validate API key format for a provider.
 */
const isValidApiKey = (provider: ProviderName, key: string): boolean => {
  const config = PROVIDERS[provider]
  return key.startsWith(config.keyPrefix) && key.length > 20
}

/**
 * Get provider status info.
 */
interface ProviderStatus {
  provider: ProviderName
  name: string
  connected: boolean
  source: "env" | "stored" | null
  maskedKey: string | null
  storedAt: string | null
}

const getProviderStatus = (
  provider: ProviderName,
  envKey: string | undefined,
  storedKey: { apiKey: string; createdAt: string } | undefined
): ProviderStatus => {
  const config = PROVIDERS[provider]

  if (envKey) {
    return {
      provider,
      name: config.name,
      connected: true,
      source: "env",
      maskedKey: maskApiKey(envKey),
      storedAt: null,
    }
  }

  if (storedKey) {
    return {
      provider,
      name: config.name,
      connected: true,
      source: "stored",
      maskedKey: maskApiKey(storedKey.apiKey),
      storedAt: new Date(storedKey.createdAt).toLocaleDateString(),
    }
  }

  return {
    provider,
    name: config.name,
    connected: false,
    source: null,
    maskedKey: null,
    storedAt: null,
  }
}

/**
 * Display provider status.
 */
const displayStatus = (status: ProviderStatus): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    if (status.connected) {
      const sourceInfo =
        status.source === "env"
          ? `via ${PROVIDERS[status.provider].envVar}`
          : `stored ${status.storedAt}`
      yield* Console.log(`  ${status.name}: ✓ Connected (${status.maskedKey}) - ${sourceInfo}`)
    } else {
      yield* Console.log(`  ${status.name}: ✗ Not connected`)
    }
  })

/**
 * Login flow for a specific provider.
 */
const loginProvider = (provider: ProviderName): Effect.Effect<void, ConfigError, AuthService> =>
  Effect.gen(function* () {
    const auth = yield* AuthService
    const config = PROVIDERS[provider]

    yield* Console.log("")
    yield* Console.log(`Connecting to ${config.name}...`)
    yield* Console.log("")

    // Try to open browser
    yield* Console.log(`Opening ${config.name} console to create an API key...`)
    yield* openBrowser(config.consoleUrl).pipe(
      Effect.catchAll(() => Console.log("Could not open browser automatically."))
    )
    yield* Console.log(`  ${config.consoleUrl}`)
    yield* Console.log("")

    // Prompt for API key
    const apiKey = yield* promptInput("Paste your API key: ")

    if (!apiKey) {
      yield* Console.log("\nAborted.")
      return
    }

    if (!isValidApiKey(provider, apiKey)) {
      yield* Console.error(`\nInvalid API key format. Expected: ${config.keyPrefix}...`)
      return
    }

    // Save credentials
    yield* auth.saveApiKey(provider, apiKey)
    yield* Console.log(`\n✓ ${config.name} connected! Saved to ~/.config/gritty/auth.json`)
  })

/**
 * The auth login command - interactive provider selection.
 */
const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService

    // Get current status for all providers
    const allCreds = yield* auth.getAllCredentials()
    const statuses: ProviderStatus[] = (["anthropic", "openai"] as const).map((p) =>
      getProviderStatus(p, process.env[PROVIDERS[p].envVar], allCreds[p])
    )

    // Display current status
    yield* Console.log("Provider Status:")
    yield* Console.log("")
    for (const status of statuses) {
      yield* displayStatus(status)
    }
    yield* Console.log("")

    // Show options
    yield* Console.log("Select a provider to connect:")
    yield* Console.log("")

    const options: { num: number; provider: ProviderName; label: string }[] = []
    let num = 1

    for (const status of statuses) {
      const hasEnv = !!process.env[PROVIDERS[status.provider].envVar]
      if (hasEnv) {
        yield* Console.log(`  ${num}. ${status.name} (using env var - no action needed)`)
      } else if (status.connected) {
        yield* Console.log(`  ${num}. ${status.name} (reconnect/update key)`)
        options.push({ num, provider: status.provider, label: status.name })
      } else {
        yield* Console.log(`  ${num}. ${status.name}`)
        options.push({ num, provider: status.provider, label: status.name })
      }
      num++
    }

    yield* Console.log(`  0. Cancel`)
    yield* Console.log("")

    if (options.length === 0) {
      yield* Console.log("All providers are connected via environment variables.")
      return
    }

    // Get selection
    const selection = yield* promptInput("Enter number: ")
    const selectedNum = parseInt(selection, 10)

    if (selectedNum === 0 || isNaN(selectedNum)) {
      yield* Console.log("Cancelled.")
      return
    }

    const selected = options.find((o) => o.num === selectedNum)
    if (!selected) {
      yield* Console.log("Invalid selection.")
      return
    }

    // Run login flow for selected provider
    yield* loginProvider(selected.provider)
  }).pipe(Effect.catchTag("ConfigError", (e) => Console.error(`\n✗ ${e.message}`)))
).pipe(Command.withDescription("Connect to an AI provider"))

/**
 * The auth status command.
 */
const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService

    // Get all credentials
    const allCreds = yield* auth.getAllCredentials()

    yield* Console.log("Provider Status:")
    yield* Console.log("")

    for (const provider of ["anthropic", "openai"] as const) {
      const status = getProviderStatus(
        provider,
        process.env[PROVIDERS[provider].envVar],
        allCreds[provider]
      )
      yield* displayStatus(status)
    }

    yield* Console.log("")
    yield* Console.log("Run 'gritty auth login' to connect a provider.")
  }).pipe(Effect.catchTag("ConfigError", (e) => Console.error(`\n✗ ${e.message}`)))
).pipe(Command.withDescription("Show authentication status"))

/**
 * The auth logout command.
 */
const logoutCommand = Command.make("logout", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService

    // Get all credentials
    const allCreds = yield* auth.getAllCredentials()
    const hasStored = allCreds.anthropic || allCreds.openai

    if (!hasStored) {
      yield* Console.log("No stored credentials found.")
      return
    }

    // Show what will be removed
    yield* Console.log("Stored credentials:")
    if (allCreds.anthropic) {
      yield* Console.log(`  Anthropic: ${maskApiKey(allCreds.anthropic.apiKey)}`)
    }
    if (allCreds.openai) {
      yield* Console.log(`  OpenAI: ${maskApiKey(allCreds.openai.apiKey)}`)
    }
    yield* Console.log("")

    const confirm = yield* promptInput("Remove all stored credentials? (y/N): ")

    if (confirm.toLowerCase() !== "y") {
      yield* Console.log("Cancelled.")
      return
    }

    // Remove all credentials
    yield* auth.removeCredentials()
    yield* Console.log("✓ Removed all stored credentials")

    // Notify about env vars
    const envVars = []
    if (process.env["ANTHROPIC_API_KEY"]) envVars.push("ANTHROPIC_API_KEY")
    if (process.env["OPENAI_API_KEY"]) envVars.push("OPENAI_API_KEY")

    if (envVars.length > 0) {
      yield* Console.log("")
      yield* Console.log(`Note: ${envVars.join(", ")} environment variable(s) still set.`)
    }
  }).pipe(Effect.catchTag("ConfigError", (e) => Console.error(`\n✗ ${e.message}`)))
).pipe(Command.withDescription("Remove stored credentials"))

/**
 * The main auth command with subcommands.
 */
export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Manage AI provider authentication"),
  Command.withSubcommands([loginCommand, statusCommand, logoutCommand])
)
