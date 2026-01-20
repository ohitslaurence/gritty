import { Console, Effect } from "effect"
import { DiffContent } from "../types/branded"
import type { SpeedTier } from "../types/models"
import { AIService, type ProposedCommit } from "../services/ai/service"
import { GitService } from "../services/git/service"
import { confirm } from "./prompt"
import { commitWithEditor } from "./git-utils"

/**
 * Options for executing composed commits.
 */
export interface ComposeExecutorOptions {
  readonly speed: SpeedTier
  readonly accept: boolean
  readonly recentCommits: readonly { hash: string; message: string; author: string; date: Date }[]
}

/**
 * Execute a single proposed commit.
 */
const executeCommit = (
  git: GitService["Type"],
  ai: AIService["Type"],
  commit: ProposedCommit,
  options: ComposeExecutorOptions
) =>
  Effect.gen(function* () {
    // Unstage everything first
    yield* git.unstageAll().pipe(Effect.catchAll(() => Effect.void))

    // Stage only this commit's files
    yield* git.stageFiles(commit.files)

    // Get the actual diff for these files
    const diff = yield* git.getDiffForFiles(commit.files)

    if (!diff || diff.trim().length === 0) {
      yield* Console.log(`  Skipping "${commit.title}" (no changes)`)
      return
    }

    // Generate full commit message
    yield* Console.log(`\n  Generating message for: ${commit.title}...`)
    const message = yield* ai.generateCommitMessage(DiffContent(diff), {
      speed: options.speed,
      recentCommits: options.recentCommits,
      context: `Commit title: ${commit.title}. Reason: ${commit.reason}`,
    })

    yield* Console.log(`\n  Message: ${message.split("\n")[0]}`)

    // Auto-accept skips confirmation and editor
    if (options.accept) {
      yield* git.commit(message)
      yield* Console.log(`  ✓ Committed`)
      return
    }

    // Interactive: confirm then optionally edit
    const shouldCommit = yield* confirm("  Commit this?")

    if (shouldCommit) {
      const committed = yield* commitWithEditor(message)
      if (committed) {
        yield* Console.log(`  ✓ Committed`)
      } else {
        yield* Console.log(`  Aborted`)
      }
    } else {
      yield* Console.log(`  Skipped`)
    }
  })

/**
 * Execute a sequence of proposed commits.
 * Used by both compose and commit (when triage suggests composing).
 */
export const executeComposedCommits = (
  proposedCommits: readonly ProposedCommit[],
  options: ComposeExecutorOptions
) =>
  Effect.gen(function* () {
    const git = yield* GitService
    const ai = yield* AIService

    yield* Console.log("\nExecuting commits...\n")

    for (const commit of proposedCommits) {
      yield* executeCommit(git, ai, commit, options)
    }

    yield* Console.log(`\n✓ Compose complete`)
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
