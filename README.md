# gritty

AI-powered Git CLI tool using Claude. Generate meaningful commit messages and intelligently organize your changes.

## Features

- **Smart Commit Messages** — Analyzes your diff and generates conventional commit messages
- **Intelligent Compose** — AI analyzes all your changes and proposes logical commit groupings with a feedback loop
- **AI-Powered PRs** — Generate PR titles and descriptions from your commits and diff
- **Quick Branching** — Simple `gritty branch` command to create or switch branches
- **Speed Tiers** — Choose between Haiku (fast), Sonnet (balanced), or Opus (quality)
- **Style Detection** — Matches your repo's existing commit message style
- **Customizable Models** — Configure different Claude models for each speed tier
- **Context Aware** — Add context to help the AI understand your changes
- **Project Config** — `.grittyrc` for per-project settings
- **Secure Auth** — API keys stored locally with proper permissions

## Installation

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- An [Anthropic API key](https://console.anthropic.com/)
- [GitHub CLI](https://cli.github.com/) (optional, for `gritty pr`)

### Quick Start

```bash
# Clone the repo
git clone https://github.com/ohitslaurence/gritty.git
cd gritty

# Run the install script (installs to ~/.local/bin)
./install.sh

# Or install to /usr/local/bin (requires sudo)
./install.sh --global

# Authenticate with Anthropic
gritty auth login
```

The install script will:
1. Install dependencies
2. Build the binary
3. Create a symlink in your PATH
4. Warn you if the install directory isn't in your PATH

### Manual Installation

```bash
bun install
bun run build

# Symlink to your preferred location
ln -sf "$(pwd)/dist/gritty" ~/.local/bin/gritty
# or
sudo ln -sf "$(pwd)/dist/gritty" /usr/local/bin/gritty
```

### Development Mode

Run without building:

```bash
bun run dev commit --dry-run
```

## Usage

### Generate a commit message

```bash
# Generate and commit (interactive y/n/e prompt)
gritty commit

# Auto-accept the generated message
gritty commit --accept

# Preview without committing
gritty commit --dry-run

# Add context for better messages
gritty commit --context "fixing the auth bug from issue #123"

# Only use already-staged changes (skip auto-staging)
gritty commit --staged-only
```

### Intelligent Compose

When you have many changes across different files, `compose` analyzes them and proposes logical commit groupings:

```bash
# Analyze all changes and propose commit structure
gritty compose

# Preview proposed commits without executing
gritty compose --dry-run

# Auto-accept all prompts (for automation)
gritty compose --accept
```

**How it works:**
1. Analyzes all staged, unstaged, and untracked files
2. AI proposes logical commit groupings (e.g., "feature + tests", "refactor", "docs")
3. You review and can provide feedback to adjust groupings (`y/n/f`)
4. For each commit, generates a message and opens your editor for review

This is powerful for end-of-day commits or when you've been working on multiple things.

### Create Pull Requests

Generate AI-powered PR descriptions from your branch's commits:

```bash
# Create PR with AI-generated title and description
gritty pr

# Preview without creating
gritty pr --dry-run

# Create as draft PR
gritty pr --draft

# Specify base branch (default: main/master)
gritty pr --base develop

# Add context for better descriptions
gritty pr --context "implements RFC-123"
```

**How it works:**
1. Analyzes commits ahead of base branch and the diff
2. AI generates a PR title and description with summary + test plan
3. You review and can accept, edit in browser, or abort
4. Automatically pushes branch if not yet pushed

Requires [GitHub CLI](https://cli.github.com/) to be installed and authenticated (`gh auth login`).

### Quick Branching

Simple branch management without typing `git checkout -b`:

```bash
# Create or switch to a branch
gritty branch feat/new-feature

# If branch exists, switches to it
# If branch doesn't exist, creates and switches to it
```

### Speed tiers

```bash
gritty commit --fast    # Haiku - quick, good for simple changes
gritty commit           # Sonnet - balanced (default)
gritty commit --slow    # Opus - highest quality, complex changes
```

### Authentication

```bash
gritty auth login   # Save API key to ~/.config/gritty/auth.json
gritty auth status  # Check authentication status
gritty auth logout  # Remove stored credentials
```

You can also set `ANTHROPIC_API_KEY` environment variable (takes precedence).

### Configuration

Create a `.grittyrc` file in your project root:

```bash
gritty config init   # Create .grittyrc with defaults
gritty config show   # Display current configuration
```

Example `.grittyrc`:

```json
{
  "version": 1,
  "commit": {
    "style": "conventional",
    "model": {
      "default": "fast",
      "fast": "claude-3-5-haiku-latest",
      "medium": "claude-sonnet-4-20250514",
      "slow": "claude-opus-4-20250514"
    }
  }
}
```

**Model options:**
- `default`: Which tier to use when no flag specified (`fast` | `medium` | `slow`)
- `fast`, `medium`, `slow`: Custom model IDs for each tier (any Claude model ID)

Config is loaded from (in order): `.grittyrc` → `.gritty.json` → `~/.gritty/config.json`

## Development

```bash
bun run dev          # Run CLI in development
bun run check        # Lint + typecheck + test
bun test             # Run tests
bun run build        # Build for distribution
```

## Architecture

Built with [Effect](https://effect.website/) for type-safe, composable error handling:

```
src/
├── cli/
│   ├── app.ts              # CLI entry point
│   └── commands/
│       ├── commit.ts       # Commit command
│       ├── compose.ts      # Compose command
│       ├── pr.ts           # PR command
│       ├── branch.ts       # Branch command
│       ├── config.ts       # Config commands
│       └── auth.ts         # Auth commands
├── services/
│   ├── ai/                 # Claude API integration
│   ├── auth/               # Credential management
│   ├── config/             # Configuration loading (.grittyrc)
│   ├── git/                # Git operations
│   └── state/              # State management
├── types/
│   ├── branded.ts          # Branded types (DiffContent, CommitMessage)
│   ├── errors.ts           # Typed errors
│   └── models.ts           # Domain models
└── core/
    ├── git-utils.ts        # Shared git utilities
    ├── prompt.ts           # Interactive prompts
    └── split.ts            # Diff splitting utilities
```

## Roadmap

### v0.1 — Foundation ✅
- [x] Project setup (Bun, TypeScript, Effect)
- [x] Git service (diff, status, commit)
- [x] AI service with Claude integration
- [x] `gritty commit` command with speed tiers
- [x] Auth flow (login/logout/status)
- [x] Local credential storage

### v0.2 — Polish ✅
- [x] Interactive prompt confirmation (y/n/e)
- [x] Edit message before commit (opens editor)
- [x] Commit style detection from repo history
- [x] `gritty compose` — intelligent commit splitting
- [x] Large diff handling with truncation warnings
- [x] `--accept` flag for automation

### v0.3 — Configuration ✅
- [x] `.grittyrc` project config support
- [x] Default speed tier from config
- [x] Custom model IDs per speed tier
- [x] `gritty config init/show` commands
- [x] Better error messages with suggestions
- [x] Improved help text with examples

### v0.4 — Testing & Quality ✅
- [x] Expanded test coverage (compose, config, split)
- [x] TestConfigService utility
- [ ] Integration tests

### v0.5 — More Commands (In Progress)
- [x] `gritty pr` — Generate PR descriptions
- [x] `gritty branch` — Quick branch creation/switching
- [ ] `gritty review` — AI code review
- [ ] `gritty changelog` — Generate changelogs
- [ ] `gritty explain` — Explain code changes

### v0.6 — Distribution
- [ ] npm package publishing
- [ ] Homebrew formula
- [ ] Shell completions (bash, zsh, fish)
- [ ] Global install support

### Future Ideas
- [ ] Multi-provider support (OpenAI, local models)
- [ ] Git hooks integration
- [ ] Team sharing of prompts/config
- [ ] Usage analytics and cost tracking
- [ ] VS Code extension

## License

MIT
