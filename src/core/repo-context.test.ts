import { describe, expect, it } from "bun:test"
import { truncateContent, GUIDELINE_FILES, README_FILES } from "./repo-context"

describe("repo-context", () => {
  describe("truncateContent", () => {
    describe("content within limit", () => {
      it("returns content unchanged when under limit", () => {
        const content = "Short content"
        expect(truncateContent(content, 100)).toBe(content)
      })

      it("returns content unchanged when exactly at limit", () => {
        const content = "Exactly 10"
        expect(truncateContent(content, 10)).toBe(content)
      })

      it("handles empty string", () => {
        expect(truncateContent("", 100)).toBe("")
      })
    })

    describe("content over limit", () => {
      it("truncates content and adds notice", () => {
        const content = "This is a long string that exceeds the limit"
        const result = truncateContent(content, 20)
        // Original content should not appear in full
        expect(result).not.toContain("exceeds the limit")
        expect(result).toContain("--- Content truncated")
      })

      it("preserves complete lines when possible", () => {
        const content = "Line 1\nLine 2\nLine 3\nLine 4"
        const result = truncateContent(content, 15)
        // Should cut at a newline boundary
        expect(result).toContain("Line 1\nLine 2")
        expect(result).not.toContain("Line 3")
      })

      it("adds truncation notice", () => {
        const content = "Line 1\nLine 2\nLine 3"
        const result = truncateContent(content, 10)
        expect(result).toContain("--- Content truncated")
      })

      it("includes character counts in notice", () => {
        const content = "A".repeat(100) + "\n" + "B".repeat(100)
        const result = truncateContent(content, 50)
        expect(result).toMatch(/\d+ → \d+ chars/)
      })

      it("handles content with no newlines", () => {
        const content = "A".repeat(100)
        const result = truncateContent(content, 50)
        // Should truncate even without newlines
        expect(result.length).toBeLessThan(content.length)
        expect(result).toContain("--- Content truncated")
      })
    })

    describe("edge cases", () => {
      it("handles single character limit", () => {
        const result = truncateContent("Hello", 1)
        expect(result).toContain("--- Content truncated")
      })

      it("handles multiline content with various line lengths", () => {
        const content = "Short\nA much longer line here\nAnother"
        const result = truncateContent(content, 25)
        expect(result).toContain("Short")
      })

      it("handles content with only newlines", () => {
        const content = "\n\n\n\n\n"
        const result = truncateContent(content, 3)
        expect(result).toContain("--- Content truncated")
      })
    })
  })

  describe("GUIDELINE_FILES", () => {
    it("includes CLAUDE.md variants", () => {
      expect(GUIDELINE_FILES).toContain("CLAUDE.md")
      expect(GUIDELINE_FILES).toContain("claude.md")
      expect(GUIDELINE_FILES).toContain(".claude/CLAUDE.md")
    })

    it("includes agents.md variants", () => {
      expect(GUIDELINE_FILES).toContain("agents.md")
      expect(GUIDELINE_FILES).toContain("AGENTS.md")
      expect(GUIDELINE_FILES).toContain(".github/AGENTS.md")
    })

    it("has correct priority order (CLAUDE.md first)", () => {
      expect(GUIDELINE_FILES[0]).toBe("CLAUDE.md")
    })
  })

  describe("README_FILES", () => {
    it("includes README.md variants", () => {
      expect(README_FILES).toContain("README.md")
      expect(README_FILES).toContain("readme.md")
    })

    it("has correct priority order (README.md first)", () => {
      expect(README_FILES[0]).toBe("README.md")
    })
  })
})
