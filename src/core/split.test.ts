import { describe, expect, it } from "bun:test"
import {
  MAX_DIFF_SIZE,
  isDiffTooLarge,
  groupFilesByDirectory,
  shouldAutoSplit,
  formatGroups,
} from "./split"

describe("split utilities", () => {
  describe("isDiffTooLarge", () => {
    it("returns false for small diffs", () => {
      expect(isDiffTooLarge("small diff")).toBe(false)
    })

    it("returns false for diffs at the limit", () => {
      const atLimit = "x".repeat(MAX_DIFF_SIZE)
      expect(isDiffTooLarge(atLimit)).toBe(false)
    })

    it("returns true for diffs over the limit", () => {
      const overLimit = "x".repeat(MAX_DIFF_SIZE + 1)
      expect(isDiffTooLarge(overLimit)).toBe(true)
    })
  })

  describe("groupFilesByDirectory", () => {
    it("groups root files together", () => {
      const files = ["README.md", "package.json", ".gitignore"]
      const groups = groupFilesByDirectory(files)

      expect(groups).toHaveLength(1)
      expect(groups[0]?.name).toBe("(root)")
      expect(groups[0]?.files).toEqual([".gitignore", "README.md", "package.json"])
    })

    it("groups src files by second level directory", () => {
      const files = [
        "src/services/git/live.ts",
        "src/services/git/service.ts",
        "src/services/ai/live.ts",
        "src/cli/commands/commit.ts",
      ]
      const groups = groupFilesByDirectory(files)

      // src/services groups git and ai together (same second-level dir)
      expect(groups).toHaveLength(2)
      expect(groups.map((g) => g.name)).toEqual(["src/cli", "src/services"])
      expect(groups[1]?.files).toHaveLength(3)
    })

    it("groups non-src files by first directory", () => {
      const files = ["tests/unit/foo.test.ts", "tests/integration/bar.test.ts", "docs/readme.md"]
      const groups = groupFilesByDirectory(files)

      expect(groups).toHaveLength(2)
      expect(groups.map((g) => g.name).sort()).toEqual(["docs", "tests"])
    })

    it("handles mixed files correctly", () => {
      const files = [
        "README.md",
        "src/index.ts",
        "src/cli/app.ts",
        "tests/foo.test.ts",
      ]
      const groups = groupFilesByDirectory(files)

      expect(groups.map((g) => g.name).sort()).toEqual(["(root)", "src", "src/cli", "tests"])
    })

    it("sorts files within groups", () => {
      const files = ["src/cli/z.ts", "src/cli/a.ts", "src/cli/m.ts"]
      const groups = groupFilesByDirectory(files)

      expect(groups[0]?.files).toEqual(["src/cli/a.ts", "src/cli/m.ts", "src/cli/z.ts"])
    })
  })

  describe("shouldAutoSplit", () => {
    it("returns false for few files", () => {
      const files = ["src/index.ts", "src/cli/app.ts", "README.md"]
      expect(shouldAutoSplit(files)).toBe(false)
    })

    it("returns false for many files in one group", () => {
      const files = Array.from({ length: 20 }, (_, i) => `src/cli/file${i}.ts`)
      expect(shouldAutoSplit(files)).toBe(false)
    })

    it("returns true for many files across multiple groups", () => {
      const files = [
        ...Array.from({ length: 10 }, (_, i) => `src/cli/file${i}.ts`),
        ...Array.from({ length: 10 }, (_, i) => `src/services/file${i}.ts`),
      ]
      expect(shouldAutoSplit(files)).toBe(true)
    })
  })

  describe("formatGroups", () => {
    it("formats groups with file counts", () => {
      const groups = [
        { name: "src/cli", files: ["src/cli/a.ts", "src/cli/b.ts"] },
        { name: "src/services", files: ["src/services/c.ts"] },
      ]
      const formatted = formatGroups(groups)

      expect(formatted).toContain("1. src/cli (2 files)")
      expect(formatted).toContain("2. src/services (1 files)")
    })

    it("truncates long file lists", () => {
      const groups = [
        {
          name: "big",
          files: Array.from({ length: 10 }, (_, i) => `file${i}.ts`),
        },
      ]
      const formatted = formatGroups(groups)

      expect(formatted).toContain("... and 5 more")
    })
  })
})
