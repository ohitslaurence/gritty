import { Effect } from "effect"
import { GitError } from "../types/errors"
import type { FilePreview } from "../types/review-state"

/**
 * PR info from gh CLI.
 */
export interface PRInfo {
  number: number
  title: string
  body: string
  author: string
}

/**
 * List open PRs in the current repository.
 */
export const listOpenPRs = (): Effect.Effect<readonly PRInfo[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["gh", "pr", "list", "--json", "number,title,body,author", "--limit", "20"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || "Failed to list PRs")
      }

      const prs = JSON.parse(stdout) as Array<{
        number: number
        title: string
        body: string
        author: { login: string }
      }>

      return prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        author: pr.author.login,
      }))
    },
    catch: (error) =>
      new GitError({
        operation: "pr list",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Get PR info by number.
 */
export const getPRInfo = (prNumber: number): Effect.Effect<PRInfo, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["gh", "pr", "view", String(prNumber), "--json", "number,title,body,author"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || `Failed to get PR #${prNumber}`)
      }

      const pr = JSON.parse(stdout) as {
        number: number
        title: string
        body: string
        author: { login: string }
      }

      return {
        number: pr.number,
        title: pr.title,
        body: pr.body || "",
        author: pr.author.login,
      }
    },
    catch: (error) =>
      new GitError({
        operation: "pr view",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Get PR diff.
 */
export const getPRDiff = (prNumber: number): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "pr", "diff", String(prNumber)], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || `Failed to get diff for PR #${prNumber}`)
      }

      return stdout
    },
    catch: (error) =>
      new GitError({
        operation: "pr diff",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Extract PR number from URL or string.
 */
export const parsePRNumber = (input: string): number | null => {
  // Direct number
  const num = parseInt(input, 10)
  if (!isNaN(num) && num > 0) {
    return num
  }

  // GitHub URL: https://github.com/owner/repo/pull/123
  const urlMatch = input.match(/\/pull\/(\d+)/)
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10)
  }

  return null
}

/**
 * PR file info from gh CLI.
 */
export interface PRFile {
  path: string
  additions: number
  deletions: number
  patch: string
}

/**
 * Parse a unified diff into per-file patches.
 */
const parseDiffByFile = (diff: string): Map<string, string> => {
  const patches = new Map<string, string>()
  const lines = diff.split("\n")

  let currentFile: string | null = null
  let currentPatch: string[] = []

  for (const line of lines) {
    // New file starts with "diff --git a/path b/path"
    if (line.startsWith("diff --git ")) {
      // Save previous file's patch
      if (currentFile && currentPatch.length > 0) {
        patches.set(currentFile, currentPatch.join("\n"))
      }

      // Extract file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/.+ b\/(.+)/)
      currentFile = match?.[1] ?? null
      currentPatch = [line]
    } else if (currentFile) {
      currentPatch.push(line)
    }
  }

  // Don't forget the last file
  if (currentFile && currentPatch.length > 0) {
    patches.set(currentFile, currentPatch.join("\n"))
  }

  return patches
}

/**
 * Get changed files in a PR with their diffs.
 */
export const getPRFiles = (prNumber: number): Effect.Effect<readonly PRFile[], GitError> =>
  Effect.tryPromise({
    try: async () => {
      // Get file metadata and full diff in parallel
      const [metaProc, diffProc] = await Promise.all([
        (async () => {
          const proc = Bun.spawn(
            ["gh", "pr", "view", String(prNumber), "--json", "files"],
            { stdout: "pipe", stderr: "pipe" }
          )
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          await proc.exited
          return { exitCode: proc.exitCode, stdout, stderr }
        })(),
        (async () => {
          const proc = Bun.spawn(
            ["gh", "pr", "diff", String(prNumber)],
            { stdout: "pipe", stderr: "pipe" }
          )
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          await proc.exited
          return { exitCode: proc.exitCode, stdout, stderr }
        })(),
      ])

      if (metaProc.exitCode !== 0) {
        throw new Error(metaProc.stderr || `Failed to get files for PR #${prNumber}`)
      }

      const data = JSON.parse(metaProc.stdout) as {
        files: Array<{
          path: string
          additions: number
          deletions: number
        }>
      }

      // Parse the full diff to get per-file patches
      const patches = diffProc.exitCode === 0 ? parseDiffByFile(diffProc.stdout) : new Map<string, string>()

      return data.files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: patches.get(f.path) || "",
      }))
    },
    catch: (error) =>
      new GitError({
        operation: "pr files",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Get repo owner and name from gh CLI.
 */
export const getRepoInfo = (): Effect.Effect<{ owner: string; repo: string }, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["gh", "repo", "view", "--json", "owner,name"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || "Failed to get repo info")
      }

      const data = JSON.parse(stdout) as { owner: { login: string }; name: string }
      return { owner: data.owner.login, repo: data.name }
    },
    catch: (error) =>
      new GitError({
        operation: "repo view",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Get PR head SHA.
 */
export const getPRHeadSha = (prNumber: number): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(
        ["gh", "pr", "view", String(prNumber), "--json", "headRefOid", "--jq", ".headRefOid"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      await proc.exited

      if (proc.exitCode !== 0) {
        throw new Error(stderr || `Failed to get SHA for PR #${prNumber}`)
      }

      return stdout.trim()
    },
    catch: (error) =>
      new GitError({
        operation: "pr sha",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Read first N lines of a file from local checkout.
 * Returns empty string if file doesn't exist (e.g., deleted file).
 */
export const readFilePreview = (
  filePath: string,
  maxLines: number
): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: async () => {
      const file = Bun.file(filePath)
      if (!(await file.exists())) {
        return ""
      }

      const content = await file.text()
      const lines = content.split("\n").slice(0, maxLines)
      return lines.join("\n")
    },
    catch: (error) =>
      new GitError({
        operation: "read file",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
  })

/**
 * Truncate text to first N lines.
 */
const truncateLines = (text: string, maxLines: number): string => {
  const lines = text.split("\n").slice(0, maxLines)
  return lines.join("\n")
}

/**
 * Build FilePreview objects for all changed files.
 * Reads file content in parallel.
 */
export const buildFilePreviews = (
  files: readonly PRFile[],
  options: { contentLines?: number; diffLines?: number } = {}
): Effect.Effect<readonly FilePreview[], GitError> => {
  const contentLines = options.contentLines ?? 30
  const diffLines = options.diffLines ?? 100

  return Effect.all(
    files.map((file) =>
      Effect.gen(function* () {
        const contentPreview = yield* readFilePreview(file.path, contentLines)

        return {
          path: file.path,
          contentPreview,
          diffPreview: truncateLines(file.patch, diffLines),
          fullDiff: file.patch,
        }
      })
    ),
    { concurrency: 10 }
  )
}
