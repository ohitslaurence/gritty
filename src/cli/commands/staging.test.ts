import { describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import { TestGitService } from "../../services/git/test"
import { GitService } from "../../services/git/service"
import { makeOutput } from "../../core/output"
import { prepareIndex } from "./commit"
import { withFooter } from "./pr"

const silent = { ...makeOutput(false), log: () => Effect.void }

const run = (
  staged: readonly string[],
  flags: { all: boolean; stagedOnly: boolean }
) => {
  let stagedAll = false
  const layer = TestGitService.make({
    getStatus: () => Effect.succeed({ staged, unstaged: ["b.ts"], untracked: [] }),
    stageAll: () => {
      stagedAll = true
      return Effect.void
    },
  })
  return Effect.gen(function* () {
    const git = yield* GitService
    yield* prepareIndex(git, silent, flags)
  }).pipe(
    Effect.provide(layer),
    Effect.runPromiseExit
  ).then((exit) => ({ exit, stagedAll }))
}

describe("commit staging", () => {
  it("respects an existing index", async () => {
    const { exit, stagedAll } = await run(["a.ts"], { all: false, stagedOnly: false })
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(stagedAll).toBe(false)
  })

  it("stages everything when the index is empty", async () => {
    const { exit, stagedAll } = await run([], { all: false, stagedOnly: false })
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(stagedAll).toBe(true)
  })

  it("--all overrides an existing index", async () => {
    const { stagedAll } = await run(["a.ts"], { all: true, stagedOnly: false })
    expect(stagedAll).toBe(true)
  })

  it("--staged-only fails on an empty index", async () => {
    const { exit, stagedAll } = await run([], { all: false, stagedOnly: true })
    expect(Exit.isFailure(exit)).toBe(true)
    expect(stagedAll).toBe(false)
  })
})

describe("pr footer", () => {
  it("returns body unchanged with no footer lines", () => {
    expect(withFooter("body", ["", "  "])).toBe("body")
  })

  it("appends footer after a blank line", () => {
    expect(withFooter("body\n", ["a", "b"])).toBe("body\n\na\nb")
  })
})
