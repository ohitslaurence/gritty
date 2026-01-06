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
}

/**
 * Git service tag for dependency injection.
 */
export class GitService extends Context.Tag("GitService")<GitService, GitServiceImpl>() {}
