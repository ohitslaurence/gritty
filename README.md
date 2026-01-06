# gritty

A fast, AI-powered Git CLI that helps you write better commits, PRs, and code reviews.

Built with [Bun](https://bun.sh) and [Effect](https://effect.website) for speed and reliability.

## Features

| Command | Description |
|---------|-------------|
| `gritty commit` | Generate meaningful commit messages from your diff |
| `gritty compose` | Intelligently split messy changes into logical commits |
| `gritty pr` | Generate PR titles and descriptions |
| `gritty review` | AI-powered code review with inline comments |
| `gritty branch` | Quick branch creation and switching |

**Additional capabilities:**
- **Multi-provider** — Supports Anthropic (Claude) and OpenAI models
- **Speed tiers** — Fast (Haiku), Medium (Sonnet), Slow (Opus)
- **Context aware** — Reads CLAUDE.md, README, and repo history for better results
- **Chunked review** — Large PRs are split into logical groups for thorough analysis
- **Resumable** — Review state persists if interrupted

## Installation

**Prerequisites:**
- [Bun](https://bun.sh) >= 1.0
- [GitHub CLI](https://cli.github.com) (for `pr` and `review` commands)

```bash
# Clone and install
git clone https://github.com/ohitslaurence/gritty.git
cd gritty
./install.sh

# Authenticate
gritty auth login
```

The install script builds the binary and symlinks it to `~/.local/bin`. Use `./install.sh --global` to install to `/usr/local/bin` instead.

## Quick Start

```bash
# Stage some changes, then generate a commit
git add .
gritty commit

# Or let gritty organize messy changes into logical commits
gritty compose

# Create a PR with AI-generated description
gritty pr

# Review someone else's PR
gritty review --pr 123
```

## Commands

### `gritty commit`

Generate a commit message from your staged diff.

```bash
gritty commit                  # Interactive prompt (y/n/e)
gritty commit --accept         # Auto-accept generated message
gritty commit --dry-run        # Preview without committing
gritty commit --context "..."  # Add context for better messages
gritty commit --fast           # Use faster model (Haiku)
gritty commit --slow           # Use slower model (Opus)
```

### `gritty compose`

Analyze all your changes and propose logical commit groupings. Perfect for end-of-day commits or when you've been working on multiple things.

```bash
gritty compose                 # Interactive grouping workflow
gritty compose --accept        # Auto-accept all prompts
gritty compose --dry-run       # Preview without committing
```

**Workflow:**
1. Analyzes staged, unstaged, and untracked files
2. AI proposes logical groupings (e.g., "feature + tests", "refactor", "docs")
3. Review and provide feedback to adjust (`y/n/f`)
4. Each commit opens your editor for final review

### `gritty pr`

Generate a PR with AI-powered title and description.

```bash
gritty pr                      # Create PR interactively
gritty pr --accept             # Auto-accept generated content
gritty pr --draft              # Create as draft PR
gritty pr --base develop       # Target branch (default: main)
gritty pr --context "..."      # Add context for description
```

Requires GitHub CLI (`gh auth login`).

### `gritty review`

AI-powered code review for pull requests.

```bash
gritty review                  # List open PRs and select one
gritty review --pr 123         # Review specific PR
gritty review -r 123 --post    # Review and post to GitHub
gritty review -r 123 --fresh   # Ignore cached state, start fresh
gritty review -r 123 -c 4      # Review with 4 parallel workers
```

**How it works:**
1. Fetches PR diff and groups files by logical relationship
2. Reviews each chunk in parallel for speed
3. Aggregates results into a verdict (approve/request changes/comment)
4. Optionally posts review with inline comments to GitHub

Requires GitHub CLI (`gh auth login`).

### `gritty branch`

Quick branch creation and switching.

```bash
gritty branch feat/new-thing   # Create and switch (or just switch if exists)
```

### `gritty auth`

Manage API credentials.

```bash
gritty auth login              # Save API key
gritty auth status             # Check auth status
gritty auth logout             # Remove credentials
```

Credentials are stored in `~/.config/gritty/auth.json`. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) take precedence.

### `gritty config`

Manage configuration.

```bash
gritty config init             # Create .grittyrc with defaults
gritty config show             # Display current config
```

## Configuration

Create a `.grittyrc` in your project root:

```json
{
  "version": 1,
  "model": "anthropic/claude-sonnet-4-20250514",
  "fastModel": "anthropic/claude-3-5-haiku-latest",
  "slowModel": "anthropic/claude-opus-4-20250514",
  "commit": {
    "style": "conventional",
    "model": {
      "default": "medium"
    }
  }
}
```

### Model Format

Models use `provider/model-id` format:

```
anthropic/claude-sonnet-4-20250514
anthropic/claude-3-5-haiku-latest
openai/gpt-4o
openai/gpt-4-turbo
```

### Config Priority

1. `.grittyrc` (project root)
2. `.gritty.json` (project root)
3. `~/.gritty/config.json` (home directory)

### Provider Configuration

Configure custom base URLs or API keys per provider:

```json
{
  "version": 1,
  "model": "openai/gpt-4o",
  "provider": {
    "openai": {
      "apiKey": "{env:OPENAI_API_KEY}",
      "baseURL": "https://api.openai.com/v1"
    }
  }
}
```

The `{env:VAR_NAME}` syntax pulls values from environment variables.

### Review Exclusions

Exclude generated files from code review:

```json
{
  "version": 1,
  "review": {
    "exclude": [
      "**/*.generated.ts",
      "**/dist/**"
    ]
  }
}
```

Default exclusions: `**/generated/**`, `**/*.generated.*`, `**/*.gen.*`, `**/codegen/**`, `**/__generated__/**`

## Development

```bash
bun install              # Install dependencies
bun run dev              # Run CLI in development
bun run check            # Lint + typecheck + tests
bun test                 # Run tests only
bun run build            # Build for distribution
```

### Project Structure

```
src/
├── cli/commands/        # Command implementations
├── services/            # Core services (ai, auth, config, git, provider)
├── core/                # Shared utilities
└── types/               # Type definitions and errors
```

## License

MIT
