#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Installing gritty..."

# Check for git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: Git is required but not installed.${NC}"
    echo "Install git from https://git-scm.com/"
    exit 1
fi

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: Bun is required but not installed.${NC}"
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check for GitHub CLI (optional, for PR features)
GH_MISSING=false
if ! command -v gh &> /dev/null; then
    GH_MISSING=true
fi

# Install dependencies
echo "Installing dependencies..."
if ! bun install; then
    echo -e "${RED}Error: Failed to install dependencies${NC}"
    echo "Check your network connection and try again"
    exit 1
fi

# Build binary
echo "Building binary..."
if ! bun run build; then
    echo -e "${RED}Error: Failed to build binary${NC}"
    echo "Check for TypeScript errors: bun run typecheck"
    exit 1
fi

# Determine install location
INSTALL_DIR="$HOME/.local/bin"
if [[ "$1" == "--global" ]] || [[ "$1" == "-g" ]]; then
    INSTALL_DIR="/usr/local/bin"
fi

# Create install directory if needed
if [[ "$INSTALL_DIR" == "$HOME/.local/bin" ]]; then
    mkdir -p "$INSTALL_DIR"
fi

# Create symlink
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/dist/gritty"

# Verify binary was created
if [[ ! -f "$BINARY_PATH" ]]; then
    echo -e "${RED}Error: Binary not found at $BINARY_PATH${NC}"
    echo "Build may have failed silently. Try: bun run build"
    exit 1
fi

if [[ "$INSTALL_DIR" == "/usr/local/bin" ]]; then
    echo "Installing to $INSTALL_DIR (requires sudo)..."
    if ! sudo ln -sf "$BINARY_PATH" "$INSTALL_DIR/gritty"; then
        echo -e "${RED}Error: Failed to create symlink (permission denied?)${NC}"
        exit 1
    fi
else
    echo "Installing to $INSTALL_DIR..."
    if ! ln -sf "$BINARY_PATH" "$INSTALL_DIR/gritty"; then
        echo -e "${RED}Error: Failed to create symlink${NC}"
        exit 1
    fi
fi

# Verify symlink works
if [[ ! -x "$INSTALL_DIR/gritty" ]]; then
    echo -e "${YELLOW}Warning: Symlink created but not executable${NC}"
    echo "Try: chmod +x $BINARY_PATH"
elif ! "$INSTALL_DIR/gritty" --version &> /dev/null; then
    echo -e "${YELLOW}Warning: Symlink created but gritty doesn't run${NC}"
    echo "Check that Bun is installed and in your PATH"
fi

# Check if install dir is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}Warning: $INSTALL_DIR is not in your PATH${NC}"
    echo ""
    # Detect shell config file using basename for robustness
    SHELL_NAME="$(basename "$SHELL")"
    SHELL_CONFIG=""
    case "$SHELL_NAME" in
        zsh)  SHELL_CONFIG="$HOME/.zshrc" ;;
        bash) SHELL_CONFIG="$HOME/.bashrc" ;;
        fish) SHELL_CONFIG="$HOME/.config/fish/config.fish" ;;
    esac

    if [[ -n "$SHELL_CONFIG" ]]; then
        echo "Run this command to add to your PATH:"
        # Use $HOME expansion and touch to ensure file exists
        echo -e "  ${GREEN}touch $SHELL_CONFIG && echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> $SHELL_CONFIG && source $SHELL_CONFIG${NC}"
    else
        echo "Add this to your shell config:"
        echo -e "  ${GREEN}export PATH=\"$INSTALL_DIR:\$PATH\"${NC}"
    fi
    echo ""
fi

echo -e "${GREEN}✓ gritty installed successfully!${NC}"
echo ""

# Warn about missing gh CLI
if [[ "$GH_MISSING" == "true" ]]; then
    echo -e "${YELLOW}Note: GitHub CLI (gh) not found - 'gritty pr' won't work${NC}"
    echo "  Install: https://cli.github.com/"
    echo ""
fi

echo "Next steps:"
echo "  1. Run 'gritty auth login' to authenticate"
echo "  2. Run 'gritty commit' in any git repo"
echo "  3. Run 'gritty pr' to create PRs with AI descriptions"
