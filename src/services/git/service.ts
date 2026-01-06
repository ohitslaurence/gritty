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
   * Stage specific files.
   */
  readonly stageFiles: (files: readonly string[]) => Effect.Effect<void, GitError>

  /**
   * Unstage all files.
   */
  readonly unstageAll: () => Effect.Effect<void, GitError>

  /**
   * Get list of changed files (staged + unstaged).
   */
  readonly getChangedFiles: () => Effect.Effect<readonly string[], GitError>

  /**
   * Get diff for specific files only.
   */
  readonly getDiffForFiles: (files: readonly string[]) => Effect.Effect<DiffContent, GitError>

  /**
   * Get the current branch name.
   */
  readonly getBranchName: () => Effect.Effect<BranchName, GitError>

  /**
   * Check if we're in a git repository.
   */
  readonly isGitRepo: () => Effect.Effect<boolean, GitError>

  /**
   * Get the diff for a single file.
   */
  readonly getFileDiff: (file: string) => Effect.Effect<string, GitError>

  /**
   * Switch to a branch, creating it if it doesn't exist.
   */
  readonly checkoutBranch: (
    name: string,
    options?: { create?: boolean }
  ) => Effect.Effect<void, GitError>

  /**
   * Check if a branch exists.
   */
  readonly branchExists: (name: string) => Effect.Effect<boolean, GitError>

  /**
   * Get the default branch (main or master).
   */
  readonly getDefaultBranch: () => Effect.Effect<BranchName, GitError>

  /**
   * Get commits ahead of a base branch.
   */
  readonly getCommitsAhead: (
    base: string
  ) => Effect.Effect<readonly Commit[], GitError>

  /**
   * Get diff from base branch to HEAD.
   */
  readonly getDiffFromBranch: (base: string) => Effect.Effect<DiffContent, GitError>

  /**
   * Check if current branch has been pushed to remote.
   */
  readonly hasRemote: () => Effect.Effect<boolean, GitError>

  /**
   * Push current branch to remote.
   */
  readonly push: (options?: { setUpstream?: boolean }) => Effect.Effect<void, GitError>
}

/**
 * Git service tag for dependency injection.
 */
export class GitService extends Context.Tag("GitService")<GitService, GitServiceImpl>() {}
