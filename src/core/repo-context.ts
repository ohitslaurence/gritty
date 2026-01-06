import { Effect } from "effect"

/**
 * Files to check for repo context, in priority order.
 */
const CONTEXT_FILES = [
  "CLAUDE.md",
  "claude.md",
  ".claude/CLAUDE.md",
  "agents.md",
  "AGENTS.md",
  ".github/AGENTS.md",
  "README.md",
  "readme.md",
] as const

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
const tryReadFile = async (path: string): Promise<string | null> => {
  try {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null
}

/**
 * Truncate content to a max length, preserving complete lines.
 */
const truncateContent = (content: string, maxLength: number): string => {
  if (content.length <= maxLength) return content

  const truncated = content.slice(0, maxLength)
  const lastNewline = truncated.lastIndexOf("\n")
  return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) + "\n[...truncated]"
}

/**
 * Fetch repository context files for review.
 * Looks for CLAUDE.md, agents.md, and README.md in common locations.
 */
export const getRepoContext = (): Effect.Effect<RepoContext, never> =>
  Effect.promise(async () => {
    const cwd = process.cwd()

    // Find guidelines (CLAUDE.md or agents.md) - stop at first match
    let guidelines: string | null = null
    for (const file of CONTEXT_FILES) {
      if (file.toLowerCase().includes("readme")) continue // Handle README separately
      // oxlint-disable-next-line no-await-in-loop
      const content = await tryReadFile(`${cwd}/${file}`)
      if (content) {
        guidelines = truncateContent(content, 8000)
        break
      }
    }

    // Find README - stop at first match
    let readme: string | null = null
    for (const file of CONTEXT_FILES) {
      if (!file.toLowerCase().includes("readme")) continue
      // oxlint-disable-next-line no-await-in-loop
      const content = await tryReadFile(`${cwd}/${file}`)
      if (content) {
        readme = truncateContent(content, 4000)
        break
      }
    }

    return { guidelines, readme }
  })
