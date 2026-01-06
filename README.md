# gritty

AI-powered Git CLI tool using Claude. Generate meaningful commit messages from your staged changes.

## Features

- **Smart Commit Messages** — Analyzes your diff and generates conventional commit messages
- **Speed Tiers** — Choose between Haiku (fast), Sonnet (balanced), or Opus (quality)
- **Context Aware** — Add context to help the AI understand your changes
- **Secure Auth** — API keys stored locally with proper permissions
- **Effect-Powered** — Built with Effect for robust error handling and composability

## Installation

```bash
# Clone and install
git clone https://github.com/ohitslaurence/gritty.git
cd gritty
bun install

# Authenticate with Anthropic
bun run dev auth login
```

## Usage

### Generate a commit message

```bash
# Generate and commit (interactive)
gritty commit

# Auto-confirm the generated message
gritty commit --yes

# Preview without committing
gritty commit --dry-run

# Add context for better messages
gritty commit --context "fixing the auth bug from issue #123"
```

### Speed tiers

```bash
gritty commit --fast    # Haiku - quick, good for simple changes
gritty commit --medium  # Sonnet - balanced (default)
gritty commit --slow    # Opus - highest quality, complex changes
```

### Authentication

```bash
gritty auth login   # Save API key to ~/.config/gritty/auth.json
gritty auth status  # Check authentication status
gritty auth logout  # Remove stored credentials
```

You can also set `ANTHROPIC_API_KEY` environment variable (takes precedence).

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
│       └── auth.ts         # Auth commands
├── services/
│   ├── ai/                 # Claude API integration
│   ├── auth/               # Credential management
│   ├── config/             # Configuration loading
│   ├── git/                # Git operations
│   └── state/              # State management
├── types/
│   ├── branded.ts          # Branded types (DiffContent, CommitMessage)
│   ├── errors.ts           # Typed errors
│   └── models.ts           # Domain models
└── core/
    └── prompts/            # AI prompt templates
```

## Roadmap

### v0.1 — Foundation ✅
- [x] Project setup (Bun, TypeScript, Effect)
- [x] Git service (diff, status, commit)
- [x] AI service with Claude integration
- [x] `gritty commit` command with speed tiers
- [x] Auth flow (login/logout/status)
- [x] Local credential storage

### v0.2 — Polish
- [ ] Interactive prompt confirmation (Y/n/e)
- [ ] Edit message before commit
- [ ] Commit style detection from repo history
- [ ] Conventional commit scope suggestions
- [ ] Better error messages and recovery

### v0.3 — Configuration
- [ ] `.gritty.json` project config
- [ ] Custom prompt templates
- [ ] Model override per project
- [ ] Ignore patterns for diff

### v0.4 — More Commands
- [ ] `gritty review` — AI code review
- [ ] `gritty pr` — Generate PR descriptions
- [ ] `gritty changelog` — Generate changelogs
- [ ] `gritty explain` — Explain code changes

### v0.5 — Distribution
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
