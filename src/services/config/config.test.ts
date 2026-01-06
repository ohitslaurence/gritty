import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { parseModelString, resolveEnvValue, getEnvKeyForProvider } from "./live"

describe("config utilities", () => {
  describe("parseModelString", () => {
    describe("valid formats", () => {
      it("parses anthropic provider", () => {
        const result = parseModelString("anthropic/claude-sonnet-4-5")
        expect(result).toEqual({
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
        })
      })

      it("parses openai provider", () => {
        const result = parseModelString("openai/gpt-4o")
        expect(result).toEqual({
          provider: "openai",
          modelId: "gpt-4o",
        })
      })

      it("handles model IDs with multiple dashes", () => {
        const result = parseModelString("anthropic/claude-3-5-sonnet-latest")
        expect(result).toEqual({
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-latest",
        })
      })

      it("handles model IDs with numbers", () => {
        const result = parseModelString("openai/gpt-4-turbo-2024-04-09")
        expect(result).toEqual({
          provider: "openai",
          modelId: "gpt-4-turbo-2024-04-09",
        })
      })
    })

    describe("invalid formats", () => {
      it("returns null for bare model ID", () => {
        expect(parseModelString("claude-sonnet-4-5")).toBeNull()
      })

      it("returns null for unsupported provider", () => {
        expect(parseModelString("google/gemini-pro")).toBeNull()
        expect(parseModelString("cohere/command")).toBeNull()
      })

      it("returns null for empty string", () => {
        expect(parseModelString("")).toBeNull()
      })

      it("returns null for multiple slashes", () => {
        expect(parseModelString("anthropic/models/claude")).toBeNull()
      })

      it("returns null for trailing slash", () => {
        expect(parseModelString("anthropic/")).toBeNull()
      })

      it("returns null for leading slash", () => {
        expect(parseModelString("/claude-sonnet")).toBeNull()
      })

      it("returns null for just a slash", () => {
        expect(parseModelString("/")).toBeNull()
      })
    })
  })

  describe("resolveEnvValue", () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    describe("env substitution", () => {
      it("resolves {env:VAR_NAME} syntax", () => {
        process.env["TEST_API_KEY"] = "sk-test-123"
        expect(resolveEnvValue("{env:TEST_API_KEY}")).toBe("sk-test-123")
      })

      it("returns undefined for missing env var", () => {
        delete process.env["MISSING_VAR"]
        expect(resolveEnvValue("{env:MISSING_VAR}")).toBeUndefined()
      })

      it("handles env vars with special characters in value", () => {
        process.env["SPECIAL_KEY"] = "sk-ant-api03-abc123!@#$%"
        expect(resolveEnvValue("{env:SPECIAL_KEY}")).toBe("sk-ant-api03-abc123!@#$%")
      })
    })

    describe("passthrough values", () => {
      it("returns plain strings unchanged", () => {
        expect(resolveEnvValue("sk-ant-123")).toBe("sk-ant-123")
      })

      it("returns undefined for undefined input", () => {
        expect(resolveEnvValue(undefined)).toBeUndefined()
      })

      it("returns empty string unchanged", () => {
        expect(resolveEnvValue("")).toBe("")
      })

      it("does not substitute partial matches", () => {
        expect(resolveEnvValue("prefix{env:VAR}suffix")).toBe("prefix{env:VAR}suffix")
      })

      it("does not substitute malformed syntax", () => {
        expect(resolveEnvValue("{env:}")).toBe("{env:}")
        expect(resolveEnvValue("{env:VAR")).toBe("{env:VAR")
        expect(resolveEnvValue("env:VAR}")).toBe("env:VAR}")
      })
    })
  })

  describe("getEnvKeyForProvider", () => {
    it("returns ANTHROPIC_API_KEY for anthropic", () => {
      expect(getEnvKeyForProvider("anthropic")).toBe("ANTHROPIC_API_KEY")
    })

    it("returns OPENAI_API_KEY for openai", () => {
      expect(getEnvKeyForProvider("openai")).toBe("OPENAI_API_KEY")
    })
  })
})
