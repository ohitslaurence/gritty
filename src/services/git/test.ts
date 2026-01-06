import { Effect, Layer } from "effect"
import { BranchName, DiffContent } from "../../types/branded"
import type { Commit } from "../../types/models"
import { GitService, type GitServiceImpl } from "./service"

/**
 * Default implementations for new git methods.
 */
const defaultBranchMethods = {
  checkoutBranch: () => Effect.void,
  branchExists: () => Effect.succeed(false),
  getDefaultBranch: () => Effect.succeed(BranchName("main")),
  getCommitsAhead: () => Effect.succeed([] as readonly Commit[]),
  getDiffFromBranch: () => Effect.succeed(DiffContent("")),
  hasRemote: () => Effect.succeed(false),
  push: () => Effect.void,
}

/**
 * Create a test GitService with configurable behavior.
 */
export const TestGitService = {
  /**
   * Create a test layer with custom implementation.
   */
  make: (impl: Partial<GitServiceImpl>): Layer.Layer<GitService> =>
    Layer.succeed(
      GitService,
      GitService.of({
        getStagedDiff: impl.getStagedDiff ?? (() => Effect.succeed(DiffContent(""))),
        getRecentCommits: impl.getRecentCommits ?? (() => Effect.succeed([])),
        commit: impl.commit ?? (() => Effect.void),
        getStatus:
          impl.getStatus ?? (() => Effect.succeed({ staged: [], unstaged: [], untracked: [] })),
        stageAll: impl.stageAll ?? (() => Effect.void),
        stageFiles: impl.stageFiles ?? (() => Effect.void),
        unstageAll: impl.unstageAll ?? (() => Effect.void),
        getChangedFiles: impl.getChangedFiles ?? (() => Effect.succeed([])),
        getDiffForFiles: impl.getDiffForFiles ?? (() => Effect.succeed(DiffContent(""))),
        getBranchName: impl.getBranchName ?? (() => Effect.succeed(BranchName("main"))),
        isGitRepo: impl.isGitRepo ?? (() => Effect.succeed(true)),
        getFileDiff: impl.getFileDiff ?? (() => Effect.succeed("")),
        checkoutBranch: impl.checkoutBranch ?? defaultBranchMethods.checkoutBranch,
        branchExists: impl.branchExists ?? defaultBranchMethods.branchExists,
        getDefaultBranch: impl.getDefaultBranch ?? defaultBranchMethods.getDefaultBranch,
        getCommitsAhead: impl.getCommitsAhead ?? defaultBranchMethods.getCommitsAhead,
        getDiffFromBranch: impl.getDiffFromBranch ?? defaultBranchMethods.getDiffFromBranch,
        hasRemote: impl.hasRemote ?? defaultBranchMethods.hasRemote,
        push: impl.push ?? defaultBranchMethods.push,
      })
    ),

  /**
   * Create a test layer with a specific staged diff.
   */
  withStagedDiff: (diff: string): Layer.Layer<GitService> =>
    TestGitService.make({
      getStagedDiff: () => Effect.succeed(DiffContent(diff)),
    }),

  /**
   * Create a test layer with specific recent commits.
   */
  withRecentCommits: (commits: readonly Commit[]): Layer.Layer<GitService> =>
    TestGitService.make({
      getRecentCommits: () => Effect.succeed(commits),
    }),

  /**
   * Create a test layer that captures the commit message.
   */
  withCommitCapture: (
    capture: (message: string) => void
  ): Layer.Layer<GitService> =>
    TestGitService.make({
      commit: (message) => {
        capture(message)
        return Effect.void
      },
    }),

  /**
   * Default empty test layer.
   */
  empty: Layer.succeed(
    GitService,
    GitService.of({
      getStagedDiff: () => Effect.succeed(DiffContent("")),
      getRecentCommits: () => Effect.succeed([]),
      commit: () => Effect.void,
      getStatus: () => Effect.succeed({ staged: [], unstaged: [], untracked: [] }),
      stageAll: () => Effect.void,
      stageFiles: () => Effect.void,
      unstageAll: () => Effect.void,
      getChangedFiles: () => Effect.succeed([]),
      getDiffForFiles: () => Effect.succeed(DiffContent("")),
      getBranchName: () => Effect.succeed(BranchName("main")),
      isGitRepo: () => Effect.succeed(true),
      getFileDiff: () => Effect.succeed(""),
      ...defaultBranchMethods,
    })
  ),
}
