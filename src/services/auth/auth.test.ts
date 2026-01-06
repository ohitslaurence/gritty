import { describe, expect, it } from "bun:test"
import { Effect, Exit } from "effect"
import type { StoredCredentials } from "./service"
import { AuthService } from "./service"
import { TestAuthService } from "./test"

describe("AuthService", () => {
  describe("TestAuthService.withCredentials", () => {
    it("returns null for missing provider", async () => {
      const credentials: StoredCredentials = {
        anthropic: { apiKey: "sk-ant-123", createdAt: "2024-01-01T00:00:00Z" },
      }

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getApiKey("openai")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withCredentials(credentials)))
      )

      expect(result).toBeNull()
    })

    it("returns api key for stored provider", async () => {
      const credentials: StoredCredentials = {
        anthropic: { apiKey: "sk-ant-123", createdAt: "2024-01-01T00:00:00Z" },
      }

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getApiKey("anthropic")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withCredentials(credentials)))
      )

      expect(result).toBe("sk-ant-123")
    })

    it("returns all credentials", async () => {
      const credentials: StoredCredentials = {
        anthropic: { apiKey: "sk-ant-123", createdAt: "2024-01-01T00:00:00Z" },
        openai: { apiKey: "sk-openai-456", createdAt: "2024-01-02T00:00:00Z" },
      }

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getAllCredentials()
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withCredentials(credentials)))
      )

      expect(result.anthropic?.apiKey).toBe("sk-ant-123")
      expect(result.openai?.apiKey).toBe("sk-openai-456")
    })

    it("isAuthenticated returns true for provider with key", async () => {
      const credentials: StoredCredentials = {
        anthropic: { apiKey: "sk-ant-123", createdAt: "2024-01-01T00:00:00Z" },
      }

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.isAuthenticated("anthropic")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withCredentials(credentials)))
      )

      expect(result).toBe(true)
    })

    it("isAuthenticated returns false for provider without key", async () => {
      const credentials: StoredCredentials = {
        anthropic: { apiKey: "sk-ant-123", createdAt: "2024-01-01T00:00:00Z" },
      }

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.isAuthenticated("openai")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withCredentials(credentials)))
      )

      expect(result).toBe(false)
    })
  })

  describe("TestAuthService.withApiKey", () => {
    it("creates credentials for specific provider", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getApiKey("openai")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withApiKey("openai", "sk-test-key")))
      )

      expect(result).toBe("sk-test-key")
    })

    it("returns null for other providers", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getApiKey("anthropic")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withApiKey("openai", "sk-test-key")))
      )

      expect(result).toBeNull()
    })
  })

  describe("TestAuthService.withSaveCapture", () => {
    it("captures save operations", async () => {
      const saves: Array<{ provider: string; apiKey: string }> = []

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        yield* auth.saveApiKey("anthropic", "sk-ant-new")
        yield* auth.saveApiKey("openai", "sk-openai-new")
      })

      await Effect.runPromise(
        program.pipe(
          Effect.provide(
            TestAuthService.withSaveCapture((provider, apiKey) => {
              saves.push({ provider, apiKey })
            })
          )
        )
      )

      expect(saves).toHaveLength(2)
      expect(saves[0]).toEqual({ provider: "anthropic", apiKey: "sk-ant-new" })
      expect(saves[1]).toEqual({ provider: "openai", apiKey: "sk-openai-new" })
    })
  })

  describe("TestAuthService.make", () => {
    it("allows partial implementation override", async () => {
      let getApiKeyCalled = false

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getApiKey("anthropic")
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(
            TestAuthService.make({
              getApiKey: () => {
                getApiKeyCalled = true
                return Effect.succeed("custom-key")
              },
            })
          )
        )
      )

      expect(getApiKeyCalled).toBe(true)
      expect(result).toBe("custom-key")
    })

    it("uses defaults for non-overridden methods", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getAllCredentials()
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.make({})))
      )

      expect(result).toEqual({})
    })
  })

  describe("TestAuthService.withError", () => {
    it("fails all operations with configured error", async () => {
      const { ConfigError } = await import("../../types/errors")
      const error = new ConfigError({ message: "Auth failed" })

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getApiKey("anthropic")
      })

      const result = await Effect.runPromiseExit(
        program.pipe(Effect.provide(TestAuthService.withError(error)))
      )

      expect(Exit.isFailure(result)).toBe(true)
    })

    it("fails save operations", async () => {
      const { ConfigError } = await import("../../types/errors")
      const error = new ConfigError({ message: "Save failed" })

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.saveApiKey("anthropic", "key")
      })

      const result = await Effect.runPromiseExit(
        program.pipe(Effect.provide(TestAuthService.withError(error)))
      )

      expect(Exit.isFailure(result)).toBe(true)
    })
  })

  describe("TestAuthService.default", () => {
    it("returns null for all providers", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        const anthropic = yield* auth.getApiKey("anthropic")
        const openai = yield* auth.getApiKey("openai")
        return { anthropic, openai }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.default))
      )

      expect(result.anthropic).toBeNull()
      expect(result.openai).toBeNull()
    })

    it("isAuthenticated returns false", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.isAuthenticated("anthropic")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.default))
      )

      expect(result).toBe(false)
    })

    it("getAllCredentials returns empty object", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getAllCredentials()
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.default))
      )

      expect(result).toEqual({})
    })
  })

  describe("getCredentialsInfo", () => {
    it("returns credentials info for stored provider", async () => {
      const credentials: StoredCredentials = {
        anthropic: { apiKey: "sk-ant-123", createdAt: "2024-01-01T00:00:00Z" },
      }

      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getCredentialsInfo("anthropic")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.withCredentials(credentials)))
      )

      expect(result).not.toBeNull()
      expect(result?.apiKey).toBe("sk-ant-123")
      expect(result?.createdAt).toBe("2024-01-01T00:00:00Z")
    })

    it("returns null for missing provider", async () => {
      const program = Effect.gen(function* () {
        const auth = yield* AuthService
        return yield* auth.getCredentialsInfo("openai")
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestAuthService.default))
      )

      expect(result).toBeNull()
    })
  })
})
