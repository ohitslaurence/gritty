import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { AIServiceLive } from "../services/ai/live"
import { AuthServiceLive } from "../services/auth/live"
import { ConfigServiceLive } from "../services/config/live"
import { GitServiceLive } from "../services/git/live"
import { StateServiceLive } from "../services/state/live"
import { authCommand } from "./commands/auth"
import { branchCommand } from "./commands/branch"
import { commitCommand } from "./commands/commit"
import { composeCommand } from "./commands/compose"
import { configCommand } from "./commands/config"
import { prCommand } from "./commands/pr"

/**
 * The main gritty CLI command.
 */
const grittyCommand = Command.make("gritty").pipe(
  Command.withDescription("AI-powered Git CLI tool"),
  Command.withSubcommands([commitCommand, composeCommand, prCommand, branchCommand, authCommand, configCommand])
)

/**
 * The application layer with all services.
 * AIServiceLive depends on AuthServiceLive and ConfigServiceLive.
 */
const AIWithDeps = AIServiceLive.pipe(
  Layer.provide(Layer.merge(AuthServiceLive, ConfigServiceLive))
)

const AppLayer = Layer.mergeAll(
  GitServiceLive,
  AIWithDeps,
  AuthServiceLive,
  ConfigServiceLive,
  StateServiceLive
)

/**
 * Create the CLI runner.
 */
const cli = Command.run(grittyCommand, {
  name: "gritty",
  version: "0.1.0",
})

/**
 * Main entry point.
 */
export const main = (): void => {
  Effect.suspend(() => cli(process.argv)).pipe(
    Effect.provide(AppLayer),
    Effect.provide(BunContext.layer),
    BunRuntime.runMain
  )
}
