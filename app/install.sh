#!/bin/bash
# klyr installer for macOS
# Usage: curl -fsSL http://localhost:8000/install | bash
set -e

KLYR_HOME="$HOME/.klyr"
PORT="${KLYR_PORT:-8000}"

BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'
GREEN='\033[32m'

echo ""
echo -e "${BOLD}  Installing klyr...${RESET}"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "  Error: Node.js is required."
  echo "  Install: https://nodejs.org or 'brew install node'"
  echo ""
  exit 1
fi

echo -e "  ${DIM}Node.js found: $(node --version)${RESET}"

# Determine source (local server or remote)
SOURCE_URL="http://localhost:$PORT"
REMOTE_URL=""  # Will be set when domain is purchased

if [ -n "$REMOTE_URL" ]; then
  SOURCE_URL="$REMOTE_URL"
fi

# Test connection
if ! curl -sf "$SOURCE_URL" > /dev/null 2>&1; then
  echo "  Error: Cannot reach klyr server at $SOURCE_URL"
  echo "  Make sure the server is running, or install manually."
  exit 1
fi

# Download package
echo -e "  ${DIM}Downloading klyr...${RESET}"
mkdir -p "$KLYR_HOME"
curl -sf "$SOURCE_URL/download/klyr.tar.gz" -o "/tmp/klyr-package.tar.gz"

if [ ! -f "/tmp/klyr-package.tar.gz" ]; then
  echo "  Error: Download failed."
  exit 1
fi

# Extract (tarball contains an app/ directory, strip it)
echo -e "  ${DIM}Extracting...${RESET}"
tar -xzf "/tmp/klyr-package.tar.gz" --strip-components=1 -C "$KLYR_HOME"
rm -f "/tmp/klyr-package.tar.gz"

# Install Node.js dependencies
echo -e "  ${DIM}Installing dependencies...${RESET}"
cd "$KLYR_HOME" && npm install --production --silent 2>/dev/null

# Make CLI executable
chmod +x "$KLYR_HOME/bin/klyr"

# Add to PATH
SHELL_RC="$HOME/.zshrc"
if [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

# Try symlink first
if sudo ln -sf "$KLYR_HOME/bin/klyr" /usr/local/bin/klyr 2>/dev/null; then
  echo -e "  ${DIM}Linked to /usr/local/bin/klyr${RESET}"
else
  # Fallback: add to PATH in shell rc
  if ! grep -q "klyr/bin" "$SHELL_RC" 2>/dev/null; then
    echo '' >> "$SHELL_RC"
    echo '# klyr' >> "$SHELL_RC"
    echo 'export PATH="$HOME/.klyr/bin:$PATH"' >> "$SHELL_RC"
    echo -e "  ${DIM}Added to PATH in $SHELL_RC${RESET}"
    echo -e "  ${DIM}Run: source $SHELL_RC${RESET}"
  fi
fi

echo ""
echo -e "  ${GREEN}${BOLD}klyr installed successfully!${RESET}"
echo ""
echo -e "  Run ${BOLD}klyr${RESET} to start building."
echo ""
