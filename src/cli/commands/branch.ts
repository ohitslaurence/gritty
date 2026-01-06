import { Args, Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { GitService } from "../../services/git/service"

/**
 * Branch name argument.
 */
const branchNameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Branch name to create or switch to")
)

/**
 * The branch command - create or switch to a branch.
 */
export const branchCommand = Command.make(
  "branch",
  { name: branchNameArg },
  ({ name }) =>
    Effect.gen(function* () {
      const git = yield* GitService

      // Check if we're in a git repo
      const isRepo = yield* git.isGitRepo()
      if (!isRepo) {
        yield* Console.error("\n✗ Not a git repository")
        yield* Console.error("  Run this command from within a git repository")
        return
      }

      // Check if branch exists
      const exists = yield* git.branchExists(name)

      // Switch to or create branch
      yield* git.checkoutBranch(name)

      if (exists) {
        yield* Console.log(`✓ Switched to branch '${name}'`)
      } else {
        yield* Console.log(`✓ Created and switched to branch '${name}'`)
      }
    }).pipe(
      Effect.catchTag("GitError", (e) =>
        Console.error(`\n✗ Git error: ${e.message}`)
      )
    )
).pipe(
  Command.withDescription("Create or switch to a branch")
)
