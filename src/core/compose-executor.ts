import { Effect } from "effect"
import { DiffContent } from "../types/branded"
import type { SpeedTier } from "../types/models"
import type { AIError, GitError } from "../types/errors"
import { AIService, type ProposedCommit } from "../services/ai/service"
import { GitService } from "../services/git/service"
import { confirm } from "./prompt"
import { commitWithEditor } from "./git-utils"
import type { Output } from "./output"

/**
 * Options for executing composed commits.
 */
export interface ComposeExecutorOptions {
  readonly speed: SpeedTier
  readonly accept: boolean
  readonly recentCommits: readonly { hash: string; message: string; author: string; date: Date }[]
  readonly trailers: readonly string[]
  readonly output: Output
}

/**
 * A commit that was actually created.
 */
export interface CommittedResult {
  readonly hash: string
  readonly subject: string
  readonly files: readonly string[]
}

/**
 * Execute a single proposed commit.
 */
const executeCommit = (
  git: GitService["Type"],
  ai: AIService["Type"],
  commit: ProposedCommit,
  options: ComposeExecutorOptions
): Effect.Effect<CommittedResult | null, GitError | AIError> =>
  Effect.gen(function* () {
    const { log } = options.output

    // Unstage everything first
    yield* git.unstageAll().pipe(Effect.catchAll(() => Effect.void))

    // Stage only this commit's files
    yield* git.stageFiles(commit.files)

    // Get the actual diff for these files
    const diff = yield* git.getDiffForFiles(commit.files)

    if (!diff || diff.trim().length === 0) {
      yield* log(`  Skipping "${commit.title}" (no changes)`)
      return null
    }

    // Generate full commit message
    yield* log(`\n  Generating message for: ${commit.title}...`)
    const message = yield* ai.generateCommitMessage(DiffContent(diff), {
      speed: options.speed,
      recentCommits: options.recentCommits,
      context: `Commit title: ${commit.title}. Reason: ${commit.reason}`,
    })

    const subject = message.split("\n")[0] ?? ""
    yield* log(`\n  Message: ${subject}`)

    // Auto-accept skips confirmation and editor
    if (options.accept) {
      const hash = yield* git.commit(message, { trailers: options.trailers })
      yield* log(`  ✓ Committed ${hash.slice(0, 7)}`)
      return { hash, subject, files: commit.files }
    }

    // Interactive: confirm then optionally edit
    const shouldCommit = yield* confirm("  Commit this?")

    if (!shouldCommit) {
      yield* log(`  Skipped`)
      return null
    }

    const committed = yield* commitWithEditor(message, options.trailers)
    if (!committed) {
      yield* log(`  Aborted`)
      return null
    }

    const hash = yield* git.getHeadHash()
    yield* log(`  ✓ Committed ${hash.slice(0, 7)}`)
    return { hash, subject, files: commit.files }
  })

/**
 * Execute a sequence of proposed commits.
 * Used by both compose and commit (when triage suggests composing).
 */
export const executeComposedCommits = (
  proposedCommits: readonly ProposedCommit[],
  options: ComposeExecutorOptions
): Effect.Effect<readonly CommittedResult[], GitError | AIError, GitService | AIService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const ai = yield* AIService
    const { log } = options.output

    yield* log("\nExecuting commits...\n")

    const results: CommittedResult[] = []
    for (const commit of proposedCommits) {
      const result = yield* executeCommit(git, ai, commit, options)
      if (result) results.push(result)
    }

    yield* log(`\n✓ Compose complete (${results.length} commit(s))`)
    return results
  })

/**
 * Format proposed commits for display.
 */
export const formatProposedCommits = (commits: readonly ProposedCommit[]): string => {
  const separator = "─".repeat(60)
  const lines = [`\n${separator}`, "Proposed commits:", separator, ""]

  commits.forEach((commit, i) => {
    lines.push(`${i + 1}. ${commit.title}`)
    lines.push(`   Files: ${commit.files.join(", ")}`)
    lines.push(`   Reason: ${commit.reason}`)
    lines.push("")
  })

  lines.push(separator)
  return lines.join("\n")
}
