#!/usr/bin/env bash
# Install wasteland command completion

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Installing wasteland command completion..."

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
    SHELL_TYPE="zsh"
    COMPLETION_DIR="${ZDOTDIR:-$HOME}/.zsh/completions"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_TYPE="bash"
    COMPLETION_DIR="$HOME/.bash_completion.d"
else
    echo "Unsupported shell. Please manually install completion scripts."
    echo "Bash: source $SCRIPT_DIR/completion.bash"
    echo "Zsh: source $SCRIPT_DIR/completion.zsh"
    exit 1
fi

# Create completion directory
mkdir -p "$COMPLETION_DIR"

# Copy completion script
if [ "$SHELL_TYPE" = "zsh" ]; then
    cp "$SCRIPT_DIR/completion.zsh" "$COMPLETION_DIR/_wasteland"
    echo "Installed zsh completion to $COMPLETION_DIR/_wasteland"

    # Add to fpath if not already there
    if ! grep -q "$COMPLETION_DIR" "$HOME/.zshrc" 2>/dev/null; then
        echo "" >> "$HOME/.zshrc"
        echo "# Wasteland completion" >> "$HOME/.zshrc"
        echo "fpath=($COMPLETION_DIR \$fpath)" >> "$HOME/.zshrc"
        echo "autoload -Uz compinit && compinit" >> "$HOME/.zshrc"
        echo "Added completion to .zshrc"
    fi
else
    cp "$SCRIPT_DIR/completion.bash" "$COMPLETION_DIR/wasteland"
    echo "Installed bash completion to $COMPLETION_DIR/wasteland"

    # Add to bashrc if not already there
    if ! grep -q "$COMPLETION_DIR" "$HOME/.bashrc" 2>/dev/null; then
        echo "" >> "$HOME/.bashrc"
        echo "# Wasteland completion" >> "$HOME/.bashrc"
        echo "for f in $COMPLETION_DIR/wasteland; do source \"\$f\"; done" >> "$HOME/.bashrc"
        echo "Added completion to .bashrc"
    fi
fi

echo ""
echo "Installation complete!"
echo "Please restart your shell or run:"
if [ "$SHELL_TYPE" = "zsh" ]; then
    echo "  source $COMPLETION_DIR/_wasteland"
else
    echo "  source $COMPLETION_DIR/wasteland"
fi
