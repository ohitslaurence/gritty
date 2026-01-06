import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { CommitMessage, DiffContent } from "../../types/branded"
import { TestAIService } from "../../services/ai/test"
import { TestConfigService } from "../../services/config/test"
import { TestGitService } from "../../services/git/test"
import type { ProposedCommit } from "../../services/ai/service"

/**
 * Helper to create a test layer combining Git, AI, and Config services.
 */
const makeTestLayer = (opts: {
  files?: string[]
  fileDiffs?: Record<string, string>
  isGitRepo?: boolean
  proposedCommits?: readonly ProposedCommit[]
  defaultSpeed?: "fast" | "medium" | "slow"
}) => {
  const gitLayer = TestGitService.make({
    isGitRepo: () => Effect.succeed(opts.isGitRepo ?? true),
    getStatus: () =>
      Effect.succeed({
        staged: opts.files ?? [],
        unstaged: [],
        untracked: [],
      }),
    getFileDiff: (file) =>
      Effect.succeed(opts.fileDiffs?.[file] ?? `diff for ${file}`),
    getDiffForFiles: () => Effect.succeed(DiffContent("combined diff")),
    stageFiles: () => Effect.void,
    unstageAll: () => Effect.void,
    getRecentCommits: () => Effect.succeed([]),
  })

  const aiLayer = TestAIService.make({
    composeCommits: () =>
      Effect.succeed(
        opts.proposedCommits ?? [
          { title: "feat: default commit", files: opts.files ?? [], reason: "test" },
        ]
      ),
    generateCommitMessage: () => Effect.succeed(CommitMessage("test commit message")),
  })

  const configLayer = TestConfigService.withDefaultSpeed(opts.defaultSpeed ?? "medium")

  return Layer.mergeAll(gitLayer, aiLayer, configLayer)
}

describe("compose command logic", () => {
  describe("formatProposedCommits", () => {
    it("formats commits with title, files, and reason", () => {
      const formatProposedCommits = (commits: readonly ProposedCommit[]): string => {
        const separator = "─".repeat(60)
        const lines = [`\n${separator}`, "Proposed commits:", separator, ""]

        commits.forEach((commit, i) => {
          lines.push(`${i + 1}. ${commit.title}`)
          lines.push(`   Files: ${commit.files.join(", ")}`)
          lines.push(`   Reason: ${commit.reason}`)
          lines.push("")
        })

        lines.push(separator)
        return lines.join("\n")
      }

      const commits: ProposedCommit[] = [
        { title: "feat: add auth", files: ["src/auth.ts"], reason: "New feature" },
        { title: "fix: resolve bug", files: ["src/fix.ts"], reason: "Bug fix" },
      ]

      const result = formatProposedCommits(commits)

      expect(result).toContain("Proposed commits:")
      expect(result).toContain("1. feat: add auth")
      expect(result).toContain("Files: src/auth.ts")
      expect(result).toContain("2. fix: resolve bug")
    })
  })
})

describe("compose workflow integration", () => {
  it("gets file status and diffs", async () => {
    const layer = makeTestLayer({
      files: ["src/a.ts", "src/b.ts"],
      fileDiffs: {
        "src/a.ts": "diff for a",
        "src/b.ts": "diff for b",
      },
    })

    const { GitService } = await import("../../services/git/service")

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      const status = yield* git.getStatus()
      const diffs = []
      for (const file of status.staged) {
        const diff = yield* git.getFileDiff(file)
        diffs.push({ file, diff })
      }
      return diffs
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ file: "src/a.ts", diff: "diff for a" })
    expect(result[1]).toEqual({ file: "src/b.ts", diff: "diff for b" })
  })

  it("proposes commits from AI", async () => {
    const proposedCommits: ProposedCommit[] = [
      { title: "feat: add feature", files: ["src/feature.ts"], reason: "New feature" },
      { title: "test: add tests", files: ["src/feature.test.ts"], reason: "Tests" },
    ]

    const layer = makeTestLayer({
      files: ["src/feature.ts", "src/feature.test.ts"],
      proposedCommits,
    })

    const { AIService } = await import("../../services/ai/service")

    const result = await Effect.gen(function* () {
      const ai = yield* AIService
      return yield* ai.composeCommits(
        [
          { path: "src/feature.ts", diff: "diff" },
          { path: "src/feature.test.ts", diff: "diff" },
        ],
        { speed: "medium" }
      )
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toHaveLength(2)
    expect(result[0]?.title).toBe("feat: add feature")
    expect(result[1]?.title).toBe("test: add tests")
  })

  it("respects config default speed", async () => {
    const layer = makeTestLayer({
      files: ["src/a.ts"],
      defaultSpeed: "fast",
    })

    const { ConfigService } = await import("../../services/config/service")

    const result = await Effect.gen(function* () {
      const config = yield* ConfigService
      return yield* config.getDefaultSpeed()
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toBe("fast")
  })

  it("handles empty file list", async () => {
    const layer = makeTestLayer({
      files: [],
    })

    const { GitService } = await import("../../services/git/service")

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      const status = yield* git.getStatus()
      return status.staged.length + status.unstaged.length + status.untracked.length
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toBe(0)
  })

  it("handles not a git repo", async () => {
    const layer = makeTestLayer({
      isGitRepo: false,
    })

    const { GitService } = await import("../../services/git/service")

    const result = await Effect.gen(function* () {
      const git = yield* GitService
      return yield* git.isGitRepo()
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toBe(false)
  })
})
