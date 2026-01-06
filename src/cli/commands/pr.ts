import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { AIService } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { GitService } from "../../services/git/service"
import { UserError, GitError } from "../../types/errors"
import { confirmWithEdit } from "../../core/prompt"
import { requireGhCli } from "../../core/gh-utils"

/**
 * Speed tier options.
 */
const fastOption = Options.boolean("fast").pipe(
  Options.withAlias("f"),
  Options.withDescription("Use Haiku for speed")
)

const slowOption = Options.boolean("slow").pipe(
  Options.withAlias("s"),
  Options.withDescription("Use Opus for quality")
)

/**
 * Other options.
 */
const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Preview PR without creating")
)

const acceptOption = Options.boolean("accept").pipe(
  Options.withAlias("a"),
  Options.withDescription("Skip confirmation prompt")
)

const draftOption = Options.boolean("draft").pipe(
  Options.withDescription("Create as draft PR")
)

const baseOption = Options.text("base").pipe(
  Options.withAlias("b"),
  Options.withDescription("Base branch (default: main or master)"),
  Options.optional
)

const contextOption = Options.text("context").pipe(
  Options.withAlias("c"),
  Options.withDescription("Context for AI (e.g., 'implements RFC-123')"),
  Options.optional
)

const prOptions = {
  fast: fastOption,
  slow: slowOption,
  dryRun: dryRunOption,
  accept: acceptOption,
  draft: draftOption,
  base: baseOption,
  context: contextOption,
}

/**
 * Create PR using gh CLI.
 */
const createPR = (
  title: string,
  body: string,
  base: string,
  draft: boolean
): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const args = ["gh", "pr", "create", "--title", title, "--body", body, "--base", base]
      if (draft) {
        args.push("--draft")
      }

      const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || "Failed to create PR")
      }

      return stdout.trim()
    },
    catch: (error) =>
      new GitError({
        operation: "pr create",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Format PR preview for display.
 */
const formatPRPreview = (title: string, body: string, base: string, branch: string): string => {
  const separator = "─".repeat(60)
  return `
${separator}
${branch} → ${base}
${separator}
${title}
${separator}
${body}
${separator}`
}

/**
 * The pr command implementation.
 */
export const prCommand = Command.make(
  "pr",
  prOptions,
  ({ fast, slow, dryRun, accept, draft, base, context }) =>
    Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService
      const config = yield* ConfigService

      // Check if we're in a git repo
      const isRepo = yield* git.isGitRepo()
      if (!isRepo) {
        return yield* Effect.fail(
          new UserError({ message: "Not a git repository" })
        )
      }

      // Check gh CLI is installed and authenticated
      yield* requireGhCli()

      // Get current branch
      const branchName = yield* git.getBranchName()

      // Determine base branch
      const defaultBranch = yield* git.getDefaultBranch()
      const baseBranch = Option.getOrElse(base, () => defaultBranch)

      // Check we're not on the base branch
      if (branchName === baseBranch) {
        return yield* Effect.fail(
          new UserError({
            message: `Cannot create PR from ${baseBranch}.\n  Create a feature branch: gritty branch feat/your-feature`,
          })
        )
      }

      // Get commits ahead of base
      const commits = yield* git.getCommitsAhead(baseBranch)
      if (commits.length === 0) {
        return yield* Effect.fail(
          new UserError({
            message: `No commits ahead of ${baseBranch}.\n  Make some commits first!`,
          })
        )
      }

      // Check if branch is pushed to remote
      const hasRemote = yield* git.hasRemote()
      if (!hasRemote && !dryRun) {
        yield* Console.log(`Pushing branch to origin...`)
        yield* git.push({ setUpstream: true })
      }

      // Get diff from base
      const diff = yield* git.getDiffFromBranch(baseBranch)

      // Determine speed
      const defaultSpeed = yield* config.getDefaultSpeed()
      const speed = fast ? "fast" : slow ? "slow" : defaultSpeed
      const contextValue = Option.getOrUndefined(context)

      yield* Console.log(`Analyzing ${commits.length} commit(s) (${speed} mode)...`)

      // Generate PR description
      const prOptions = contextValue
        ? { speed, context: contextValue, baseBranch, branchName }
        : { speed, baseBranch, branchName }
      const prDescription = yield* ai.generatePRDescription(
        commits.map((c) => ({ message: c.message })),
        diff,
        prOptions
      )

      yield* Console.log(formatPRPreview(prDescription.title, prDescription.body, baseBranch, branchName))

      // Dry run stops here
      if (dryRun) {
        return
      }

      // Auto-accept if flag is set
      if (accept) {
        const prUrl = yield* createPR(prDescription.title, prDescription.body, baseBranch, draft)
        yield* Console.log(`\n✓ PR created: ${prUrl}`)
        return
      }

      // Interactive confirmation
      const response = yield* confirmWithEdit("\nCreate PR?")

      switch (response) {
        case "yes": {
          const prUrl = yield* createPR(prDescription.title, prDescription.body, baseBranch, draft)
          yield* Console.log(`\n✓ PR created: ${prUrl}`)
          break
        }
        case "edit": {
          // For edit, we'll create PR with gh pr create --web to open browser
          yield* Console.log("\nOpening GitHub in browser for manual editing...")
          yield* Effect.tryPromise({
            try: async () => {
              const proc = Bun.spawn(["gh", "pr", "create", "--web"], {
                stdout: "inherit",
                stderr: "inherit",
              })
              await proc.exited
            },
            catch: () => new GitError({ operation: "pr create --web", message: "Failed to open browser", cause: undefined }),
          })
          break
        }
        case "no":
          yield* Console.log("\nAborted.")
          break
      }
    }).pipe(
      Effect.catchTags({
        UserError: (e) => Console.error(`\n✗ ${e.message}`),
        GitError: (e) =>
          Console.error(`\n✗ Git error: ${e.message}\n  Try: git status`),
        AIError: (e) =>
          Console.error(
            e.retryable
              ? `\n✗ AI error: ${e.message}\n  This may be a rate limit - try again in a moment`
              : `\n✗ AI error: ${e.message}\n  Check your API key with: gritty auth status`
          ),
        ConfigError: (e) =>
          Console.error(
            `\n✗ Config error: ${e.message}\n  Check your .grittyrc file for syntax errors`
          ),
      })
    )
).pipe(Command.withDescription("Create a PR with AI-generated description"))
