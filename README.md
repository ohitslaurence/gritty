# gritty

AI-powered Git CLI tool using Claude. Generate meaningful commit messages from your staged changes.

## Features

- **Smart Commit Messages** — Analyzes your diff and generates conventional commit messages
- **Intelligent Compose** — Automatically splits changes into logical commits
- **Speed Tiers** — Choose between Haiku (fast), Sonnet (balanced), or Opus (quality)
- **Style Detection** — Matches your repo's existing commit message style
- **Context Aware** — Add context to help the AI understand your changes
- **Project Config** — `.grittyrc` for per-project settings
- **Secure Auth** — API keys stored locally with proper permissions
- **Effect-Powered** — Built with Effect for robust error handling and composability

## Installation

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- An [Anthropic API key](https://console.anthropic.com/)

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

### Intelligent compose

Split your changes into logical commits:

```bash
# Analyze changes and propose commit groupings
gritty compose

# Preview proposed commits without executing
gritty compose --dry-run
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
      "default": "fast"
    }
  }
}
```

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

### v0.3 — Configuration (In Progress)
- [x] `.grittyrc` project config support
- [x] Default speed tier from config
- [ ] `gritty config init/show` commands
- [ ] Better error messages with suggestions
- [ ] Improved help text with examples

### v0.4 — Testing & Quality
- [ ] Expanded test coverage (compose, config, split)
- [ ] TestConfigService utility
- [ ] Integration tests

### v0.5 — More Commands
- [ ] `gritty review` — AI code review
- [ ] `gritty pr` — Generate PR descriptions
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
