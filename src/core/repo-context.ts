import { Effect } from "effect"

/**
 * Files to check for guidelines, in priority order.
 */
const GUIDELINE_FILES = [
  "CLAUDE.md",
  "claude.md",
  ".claude/CLAUDE.md",
  "agents.md",
  "AGENTS.md",
  ".github/AGENTS.md",
] as const

/**
 * Files to check for README, in priority order.
 */
const README_FILES = ["README.md", "readme.md"] as const

/**
 * Repository context gathered from documentation files.
 */
export interface RepoContext {
  /** Combined guidelines from CLAUDE.md/agents.md */
  readonly guidelines: string | null
  /** README content for project understanding */
  readonly readme: string | null
}

/**
 * Try to read a file, returning null if it doesn't exist.
 */
const tryReadFile = (path: string): Effect.Effect<string | null, never> =>
  Effect.promise(async () => {
    try {
      const file = Bun.file(path)
      if (await file.exists()) {
        return await file.text()
      }
    } catch {
      // File doesn't exist or can't be read
    }
    return null
  })

/**
 * Truncate content to a max length, preserving complete lines.
 */
const truncateContent = (content: string, maxLength: number): string => {
  if (content.length <= maxLength) return content

  const truncated = content.slice(0, maxLength)
  const lastNewline = truncated.lastIndexOf("\n")
  const result = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated

  return `${result}\n\n--- Content truncated for context limit ---`
}

/**
 * Read multiple files in parallel and return the first one that exists (by priority order).
 */
const findFirstFile = (
  cwd: string,
  files: readonly string[],
  maxLength: number
): Effect.Effect<string | null, never> =>
  Effect.gen(function* () {
    // Read all files in parallel
    const results = yield* Effect.all(
      files.map((file) => tryReadFile(`${cwd}/${file}`)),
      { concurrency: "unbounded" }
    )

    // Return first match (maintains priority order since we map in order)
    for (const content of results) {
      if (content) {
        return truncateContent(content, maxLength)
      }
    }

    return null
  })

/**
 * Fetch repository context files for review.
 * Reads files in parallel for performance, returns first match by priority.
 */
export const getRepoContext = (): Effect.Effect<RepoContext, never> =>
  Effect.gen(function* () {
    const cwd = process.cwd()

    // Read guidelines and readme in parallel
    const [guidelines, readme] = yield* Effect.all(
      [
        findFirstFile(cwd, GUIDELINE_FILES, 8000),
        findFirstFile(cwd, README_FILES, 4000),
      ],
      { concurrency: 2 }
    )

    return { guidelines, readme }
  })
