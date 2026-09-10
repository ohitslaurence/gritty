import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"
import { AIService } from "../../services/ai/service"
import { ConfigService } from "../../services/config/service"
import { GitService } from "../../services/git/service"
import { UserError, GitError } from "../../types/errors"
import { confirmWithEdit } from "../../core/prompt"
import { requireGhCli } from "../../core/gh-utils"
import { makeOutput, reportError } from "../../core/output"

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

const trailerOption = Options.text("trailer").pipe(
  Options.withAlias("t"),
  Options.withDescription("Line to append to the PR body footer (repeatable)"),
  Options.repeated
)

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Machine-readable result on stdout; progress goes to stderr")
)

const prOptions = {
  fast: fastOption,
  slow: slowOption,
  dryRun: dryRunOption,
  accept: acceptOption,
  draft: draftOption,
  base: baseOption,
  context: contextOption,
  trailer: trailerOption,
  json: jsonOption,
}

/**
 * Append footer lines to a PR body, separated by a blank line.
 */
export const withFooter = (body: string, footerLines: readonly string[]): string => {
  const footer = footerLines.filter((l) => l.trim()).join("\n")
  if (!footer) return body
  return `${body.trimEnd()}\n\n${footer}`
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
const formatPRPreview = (
  title: string,
  body: string,
  base: string,
  branch: string,
  baseRef: string,
  mergeBase: string
): string => {
  const separator = "─".repeat(60)
  return `
${separator}
${branch} → ${base}  (diffed against ${baseRef}, merge-base ${mergeBase.slice(0, 7)})
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
  ({ fast, slow, dryRun, accept, draft, base, context, trailer, json }) =>
    Effect.gen(function* () {
      const git = yield* GitService
      const ai = yield* AIService
      const config = yield* ConfigService
      const output = makeOutput(json)
      const { log, emit } = output

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

      // Compare against the remote-tracking base when available. Local base
      // branches go stale in worktrees and would leak unrelated changes.
      const fetched = yield* git.fetchBranch(baseBranch)
      const baseRef = yield* git.getBaseRef(baseBranch)
      if (!fetched && baseRef.startsWith("origin/")) {
        yield* log(`⚠ Could not fetch origin/${baseBranch}; using cached remote ref`)
      }

      // Get commits ahead of base
      const commits = yield* git.getCommitsAhead(baseRef)
      if (commits.length === 0) {
        return yield* Effect.fail(
          new UserError({
            message: `No commits ahead of ${baseRef}.\n  Make some commits first!`,
          })
        )
      }

      const mergeBase = yield* git.getMergeBase(baseRef)

      // Push if the upstream is missing or behind HEAD
      if (!dryRun) {
        const hasRemote = yield* git.hasRemote()
        if (!hasRemote) {
          yield* log(`Pushing branch to origin...`)
          yield* git.push({ setUpstream: true })
        } else if (!(yield* git.isPushed())) {
          yield* log(`Pushing new commits to origin...`)
          yield* git.push()
        }
      }

      // Get diff from base
      const diff = yield* git.getDiffFromBranch(baseRef)

      // Determine speed
      const defaultSpeed = yield* config.getDefaultSpeed()
      const speed = fast ? "fast" : slow ? "slow" : defaultSpeed
      const contextValue = Option.getOrUndefined(context)

      yield* log(`Analyzing ${commits.length} commit(s) (${speed} mode)...`)

      // Generate PR description
      const prOptions = contextValue
        ? { speed, context: contextValue, baseBranch, branchName }
        : { speed, baseBranch, branchName }
      const prDescription = yield* ai.generatePRDescription(
        commits.map((c) => ({ message: c.message })),
        diff,
        prOptions
      )

      const configFooter = yield* config.getPRFooter()
      const body = withFooter(prDescription.body, [configFooter, ...trailer])
      const title = prDescription.title

      yield* log(formatPRPreview(title, body, baseBranch, branchName, baseRef, mergeBase))

      const result = {
        command: "pr",
        branch: branchName,
        base: baseBranch,
        baseRef,
        mergeBase,
        commitCount: commits.length,
        title,
        body,
        draft,
      }

      // Dry run stops here
      if (dryRun) {
        yield* emit({ ...result, dryRun: true })
        return
      }

      // Auto-accept if flag is set
      if (accept) {
        const prUrl = yield* createPR(title, body, baseBranch, draft)
        yield* log(`\n✓ PR created: ${prUrl}`)
        yield* emit({ ...result, dryRun: false, url: prUrl })
        return
      }

      // Interactive confirmation
      const response = yield* confirmWithEdit("\nCreate PR?")

      switch (response) {
        case "yes": {
          const prUrl = yield* createPR(title, body, baseBranch, draft)
          yield* log(`\n✓ PR created: ${prUrl}`)
          break
        }
        case "edit": {
          // For edit, we'll create PR with gh pr create --web to open browser
          yield* log("\nOpening GitHub in browser for manual editing...")
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
          yield* log("\nAborted.")
          break
      }
    }).pipe(
      Effect.catchTags({
        UserError: (e) => reportError(makeOutput(json), e),
        GitError: (e) => reportError(makeOutput(json), e),
        AIError: (e) => reportError(makeOutput(json), e),
        ConfigError: (e) => reportError(makeOutput(json), e),
      })
    )
).pipe(Command.withDescription("Create a PR with AI-generated description"))
