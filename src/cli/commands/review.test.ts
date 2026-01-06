import { describe, expect, it } from "bun:test"
import type { PRFile } from "../../core/pr-utils"
import { globToRegex, isExcluded, filterExcludedFiles } from "./review"

// Test fixtures
const createPRFile = (overrides: Partial<PRFile> = {}): PRFile => ({
  path: "src/index.ts",
  additions: 10,
  deletions: 5,
  patch: "@@ -1,5 +1,10 @@\n test",
  ...overrides,
})

describe("review utilities", () => {
  describe("globToRegex", () => {
    describe("basic patterns", () => {
      it("matches exact file names", () => {
        const regex = globToRegex("package.json")
        expect(regex.test("package.json")).toBe(true)
        expect(regex.test("other.json")).toBe(false)
        expect(regex.test("src/package.json")).toBe(false)
      })

      it("matches files with extension", () => {
        const regex = globToRegex("*.ts")
        expect(regex.test("index.ts")).toBe(true)
        expect(regex.test("test.ts")).toBe(true)
        expect(regex.test("index.js")).toBe(false)
        expect(regex.test("src/index.ts")).toBe(false) // * doesn't match /
      })

      it("matches single character with ?", () => {
        const regex = globToRegex("file?.ts")
        expect(regex.test("file1.ts")).toBe(true)
        expect(regex.test("fileA.ts")).toBe(true)
        expect(regex.test("file.ts")).toBe(false)
        expect(regex.test("file12.ts")).toBe(false)
      })
    })

    describe("** globstar patterns", () => {
      it("matches any path depth with **", () => {
        const regex = globToRegex("**/test.ts")
        expect(regex.test("test.ts")).toBe(true)
        expect(regex.test("src/test.ts")).toBe(true)
        expect(regex.test("src/deep/nested/test.ts")).toBe(true)
        expect(regex.test("test.js")).toBe(false)
      })

      it("matches directory patterns", () => {
        const regex = globToRegex("**/generated/**")
        expect(regex.test("generated/file.ts")).toBe(true)
        expect(regex.test("src/generated/file.ts")).toBe(true)
        expect(regex.test("src/generated/deep/file.ts")).toBe(true)
        expect(regex.test("src/generator/file.ts")).toBe(false)
      })

      it("matches file extension patterns", () => {
        const regex = globToRegex("**/*.test.ts")
        expect(regex.test("index.test.ts")).toBe(true)
        expect(regex.test("src/index.test.ts")).toBe(true)
        expect(regex.test("src/deep/index.test.ts")).toBe(true)
        expect(regex.test("src/index.ts")).toBe(false)
        expect(regex.test("test.ts")).toBe(false)
      })

      it("matches generated file patterns", () => {
        const regex = globToRegex("**/*.generated.*")
        expect(regex.test("types.generated.ts")).toBe(true)
        expect(regex.test("src/api.generated.d.ts")).toBe(true)
        expect(regex.test("src/schema.generated.json")).toBe(true)
        expect(regex.test("src/index.ts")).toBe(false)
      })
    })

    describe("special character escaping", () => {
      it("escapes regex special characters", () => {
        const regex = globToRegex("file[1].ts")
        expect(regex.test("file[1].ts")).toBe(true)
        expect(regex.test("file1.ts")).toBe(false)
      })

      it("escapes dots properly", () => {
        const regex = globToRegex("package.json")
        expect(regex.test("packageXjson")).toBe(false) // dot should not match any char
        expect(regex.test("package.json")).toBe(true)
      })

      it("handles multiple special chars", () => {
        const regex = globToRegex("file+name(1).ts")
        expect(regex.test("file+name(1).ts")).toBe(true)
        expect(regex.test("filename1.ts")).toBe(false)
      })
    })

    describe("combined patterns", () => {
      it("matches src directory test files", () => {
        const regex = globToRegex("src/**/*.test.ts")
        expect(regex.test("src/index.test.ts")).toBe(true)
        expect(regex.test("src/core/utils.test.ts")).toBe(true)
        expect(regex.test("tests/index.test.ts")).toBe(false)
        expect(regex.test("src/index.ts")).toBe(false)
      })

      it("matches codegen directories", () => {
        const regex = globToRegex("**/codegen/**")
        expect(regex.test("codegen/types.ts")).toBe(true)
        expect(regex.test("src/codegen/schema.ts")).toBe(true)
        expect(regex.test("api/codegen/v1/types.ts")).toBe(true)
        expect(regex.test("src/codec/types.ts")).toBe(false)
      })

      it("matches __generated__ directories", () => {
        const regex = globToRegex("**/__generated__/**")
        expect(regex.test("__generated__/types.ts")).toBe(true)
        expect(regex.test("src/__generated__/graphql.ts")).toBe(true)
        expect(regex.test("src/generated/file.ts")).toBe(false)
      })
    })

    describe("edge cases", () => {
      it("handles empty pattern", () => {
        const regex = globToRegex("")
        expect(regex.test("")).toBe(true)
        expect(regex.test("anything")).toBe(false)
      })

      it("handles pattern with only **", () => {
        const regex = globToRegex("**")
        expect(regex.test("")).toBe(true)
        expect(regex.test("anything")).toBe(true)
        expect(regex.test("deeply/nested/path")).toBe(true)
      })

      it("handles pattern with only *", () => {
        const regex = globToRegex("*")
        expect(regex.test("file")).toBe(true)
        expect(regex.test("file.ts")).toBe(true)
        expect(regex.test("path/file")).toBe(false)
      })
    })
  })

  describe("isExcluded", () => {
    describe("single pattern matching", () => {
      it("excludes matching file", () => {
        expect(isExcluded("src/types.generated.ts", ["**/*.generated.*"])).toBe(true)
      })

      it("does not exclude non-matching file", () => {
        expect(isExcluded("src/index.ts", ["**/*.generated.*"])).toBe(false)
      })
    })

    describe("multiple pattern matching", () => {
      it("excludes if any pattern matches", () => {
        const patterns = ["**/*.test.ts", "**/*.generated.*", "**/generated/**"]
        expect(isExcluded("src/index.test.ts", patterns)).toBe(true)
        expect(isExcluded("src/types.generated.ts", patterns)).toBe(true)
        expect(isExcluded("generated/schema.ts", patterns)).toBe(true)
      })

      it("does not exclude if no patterns match", () => {
        const patterns = ["**/*.test.ts", "**/*.generated.*"]
        expect(isExcluded("src/index.ts", patterns)).toBe(false)
        expect(isExcluded("src/utils.ts", patterns)).toBe(false)
      })
    })

    describe("default exclusion patterns", () => {
      const defaultPatterns = [
        "**/generated/**",
        "**/*.generated.*",
        "**/*.gen.*",
        "**/codegen/**",
        "**/__generated__/**",
      ]

      it("excludes generated directories", () => {
        expect(isExcluded("src/generated/types.ts", defaultPatterns)).toBe(true)
        expect(isExcluded("api/generated/schema.ts", defaultPatterns)).toBe(true)
      })

      it("excludes .generated. files", () => {
        expect(isExcluded("types.generated.ts", defaultPatterns)).toBe(true)
        expect(isExcluded("src/api.generated.d.ts", defaultPatterns)).toBe(true)
      })

      it("excludes .gen. files", () => {
        expect(isExcluded("types.gen.ts", defaultPatterns)).toBe(true)
        expect(isExcluded("src/schema.gen.json", defaultPatterns)).toBe(true)
      })

      it("excludes codegen directories", () => {
        expect(isExcluded("codegen/output.ts", defaultPatterns)).toBe(true)
        expect(isExcluded("src/codegen/types.ts", defaultPatterns)).toBe(true)
      })

      it("excludes __generated__ directories", () => {
        expect(isExcluded("__generated__/graphql.ts", defaultPatterns)).toBe(true)
        expect(isExcluded("src/__generated__/queries.ts", defaultPatterns)).toBe(true)
      })

      it("does not exclude regular source files", () => {
        expect(isExcluded("src/index.ts", defaultPatterns)).toBe(false)
        expect(isExcluded("src/utils/helpers.ts", defaultPatterns)).toBe(false)
        expect(isExcluded("lib/generator.ts", defaultPatterns)).toBe(false)
      })
    })

    describe("edge cases", () => {
      it("returns false for empty patterns array", () => {
        expect(isExcluded("any/file.ts", [])).toBe(false)
      })

      it("handles file paths with special characters", () => {
        const patterns = ["**/*.test.ts"]
        expect(isExcluded("src/file[1].test.ts", patterns)).toBe(true)
      })
    })
  })

  describe("filterExcludedFiles", () => {
    describe("basic filtering", () => {
      it("removes excluded files", () => {
        const files = [
          createPRFile({ path: "src/index.ts" }),
          createPRFile({ path: "src/types.generated.ts" }),
          createPRFile({ path: "src/utils.ts" }),
        ]
        const result = filterExcludedFiles(files, ["**/*.generated.*"])

        expect(result.length).toBe(2)
        expect(result.map((f) => f.path)).toEqual(["src/index.ts", "src/utils.ts"])
      })

      it("keeps all files when none match patterns", () => {
        const files = [
          createPRFile({ path: "src/index.ts" }),
          createPRFile({ path: "src/utils.ts" }),
        ]
        const result = filterExcludedFiles(files, ["**/*.generated.*"])

        expect(result.length).toBe(2)
      })

      it("removes all files when all match patterns", () => {
        const files = [
          createPRFile({ path: "src/a.generated.ts" }),
          createPRFile({ path: "src/b.generated.ts" }),
        ]
        const result = filterExcludedFiles(files, ["**/*.generated.*"])

        expect(result.length).toBe(0)
      })
    })

    describe("multiple pattern filtering", () => {
      it("applies all patterns", () => {
        const files = [
          createPRFile({ path: "src/index.ts" }),
          createPRFile({ path: "src/index.test.ts" }),
          createPRFile({ path: "src/types.generated.ts" }),
          createPRFile({ path: "generated/schema.ts" }),
        ]
        const patterns = ["**/*.test.ts", "**/*.generated.*", "**/generated/**"]
        const result = filterExcludedFiles(files, patterns)

        expect(result.length).toBe(1)
        expect(result[0]?.path).toBe("src/index.ts")
      })
    })

    describe("with default exclusions", () => {
      const defaultPatterns = [
        "**/generated/**",
        "**/*.generated.*",
        "**/*.gen.*",
        "**/codegen/**",
        "**/__generated__/**",
      ]

      it("filters typical PR file set", () => {
        const files = [
          createPRFile({ path: "src/index.ts" }),
          createPRFile({ path: "src/components/Button.tsx" }),
          createPRFile({ path: "src/generated/api.ts" }),
          createPRFile({ path: "src/types.generated.ts" }),
          createPRFile({ path: "codegen/output.ts" }),
          createPRFile({ path: "src/__generated__/graphql.ts" }),
        ]
        const result = filterExcludedFiles(files, defaultPatterns)

        expect(result.length).toBe(2)
        expect(result.map((f) => f.path)).toEqual([
          "src/index.ts",
          "src/components/Button.tsx",
        ])
      })
    })

    describe("edge cases", () => {
      it("handles empty file array", () => {
        const result = filterExcludedFiles([], ["**/*.test.ts"])
        expect(result).toEqual([])
      })

      it("handles empty patterns array", () => {
        const files = [createPRFile({ path: "src/index.ts" })]
        const result = filterExcludedFiles(files, [])
        expect(result.length).toBe(1)
      })

      it("preserves file properties", () => {
        const files = [
          createPRFile({
            path: "src/index.ts",
            additions: 100,
            deletions: 50,
            patch: "custom patch",
          }),
        ]
        const result = filterExcludedFiles(files, ["**/*.test.ts"])

        expect(result[0]).toEqual({
          path: "src/index.ts",
          additions: 100,
          deletions: 50,
          patch: "custom patch",
        })
      })
    })
  })
})
