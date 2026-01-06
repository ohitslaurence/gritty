import { mkdir, unlink } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { DEFAULT_COMMIT_PROMPT } from "../../core/prompts/commit"
import { StateError } from "../../types/errors"
import type { PromptName } from "../../types/models"
import { StateService } from "./service"

/**
 * Get the default prompt content for a given prompt name.
 */
const getDefaultPromptContent = (name: PromptName): string => {
  switch (name) {
    case "commit":
      return DEFAULT_COMMIT_PROMPT
    case "review":
      return "Review prompt not yet implemented"
    case "pr":
      return "PR prompt not yet implemented"
  }
}

/**
 * Create the live state service implementation.
 */
const makeStateService = (): StateService["Type"] => {
  const homeDir = process.env["HOME"] ?? ""
  const stateDir = `${homeDir}/.gritty`
  const promptsDir = `${stateDir}/prompts`

  const getPromptPath = (name: PromptName): string => `${promptsDir}/${name}.md`

  return {
    getStateDir: () => stateDir,

    ensureStateDir: () =>
      Effect.tryPromise({
        try: async () => {
          await mkdir(stateDir, { recursive: true })
          await mkdir(promptsDir, { recursive: true })
        },
        catch: (error) =>
          new StateError({
            operation: "ensureStateDir",
            message: `Failed to create state directory: ${stateDir}`,
            cause: error,
          }),
      }),

    getPrompt: (name) =>
      Effect.gen(function* () {
        const path = getPromptPath(name)
        const file = Bun.file(path)

        if (yield* Effect.promise(() => file.exists())) {
          const content = yield* Effect.tryPromise({
            try: () => file.text(),
            catch: (error) =>
              new StateError({
                operation: "getPrompt",
                message: `Failed to read prompt file: ${path}`,
                cause: error,
              }),
          })
          return content
        }

        return getDefaultPromptContent(name)
      }),

    getDefaultPrompt: (name) => Effect.succeed(getDefaultPromptContent(name)),

    savePrompt: (name, content) =>
      Effect.gen(function* () {
        yield* makeStateService().ensureStateDir()

        const path = getPromptPath(name)
        yield* Effect.tryPromise({
          try: () => Bun.write(path, content),
          catch: (error) =>
            new StateError({
              operation: "savePrompt",
              message: `Failed to save prompt file: ${path}`,
              cause: error,
            }),
        })
      }),

    resetPrompt: (name) =>
      Effect.tryPromise({
        try: async () => {
          const path = getPromptPath(name)
          const file = Bun.file(path)
          if (await file.exists()) {
            await unlink(path)
          }
        },
        catch: (error) =>
          new StateError({
            operation: "resetPrompt",
            message: `Failed to reset prompt: ${name}`,
            cause: error,
          }),
      }),

    hasOverride: (name) =>
      Effect.tryPromise({
        try: async () => {
          const path = getPromptPath(name)
          const file = Bun.file(path)
          return file.exists()
        },
        catch: (error) =>
          new StateError({
            operation: "hasOverride",
            message: `Failed to check prompt override: ${name}`,
            cause: error,
          }),
      }),
  }
}

/**
 * Live implementation of StateService.
 */
export const StateServiceLive = Layer.succeed(StateService, makeStateService())
