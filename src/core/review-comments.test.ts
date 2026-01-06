import { describe, expect, it } from "bun:test"
import { isDuplicateComment, type ExistingComment } from "./review-comments"

// Test fixtures
const createNewComment = (overrides: Partial<{ file: string; line?: number; comment: string }> = {}) => ({
  file: "src/index.ts",
  line: 10,
  comment: "Consider using a more descriptive variable name here",
  ...overrides,
})

const createExistingComment = (overrides: Partial<ExistingComment> = {}): ExistingComment => ({
  path: "src/index.ts",
  line: 10,
  body: "Consider using a more descriptive variable name here",
  ...overrides,
})

describe("review-comments", () => {
  describe("isDuplicateComment", () => {
    describe("file and line matching", () => {
      it("returns false when file differs", () => {
        const newComment = createNewComment({ file: "src/a.ts" })
        const existing = [createExistingComment({ path: "src/b.ts" })]
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })

      it("returns false when line differs", () => {
        const newComment = createNewComment({ line: 10 })
        const existing = [createExistingComment({ line: 20 })]
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })

      it("returns false for same file but no line on new comment", () => {
        const newComment = { file: "src/index.ts", comment: "No line comment" }
        const existing = [createExistingComment({ line: 10 })]
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })

      it("returns false for same file but no line on existing comment", () => {
        const newComment = createNewComment({ line: 10 })
        const existing = [createExistingComment({ line: null })]
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })
    })

    describe("keyword matching", () => {
      it("returns true when >50% keywords match", () => {
        const newComment = createNewComment({
          comment: "Consider using a more descriptive variable name here",
        })
        const existing = [
          createExistingComment({
            body: "Please use a more descriptive variable name for clarity",
          }),
        ]
        expect(isDuplicateComment(newComment, existing)).toBe(true)
      })

      it("returns false when <50% keywords match", () => {
        const newComment = createNewComment({
          comment: "Consider using async/await instead of callbacks",
        })
        const existing = [
          createExistingComment({
            body: "The function signature should be updated",
          }),
        ]
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })

      it("returns true for exact match", () => {
        const comment = "This is a critical security vulnerability"
        const newComment = createNewComment({ comment })
        const existing = [createExistingComment({ body: comment })]
        expect(isDuplicateComment(newComment, existing)).toBe(true)
      })

      it("is case insensitive", () => {
        const newComment = createNewComment({
          comment: "CONSIDER USING DESCRIPTIVE VARIABLE NAMES",
        })
        const existing = [
          createExistingComment({
            body: "consider using descriptive variable names",
          }),
        ]
        expect(isDuplicateComment(newComment, existing)).toBe(true)
      })

      it("ignores short words (<=5 chars)", () => {
        // Only considers words > 5 chars as keywords
        const newComment = createNewComment({
          comment: "Add the new API to the app",
        })
        const existing = [
          createExistingComment({
            body: "Use the old API in the lib",
          }),
        ]
        // "Add", "the", "new", "API", "to", "the", "app" are all <=5 chars
        // So no keywords to match - should not be duplicate
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })
    })

    describe("multiple existing comments", () => {
      it("returns true if any existing comment matches", () => {
        const newComment = createNewComment({
          file: "src/index.ts",
          line: 10,
          comment: "Consider using descriptive variable names throughout",
        })
        const existing = [
          createExistingComment({
            path: "src/other.ts",
            line: 5,
            body: "Unrelated comment",
          }),
          createExistingComment({
            path: "src/index.ts",
            line: 10,
            body: "Consider using descriptive variable names for clarity",
          }),
        ]
        expect(isDuplicateComment(newComment, existing)).toBe(true)
      })

      it("returns false if no existing comments match", () => {
        const newComment = createNewComment({
          file: "src/new.ts",
          line: 100,
          comment: "Completely unique comment",
        })
        const existing = [
          createExistingComment({ path: "a.ts", line: 1, body: "Comment A" }),
          createExistingComment({ path: "b.ts", line: 2, body: "Comment B" }),
        ]
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })
    })

    describe("edge cases", () => {
      it("returns false for empty existing comments", () => {
        const newComment = createNewComment()
        expect(isDuplicateComment(newComment, [])).toBe(false)
      })

      it("handles empty comment text", () => {
        const newComment = createNewComment({ comment: "" })
        const existing = [createExistingComment({ body: "" })]
        // Empty comment has no keywords, so should not match
        expect(isDuplicateComment(newComment, existing)).toBe(false)
      })

      it("handles special characters in comments", () => {
        // Special chars are part of the word token, so "async/await" != "`async/await`"
        const newComment = createNewComment({
          comment: "Consider refactoring to use async/await patterns",
        })
        const existing = [
          createExistingComment({
            body: "Refactoring to async/await patterns would improve readability",
          }),
        ]
        expect(isDuplicateComment(newComment, existing)).toBe(true)
      })
    })
  })
})
