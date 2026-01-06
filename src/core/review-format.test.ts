import { describe, expect, it } from "bun:test"
import type { PRReview } from "../services/ai/service"
import { formatSeverity, formatVerdict, formatReview } from "./review-format"

describe("review-format", () => {
  describe("formatSeverity", () => {
    it("formats critical severity", () => {
      expect(formatSeverity("critical")).toBe("🚨 CRITICAL")
    })

    it("formats suggestion severity", () => {
      expect(formatSeverity("suggestion")).toBe("💡 Suggestion")
    })

    it("formats nitpick severity", () => {
      expect(formatSeverity("nitpick")).toBe("📝 Nitpick")
    })

    it("formats praise severity", () => {
      expect(formatSeverity("praise")).toBe("✨ Praise")
    })

    it("returns unknown severity as-is", () => {
      expect(formatSeverity("unknown")).toBe("unknown")
      expect(formatSeverity("warning")).toBe("warning")
    })
  })

  describe("formatVerdict", () => {
    it("formats approve verdict", () => {
      expect(formatVerdict("approve")).toBe("✅ APPROVE")
    })

    it("formats request_changes verdict", () => {
      expect(formatVerdict("request_changes")).toBe("🔴 REQUEST CHANGES")
    })

    it("formats comment verdict", () => {
      expect(formatVerdict("comment")).toBe("💬 COMMENT")
    })

    it("returns unknown verdict as-is", () => {
      expect(formatVerdict("unknown")).toBe("unknown")
    })
  })

  describe("formatReview", () => {
    const createReview = (overrides: Partial<PRReview> = {}): PRReview => ({
      summary: "Overall the code looks good.",
      verdict: "approve",
      comments: [],
      ...overrides,
    })

    describe("basic formatting", () => {
      it("includes PR number in header", () => {
        const review = createReview()
        const result = formatReview(review, 123)
        expect(result).toContain("PR #123 Review")
      })

      it("includes formatted verdict", () => {
        const review = createReview({ verdict: "approve" })
        const result = formatReview(review, 1)
        expect(result).toContain("Verdict: ✅ APPROVE")
      })

      it("includes summary", () => {
        const review = createReview({ summary: "This is the summary." })
        const result = formatReview(review, 1)
        expect(result).toContain("This is the summary.")
      })

      it("includes separator lines", () => {
        const review = createReview()
        const result = formatReview(review, 1)
        expect(result).toContain("─".repeat(60))
      })
    })

    describe("with comments", () => {
      it("shows comments section when comments exist", () => {
        const review = createReview({
          comments: [
            {
              file: "src/index.ts",
              line: 10,
              comment: "Consider renaming this variable",
              severity: "suggestion",
            },
          ],
        })
        const result = formatReview(review, 1)
        expect(result).toContain("Comments:")
      })

      it("formats comment with file and line", () => {
        const review = createReview({
          comments: [
            {
              file: "src/index.ts",
              line: 42,
              comment: "This could be improved",
              severity: "suggestion",
            },
          ],
        })
        const result = formatReview(review, 1)
        expect(result).toContain("src/index.ts:42")
      })

      it("formats comment without line number", () => {
        const review = createReview({
          comments: [
            {
              file: "src/index.ts",
              comment: "General file comment",
              severity: "suggestion",
            },
          ],
        })
        const result = formatReview(review, 1)
        expect(result).toContain("src/index.ts")
        expect(result).not.toContain("src/index.ts:")
      })

      it("includes comment text", () => {
        const review = createReview({
          comments: [
            {
              file: "src/index.ts",
              line: 10,
              comment: "This is my detailed feedback",
              severity: "suggestion",
            },
          ],
        })
        const result = formatReview(review, 1)
        expect(result).toContain("This is my detailed feedback")
      })

      it("formats severity for each comment", () => {
        const review = createReview({
          comments: [
            {
              file: "src/a.ts",
              line: 1,
              comment: "Critical issue",
              severity: "critical",
            },
            {
              file: "src/b.ts",
              line: 2,
              comment: "Nice work",
              severity: "praise",
            },
          ],
        })
        const result = formatReview(review, 1)
        expect(result).toContain("🚨 CRITICAL")
        expect(result).toContain("✨ Praise")
      })
    })

    describe("without comments", () => {
      it("does not show comments section", () => {
        const review = createReview({ comments: [] })
        const result = formatReview(review, 1)
        expect(result).not.toContain("Comments:")
      })
    })

    describe("different verdicts", () => {
      it("formats request_changes review", () => {
        const review = createReview({
          verdict: "request_changes",
          summary: "Changes needed before merge.",
        })
        const result = formatReview(review, 99)
        expect(result).toContain("Verdict: 🔴 REQUEST CHANGES")
        expect(result).toContain("Changes needed before merge.")
      })

      it("formats comment-only review", () => {
        const review = createReview({
          verdict: "comment",
          summary: "Some observations.",
        })
        const result = formatReview(review, 1)
        expect(result).toContain("Verdict: 💬 COMMENT")
      })
    })
  })
})
