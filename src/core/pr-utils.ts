import { Effect } from "effect"
import { GitError } from "../types/errors"

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
