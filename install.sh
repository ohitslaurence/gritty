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
bun install

# Build binary
echo "Building binary..."
bun run build

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

if [[ "$INSTALL_DIR" == "/usr/local/bin" ]]; then
    echo "Installing to $INSTALL_DIR (requires sudo)..."
    sudo ln -sf "$BINARY_PATH" "$INSTALL_DIR/gritty"
else
    echo "Installing to $INSTALL_DIR..."
    ln -sf "$BINARY_PATH" "$INSTALL_DIR/gritty"
fi

# Check if install dir is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}Warning: $INSTALL_DIR is not in your PATH${NC}"
    echo ""
    echo "Add this to your ~/.bashrc or ~/.zshrc:"
    echo -e "  ${GREEN}export PATH=\"$INSTALL_DIR:\$PATH\"${NC}"
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
