import { Context, Effect } from "effect"
import type { BranchName, DiffContent } from "../../types/branded"
import type { GitError } from "../../types/errors"
import type { Commit, GitStatus } from "../../types/models"

/**
 * Service interface for git operations.
 */
export interface GitServiceImpl {
  /**
   * Get the staged diff content.
   */
  readonly getStagedDiff: () => Effect.Effect<DiffContent, GitError>

  /**
   * Get recent commits for style detection.
   * @param count Number of commits to retrieve
   */
  readonly getRecentCommits: (count: number) => Effect.Effect<readonly Commit[], GitError>

  /**
   * Create a commit with the given message.
   * @param message The commit message
   */
  readonly commit: (message: string) => Effect.Effect<void, GitError>

  /**
   * Get the current git status.
   */
  readonly getStatus: () => Effect.Effect<GitStatus, GitError>

  /**
   * Stage all changes (git add -A).
   */
  readonly stageAll: () => Effect.Effect<void, GitError>

  /**
   * Get the current branch name.
   */
  readonly getBranchName: () => Effect.Effect<BranchName, GitError>

  /**
   * Check if we're in a git repository.
   */
  readonly isGitRepo: () => Effect.Effect<boolean, GitError>
}

/**
 * Git service tag for dependency injection.
 */
export class GitService extends Context.Tag("GitService")<GitService, GitServiceImpl>() {}
