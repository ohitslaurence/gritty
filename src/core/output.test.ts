import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { makeOutput, reportError } from "./output"

describe("output", () => {
  it("emit is a no-op outside json mode", async () => {
    const output = makeOutput(false)
    const logs: string[] = []
    const original = console.log
    console.log = (msg: string) => logs.push(msg)
    try {
      await Effect.runPromise(output.emit({ command: "x" }))
    } finally {
      console.log = original
    }
    expect(logs).toEqual([])
  })

  it("emit prints ok:true JSON in json mode", async () => {
    const output = makeOutput(true)
    const logs: string[] = []
    const original = console.log
    console.log = (msg: string) => logs.push(msg)
    try {
      await Effect.runPromise(output.emit({ command: "x", n: 1 }))
    } finally {
      console.log = original
    }
    expect(JSON.parse(logs[0] ?? "")).toEqual({ ok: true, command: "x", n: 1 })
  })

  it("reportError sets exit code and emits JSON error", async () => {
    const before = process.exitCode
    const logs: string[] = []
    const original = console.log
    console.log = (msg: string) => logs.push(msg)
    try {
      await Effect.runPromise(
        reportError(makeOutput(true), { _tag: "GitError", message: "boom" })
      )
    } finally {
      console.log = original
    }
    expect(process.exitCode).toBe(1)
    process.exitCode = before ?? 0
    expect(JSON.parse(logs[0] ?? "")).toEqual({
      ok: false,
      error: { _tag: "GitError", message: "boom" },
    })
  })
})
