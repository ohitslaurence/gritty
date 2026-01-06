import { describe, expect, it } from "bun:test"
import { parsePRNumber } from "./pr-utils"

describe("pr-utils", () => {
  describe("parsePRNumber", () => {
    describe("direct number input", () => {
      it("parses simple number string", () => {
        expect(parsePRNumber("123")).toBe(123)
      })

      it("parses single digit", () => {
        expect(parsePRNumber("1")).toBe(1)
      })

      it("parses large numbers", () => {
        expect(parsePRNumber("99999")).toBe(99999)
      })

      it("returns null for zero", () => {
        expect(parsePRNumber("0")).toBeNull()
      })

      it("returns null for negative numbers", () => {
        expect(parsePRNumber("-1")).toBeNull()
        expect(parsePRNumber("-123")).toBeNull()
      })

      it("returns null for non-numeric strings", () => {
        expect(parsePRNumber("abc")).toBeNull()
        expect(parsePRNumber("")).toBeNull()
      })

      it("returns null for mixed alphanumeric", () => {
        expect(parsePRNumber("123abc")).toBe(123) // parseInt behavior
        expect(parsePRNumber("abc123")).toBeNull()
      })
    })

    describe("GitHub URL input", () => {
      it("parses standard PR URL", () => {
        expect(parsePRNumber("https://github.com/owner/repo/pull/456")).toBe(456)
      })

      it("parses PR URL with trailing slash", () => {
        expect(parsePRNumber("https://github.com/owner/repo/pull/789/")).toBe(789)
      })

      it("parses PR URL with additional path segments", () => {
        expect(parsePRNumber("https://github.com/owner/repo/pull/42/files")).toBe(42)
        expect(parsePRNumber("https://github.com/owner/repo/pull/42/commits")).toBe(42)
      })

      it("parses PR URL with query parameters", () => {
        expect(parsePRNumber("https://github.com/owner/repo/pull/123?diff=split")).toBe(123)
      })

      it("parses URL with complex owner/repo names", () => {
        expect(parsePRNumber("https://github.com/my-org/my-repo-name/pull/55")).toBe(55)
        expect(parsePRNumber("https://github.com/org123/repo_name/pull/100")).toBe(100)
      })

      it("parses enterprise GitHub URLs", () => {
        expect(parsePRNumber("https://github.company.com/org/repo/pull/200")).toBe(200)
      })

      it("returns null for non-PR GitHub URLs", () => {
        expect(parsePRNumber("https://github.com/owner/repo")).toBeNull()
        expect(parsePRNumber("https://github.com/owner/repo/issues/123")).toBeNull()
        expect(parsePRNumber("https://github.com/owner/repo/commit/abc123")).toBeNull()
      })
    })

    describe("edge cases", () => {
      it("handles whitespace around number", () => {
        // parseInt handles leading whitespace
        expect(parsePRNumber(" 123")).toBe(123)
        expect(parsePRNumber("123 ")).toBe(123)
      })

      it("handles decimal numbers", () => {
        // parseInt stops at decimal point
        expect(parsePRNumber("123.456")).toBe(123)
      })

      it("prefers URL parsing over direct number for URLs", () => {
        // URL with /pull/ should extract the PR number
        expect(parsePRNumber("https://github.com/o/r/pull/999")).toBe(999)
      })

      it("handles partial URL-like strings", () => {
        // Has /pull/ but not a full URL
        expect(parsePRNumber("/pull/42")).toBe(42)
        expect(parsePRNumber("repo/pull/42")).toBe(42)
      })
    })
  })
})
