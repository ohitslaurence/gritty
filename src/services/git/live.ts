import { Effect, Layer } from "effect"
import { BranchName, DiffContent } from "../../types/branded"
import { GitError } from "../../types/errors"
import type { Commit, GitStatus } from "../../types/models"
import { GitService } from "./service"

/**
 * Execute a git command and return stdout.
 */
const execGit = (
  ...args: readonly string[]
): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        throw new Error(stderr || `git ${args[0]} failed with exit code ${exitCode}`)
      }
      // Use trimEnd to preserve leading whitespace (important for git status --porcelain)
      return stdout.trimEnd()
    },
    catch: (error) =>
      new GitError({
        operation: args[0] ?? "unknown",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Parse git log output into Commit objects.
 */
const parseCommits = (output: string): readonly Commit[] => {
  if (!output.trim()) return []

  return output.split("\n").map((line) => {
    // Format: hash|message|author|timestamp
    const [hash, message, author, timestamp] = line.split("|")
    return {
      hash: hash ?? "",
      message: message ?? "",
      author: author ?? "",
      date: new Date(parseInt(timestamp ?? "0", 10) * 1000),
    }
  })
}

/**
 * Parse git status output into GitStatus object.
 */
const parseStatus = (output: string): GitStatus => {
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []

  for (const line of output.split("\n")) {
    if (!line.trim()) continue

    const indexStatus = line[0]
    const workTreeStatus = line[1]
    const filename = line.slice(3)

    if (indexStatus === "?") {
      untracked.push(filename)
    } else {
      if (indexStatus && indexStatus !== " ") {
        staged.push(filename)
      }
      if (workTreeStatus && workTreeStatus !== " ") {
        unstaged.push(filename)
      }
    }
  }

  return { staged, unstaged, untracked }
}

/**
 * Live implementation of GitService.
 */
export const GitServiceLive = Layer.succeed(
  GitService,
  GitService.of({
    getStagedDiff: () =>
      execGit("diff", "--staged").pipe(Effect.map((output) => DiffContent(output))),

    getRecentCommits: (count) =>
      execGit(
        "log",
        `-${count}`,
        "--pretty=format:%H|%s|%an|%at"
      ).pipe(Effect.map(parseCommits)),

    commit: (message) => execGit("commit", "-m", message).pipe(Effect.asVoid),

    getStatus: () => execGit("status", "--porcelain").pipe(Effect.map(parseStatus)),

    stageAll: () => execGit("add", "-A").pipe(Effect.asVoid),

    stageFiles: (files) =>
      files.length > 0
        ? execGit("add", "--", ...files).pipe(Effect.asVoid)
        : Effect.void,

    unstageAll: () => execGit("reset", "HEAD").pipe(Effect.asVoid),

    getChangedFiles: () =>
      execGit("status", "--porcelain").pipe(
        Effect.map((output) => {
          if (!output.trim()) return []
          return output
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => line.slice(3)) // Remove status prefix
        })
      ),

    getDiffForFiles: (files) =>
      files.length > 0
        ? execGit("diff", "--staged", "--", ...files).pipe(
            Effect.map((output) => DiffContent(output))
          )
        : Effect.succeed(DiffContent("")),

    getBranchName: () =>
      execGit("rev-parse", "--abbrev-ref", "HEAD").pipe(
        Effect.map((name) => BranchName(name))
      ),

    isGitRepo: () =>
      execGit("rev-parse", "--git-dir").pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false))
      ),

    getFileDiff: (file) =>
      // Try staged diff first, fall back to unstaged
      execGit("diff", "--staged", "--", file).pipe(
        Effect.flatMap((diff) =>
          diff.trim()
            ? Effect.succeed(diff)
            : execGit("diff", "--", file)
        ),
        Effect.flatMap((diff) =>
          diff.trim()
            ? Effect.succeed(diff)
            : // For untracked files, read file content directly
              // (git diff --no-index returns exit code 1 on differences)
              Effect.tryPromise({
                try: async () => {
                  const content = await Bun.file(file).text()
                  // Format as a simple diff-like output
                  return `+++ ${file}\n${content.split("\n").map((line) => `+${line}`).join("\n")}`
                },
                catch: () => new GitError({ operation: "read", message: `Failed to read ${file}`, cause: undefined }),
              })
        ),
        Effect.catchAll(() => Effect.succeed(""))
      ),

    checkoutBranch: (name, options) =>
      Effect.gen(function* () {
        if (options?.create) {
          // Create and switch
          yield* execGit("checkout", "-b", name)
        } else {
          // Try to switch, create if doesn't exist
          const exists = yield* execGit("show-ref", "--verify", `refs/heads/${name}`).pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false))
          )
          if (exists) {
            yield* execGit("checkout", name)
          } else {
            yield* execGit("checkout", "-b", name)
          }
        }
      }),

    branchExists: (name) =>
      execGit("show-ref", "--verify", `refs/heads/${name}`).pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false))
      ),

    getDefaultBranch: () =>
      Effect.gen(function* () {
        // Try main first, then master
        const mainExists = yield* execGit("show-ref", "--verify", "refs/heads/main").pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false))
        )
        if (mainExists) return BranchName("main")

        const masterExists = yield* execGit("show-ref", "--verify", "refs/heads/master").pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false))
        )
        if (masterExists) return BranchName("master")

        // Fall back to main as default
        return BranchName("main")
      }),

    getCommitsAhead: (base) =>
      execGit("log", `${base}..HEAD`, "--pretty=format:%H|%s|%an|%at").pipe(
        Effect.map(parseCommits)
      ),

    getDiffFromBranch: (base) =>
      execGit("diff", `${base}..HEAD`).pipe(
        Effect.map((output) => DiffContent(output))
      ),

    hasRemote: () =>
      execGit("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false))
      ),

    push: (options) =>
      options?.setUpstream
        ? execGit("push", "-u", "origin", "HEAD").pipe(Effect.asVoid)
        : execGit("push").pipe(Effect.asVoid),
  })
)
