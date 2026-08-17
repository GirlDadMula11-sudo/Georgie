#!/bin/zsh
set -euo pipefail

REPO_URL="https://github.com/GirlDadMula11-sudo/Georgie.git"
INSTALL_DIR="${GEORGIE_INSTALL_DIR:-$HOME/Georgie}"

say_step() { printf '\n[Georgie] %s\n' "$1"; }

say_step "Preparing your Mac..."

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. macOS may prompt to install Command Line Tools."
  xcode-select --install >/dev/null 2>&1 || true
  echo "After Command Line Tools finish installing, run this command again."
  exit 1
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  say_step "Updating existing Georgie installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  say_step "Installing Georgie into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
chmod +x mac-agent/install.sh
exec mac-agent/install.sh
