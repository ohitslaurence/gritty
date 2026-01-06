import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { ConfigError } from "../../types/errors"
import { ConfigService } from "../../services/config/service"

/**
 * Default config template for .grittyrc
 */
const DEFAULT_CONFIG_TEMPLATE = `{
  "version": 1,
  "commit": {
    "style": "conventional",
    "model": {
      "default": "medium",
      "fast": "claude-3-5-haiku-latest",
      "medium": "claude-sonnet-4-20250514",
      "slow": "claude-opus-4-20250514"
    }
  }
}
`

/**
 * Write config file to current directory.
 */
const writeConfigFile = (content: string): Effect.Effect<void, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const file = Bun.file(".grittyrc")
      if (await file.exists()) {
        throw new Error(".grittyrc already exists")
      }
      await Bun.write(".grittyrc", content)
    },
    catch: (error) =>
      new ConfigError({
        message: error instanceof Error ? error.message : "Failed to write .grittyrc",
        cause: error,
      }),
  })

/**
 * Check which config file is being used.
 */
const getConfigSource = (): Effect.Effect<string, never> =>
  Effect.gen(function* () {
    const rcFile = Bun.file(".grittyrc")
    if (yield* Effect.promise(() => rcFile.exists())) {
      return ".grittyrc (project)"
    }

    const jsonFile = Bun.file(".gritty.json")
    if (yield* Effect.promise(() => jsonFile.exists())) {
      return ".gritty.json (project)"
    }

    const homeDir = process.env["HOME"] ?? ""
    const homeFile = Bun.file(`${homeDir}/.gritty/config.json`)
    if (yield* Effect.promise(() => homeFile.exists())) {
      return `~/.gritty/config.json (user)`
    }

    return "defaults (no config file found)"
  })

/**
 * The config init command - creates a .grittyrc in the current directory.
 */
const initCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    yield* writeConfigFile(DEFAULT_CONFIG_TEMPLATE)
    yield* Console.log("✓ Created .grittyrc")
    yield* Console.log("\nYou can customize:")
    yield* Console.log('  - commit.model.default: "fast" | "medium" | "slow"')
    yield* Console.log('  - commit.model.fast/medium/slow: custom model IDs')
    yield* Console.log('  - commit.style: "conventional" | "gitmoji" | "freeform"')
  }).pipe(
    Effect.catchTag("ConfigError", (e) =>
      Console.error(`\n✗ ${e.message}`)
    )
  )
).pipe(Command.withDescription("Create .grittyrc in current directory"))

/**
 * The config show command - displays current configuration.
 */
const showCommand = Command.make("show", {}, () =>
  Effect.gen(function* () {
    const configService = yield* ConfigService
    const config = yield* configService.load()
    const source = yield* getConfigSource()

    yield* Console.log(`Config source: ${source}\n`)
    yield* Console.log(JSON.stringify(config, null, 2))
  }).pipe(
    Effect.catchTag("ConfigError", (e) =>
      Console.error(`\n✗ Config error: ${e.message}`)
    )
  )
).pipe(Command.withDescription("Show current configuration"))

/**
 * The config command - manage gritty configuration.
 */
export const configCommand = Command.make("config").pipe(
  Command.withDescription("Manage gritty configuration"),
  Command.withSubcommands([initCommand, showCommand])
)
