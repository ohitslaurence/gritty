import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { ReviewStateService } from "../../services/review-state/service"

/**
 * The clear command - clears all cached review state.
 */
export const clearCommand = Command.make("clear", {}, () =>
  Effect.gen(function* () {
    const reviewState = yield* ReviewStateService

    yield* Console.log("Clearing cached review state...")

    const result = yield* reviewState.clearAll()

    if (result.count === 0) {
      yield* Console.log("No cached review state to clear")
    } else {
      yield* Console.log(`Cleared ${result.count} cached review(s) from ~/.gritty/reviews/`)
    }
  }).pipe(
    Effect.catchTags({
      StateError: (e) => Console.error(`\n✗ State error: ${e.message}`),
    })
  )
).pipe(Command.withDescription("Clear all cached PR review state"))
