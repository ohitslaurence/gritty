/**
 * Utilities for splitting large changesets into logical commits.
 */

/**
 * Maximum diff size in characters before suggesting split.
 * ~100KB is roughly the safe limit for Claude API.
 */
export const MAX_DIFF_SIZE = 100_000

/**
 * A group of related files for a single commit.
 */
export interface FileGroup {
  readonly name: string
  readonly files: readonly string[]
}

/**
 * Check if a diff is too large to process.
 */
export const isDiffTooLarge = (diff: string): boolean => {
  return diff.length > MAX_DIFF_SIZE
}

/**
 * Get the grouping key for a file (directory-based).
 */
const getGroupKey = (file: string): string => {
  const parts = file.split("/")

  // Handle root-level files
  if (parts.length === 1) {
    return "(root)"
  }

  // Group by first two directory levels for src/
  if (parts[0] === "src" && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`
  }

  // Group by first directory for others
  return parts[0] ?? "(root)"
}

/**
 * Group files by their directory structure.
 */
export const groupFilesByDirectory = (files: readonly string[]): readonly FileGroup[] => {
  const groups = new Map<string, string[]>()

  for (const file of files) {
    const key = getGroupKey(file)
    const existing = groups.get(key) ?? []
    groups.set(key, [...existing, file])
  }

  // Sort groups by name and convert to array
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, groupFiles]) => ({
      name,
      files: groupFiles.sort(),
    }))
}

/**
 * Threshold for auto-splitting (number of files).
 */
const AUTO_SPLIT_FILE_THRESHOLD = 15

/**
 * Determine if we should automatically split the changeset.
 * Split when we have many files across multiple directories.
 */
export const shouldAutoSplit = (files: readonly string[]): boolean => {
  if (files.length < AUTO_SPLIT_FILE_THRESHOLD) {
    return false
  }

  const groups = groupFilesByDirectory(files)
  // Only split if we have multiple meaningful groups
  return groups.length > 1
}

/**
 * Format groups for display.
 */
export const formatGroups = (groups: readonly FileGroup[]): string => {
  return groups
    .map((g, i) => {
      const fileList = g.files.slice(0, 5).join("\n    ")
      const more = g.files.length > 5 ? `\n    ... and ${g.files.length - 5} more` : ""
      return `${i + 1}. ${g.name} (${g.files.length} files)\n    ${fileList}${more}`
    })
    .join("\n\n")
}
