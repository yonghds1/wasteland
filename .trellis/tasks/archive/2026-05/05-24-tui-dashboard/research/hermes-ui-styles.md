# Hermes Agent TUI UI Styles Research

> Source: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
> Files analyzed: `agent/display.py`, `hermes_cli/colors.py`, `hermes_cli/skin_engine.py`, `hermes_cli/banner.py`, `cli.py`, `tools/registry.py`

---

## 1. Hermes Color Scheme (Default Skin)

### 1.1 Core ANSI Color Class (`hermes_cli/colors.py`)

Hermes provides a shared `Colors` class with basic ANSI escape codes:

```python
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"

def color(text: str, *codes) -> str:
    """Apply color codes to text (only when color output is appropriate)."""
    if not should_use_color():
        return text
    return "".join(codes) + text + Colors.RESET
```

Color output is gated by `should_use_color()` which respects:
- `NO_COLOR` environment variable (https://no-color.org/)
- `TERM=dumb`
- TTY check (`sys.stdout.isatty()`)

### 1.2 Full Skin Color Scheme (`hermes_cli/skin_engine.py`)

Hermes uses a **data-driven skin system** where all visual settings are defined as hex colors in a `SkinConfig` dataclass. The **default skin** (gold/kawaii theme) uses this palette:

```python
# DEFAULT SKIN - "Classic Hermes — gold and kawaii"
"default": {
    "colors": {
        "banner_border": "#CD7F32",       # Bronze — panel borders
        "banner_title": "#FFD700",        # Gold — panel title, headers
        "banner_accent": "#FFBF00",       # Amber — section headers
        "banner_dim": "#B8860B",          # Dark goldenrod — dim/muted text
        "banner_text": "#FFF8DC",         # Cornsilk — body text
        "ui_accent": "#FFBF00",          # Amber — general UI accent
        "ui_label": "#DAA520",           # Goldenrod — UI labels
        "ui_ok": "#4caf50",             # Green — success indicators
        "ui_error": "#ef5350",          # Red — error indicators
        "ui_warn": "#ffa726",           # Orange — warning indicators
        "prompt": "#FFF8DC",            # Cornsilk — prompt text
        "input_rule": "#CD7F32",        # Bronze — input area horizontal rule
        "response_border": "#FFD700",   # Gold — response box border
        "status_bar_bg": "#1a1a2e",     # Dark navy — status bar background
        "session_label": "#DAA520",     # Goldenrod — session label
        "session_border": "#8B8682",    # Warm gray — session ID dim
    },
}
```

### 1.3 Additional Skin Themes

Hermes ships **8 built-in skins**, each with a complete color palette:

| Skin | Description | Primary Colors |
|------|-------------|---------------|
| `default` | Gold and kawaii | `#FFD700`, `#CD7F32`, `#FFBF00` |
| `ares` | Crimson and bronze war-god | `#9F1C1C`, `#C7A96B`, `#DD4A3A` |
| `mono` | Clean grayscale | `#555555`, `#e6edf3`, `#aaaaaa` |
| `slate` | Cool blue developer-focused | `#4169e1`, `#7eb8f6`, `#8EA8FF` |
| `daylight` | Light background, dark text, blue accents | `#2563EB`, `#0F172A`, `#1D4ED8` |
| `warm-lightmode` | Warm brown/gold for light terminals | `#8B6914`, `#5C3D11`, `#8B4513` |
| `poseidon` | Ocean blue and seafoam | `#2A6FB9`, `#A9DFFF`, `#5DB8F5` |
| `charizard` | Volcanic burnt orange and ember | `#C75B1D`, `#FFD39A`, `#F29C38` |
| `sisyphus` | Austere grayscale with persistence | `#B7B7B7`, `#F5F5F5`, `#E7E7E7` |

### 1.4 Full Color Key Schema

Every skin can define these color keys (all optional, missing values inherit from `default`):

```yaml
colors:
  # Banner (welcome screen)
  banner_border: "#CD7F32"            # Panel border color
  banner_title: "#FFD700"             # Panel title text color
  banner_accent: "#FFBF00"            # Section headers
  banner_dim: "#B8860B"              # Dim/muted text (separators, labels)
  banner_text: "#FFF8DC"             # Body text (tool names, skill names)

  # UI elements
  ui_accent: "#FFBF00"               # General UI accent
  ui_label: "#DAA520"                # UI labels
  ui_ok: "#4caf50"                   # Success indicators
  ui_error: "#ef5350"                # Error indicators
  ui_warn: "#ffa726"                 # Warning indicators

  # Input
  prompt: "#FFF8DC"                  # Prompt text color
  input_rule: "#CD7F32"             # Input area horizontal rule

  # Response box
  response_border: "#FFD700"         # Response box border (ANSI)

  # Status bar (TUI)
  status_bar_bg: "#1a1a2e"           # Status bar background
  status_bar_text: "#C0C0C0"         # Status bar default text
  status_bar_strong: "#FFD700"       # Status bar highlighted text
  status_bar_dim: "#8B8682"          # Status bar separators/muted text
  status_bar_good: "#8FBC8F"         # Healthy context usage
  status_bar_warn: "#FFD700"         # Warning context usage
  status_bar_bad: "#FF8C00"          # High context usage
  status_bar_critical: "#FF6B6B"     # Critical context usage

  # Session
  session_label: "#DAA520"           # Session label color
  session_border: "#8B8682"          # Session ID dim color

  # TUI extras
  voice_status_bg: "#1a1a2e"        # TUI voice status background
  selection_bg: "#333355"           # TUI mouse-selection highlight
  completion_menu_bg: "#1a1a2e"      # Completion menu background
  completion_menu_current_bg: "#333355"  # Active completion row
  completion_menu_meta_bg: "#1a1a2e"     # Completion meta column
  completion_menu_meta_current_bg: "#333355"  # Active completion meta
```

### 1.5 Hex-to-ANSI Conversion

Hermes converts hex colors to true-color ANSI escapes at runtime:

```python
def _hex_to_ansi(hex_color: str, *, bold: bool = False) -> str:
    """Convert a hex color like '#268bd2' to a true-color ANSI escape."""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    prefix = "1;" if bold else ""
    return f"\033[{prefix}38;2;{r};{g};{b}m"
```

Pre-built ANSI shortcuts used in `cli.py`:

```python
_GOLD = "\033[1;38;2;255;215;0m"     # True-color #FFD700 bold
_ACCENT_ANSI_DEFAULT = "\033[1;38;2;255;215;0m"  # Same, used as fallback
_BOLD = "\033[1m"
_DIM = "\033[2m"
_RST = "\033[0m"
```

Skin-aware lazy ANSI (`_SkinAwareAnsi` class):

```python
class _SkinAwareAnsi:
    """Lazy ANSI escape that resolves from the skin engine on first use."""
    def __init__(self, skin_key: str, fallback_hex: str = "#FFD700", *, bold: bool = False):
        self._skin_key = skin_key
        self._fallback_hex = fallback_hex
        self._bold = bold
        self._cached: str | None = None

    def __str__(self) -> str:
        if self._cached is None:
            from hermes_cli.skin_engine import get_active_skin
            self._cached = _hex_to_ansi(
                get_active_skin().get_color(self._skin_key, self._fallback_hex),
                bold=self._bold,
            )
        return self._cached

# Usage:
_ACCENT = _SkinAwareAnsi("response_border", "#FFD700", bold=True)
_DIM = "\x1b[2;3m"  # ANSI dim+italic for thinking text
```

### 1.6 Diff Colors

Inline diff display uses skin-aware ANSI colors with dark-mode defaults:

```python
# Defaults that work on dark terminals
dim = "\033[38;2;150;150;150m"          # Gray — context lines
file_c = "\033[38;2;180;160;255m"       # Purple — file header
hunk = "\033[38;2;120;120;140m"         # Gray — hunk header
minus = "\033[38;2;255;255;255;48;2;120;20;20m"   # White on dark red
plus = "\033[38;2;255;255;255;48;2;20;90;20m"     # White on dark green
```

These are resolved lazily from the active skin:
- `dim` ← `banner_dim`
- `file_c` ← `session_label`
- `hunk` ← `session_border`
- `minus` background ← derived from `ui_error` (halved RGB)
- `plus` background ← derived from `ui_ok` (halved RGB)

---

## 2. Hermes Tool Icon/Emoji Mapping

### 2.1 Tool Completion Line Format

Hermes displays tool calls as one-line status items with this format:

```
┊ {emoji} {verb:9} {detail}  {duration}
```

Where:
- `┊` is the configurable `tool_prefix` character (skin-dependent, default `┊`)
- `{emoji}` is the tool-specific emoji
- `{verb:9}` is a left-aligned 9-character verb (e.g., "search   ", "write   ")
- `{detail}` is a truncated preview of the tool's primary argument
- `{duration}` is formatted as `X.Xs`

### 2.2 Complete Tool Emoji and Verb Mapping

Extracted from `agent/display.py::get_cute_tool_message()`:

| Tool | Emoji | Verb | Detail Example |
|------|-------|------|----------------|
| `web_search` | 🔍 | search | query text (42 chars) |
| `web_extract` | 📄 | fetch | domain name |
| `web_crawl` | 🕸️ | crawl | domain name |
| `terminal` | 💻 | $ | command (42 chars) |
| `process` | ⚙️ | proc | action + session_id |
| `read_file` | 📖 | read | file path (35 chars) |
| `write_file` | ✍️ | write | file path (35 chars) |
| `patch` | 🔧 | patch | file path (35 chars) |
| `search_files` | 🔎 | find/grep | pattern (35 chars) |
| `browser_navigate` | 🌐 | navigate | domain name |
| `browser_snapshot` | 📸 | snapshot | "full" or "compact" |
| `browser_click` | 👆 | click | ref number |
| `browser_type` | ⌨️ | type | typed text (30 chars) |
| `browser_scroll` | ↓↑→← | scroll | direction |
| `browser_back` | ◀️ | back | — |
| `browser_press` | ⌨️ | press | key name |
| `browser_get_images` | 🖼️ | images | "extracting" |
| `browser_vision` | 👁️ | vision | "analyzing page" |
| `todo` | 📋 | plan | task count / progress |
| `session_search` | 🔍 | recall | query (35 chars) |
| `memory` | 🧠 | memory | +/-/~ prefix + target |
| `skills_list` | 📚 | skills | "list {category}" |
| `skill_view` | 📚 | skill | skill name |
| `image_generate` | 🎨 | create | prompt (35 chars) |
| `text_to_speech` | 🔊 | speak | text (30 chars) |
| `vision_analyze` | 👁️ | vision | question (30 chars) |
| `mixture_of_agents` | 🧠 | reason | prompt (30 chars) |
| `send_message` | 📨 | send | target + message |
| `cronjob` | ⏰ | cron | action + label |
| `execute_code` | 🐍 | exec | first code line |
| `delegate_task` | 🔀 | delegate | task count or goal |
| *(default)* | ⚡ | {tool_name} | auto-generated preview |

### 2.3 Per-Tool Emoji Override via Skin

Skins can override any tool's emoji:

```yaml
tool_emojis:
  terminal: "⚔"           # Override terminal tool emoji
  web_search: "🔮"        # Override web_search tool emoji
```

Resolution order:
1. Active skin's `tool_emojis` overrides
2. Tool registry's per-tool `emoji` field (set at `registry.register()` time)
3. Hardcoded fallback `⚡`

### 2.4 Tool Preview Extraction

Each tool has a "primary argument" mapping for generating short previews:

```python
primary_args = {
    "terminal": "command", "web_search": "query", "web_extract": "urls",
    "read_file": "path", "write_file": "path", "patch": "path",
    "search_files": "pattern", "browser_navigate": "url",
    "browser_click": "ref", "browser_type": "text",
    "image_generate": "prompt", "text_to_speech": "text",
    "vision_analyze": "question", "mixture_of_agents": "user_prompt",
    "skill_view": "name", "skills_list": "category",
    "cronjob": "action",
    "execute_code": "code", "delegate_task": "goal",
    "clarify": "question", "skill_manage": "name",
}
```

Fallback key search order: `query`, `text`, `command`, `path`, `name`, `prompt`, `code`, `goal`

---

## 3. Hermes CLI Interaction Style Examples

### 3.1 Spinner System (KawaiiSpinner)

Hermes uses an animated spinner with kawaii faces during API calls:

**Spinner frame sets:**

```python
SPINNERS = {
    'dots':    ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    'bounce':  ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
    'grow':    ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
    'arrows':  ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
    'star':    ['✶', '✷', '✸', '✹', '✺', '✹', '✸', '✷'],
    'moon':    ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
    'pulse':   ['◜', '◠', '◝', '◞', '◡', '◟'],
    'brain':   ['🧠', '💭', '💡', '✨', '💫', '🌟', '💡', '💭'],
    'sparkle': ['⁺', '˚', '*', '✧', '✦', '✧', '*', '˚'],
}
```

**Kawaii faces (default skin):**

```python
KAWAII_WAITING = [
    "(｡◕‿◕｡)", "(◕‿◕✿)", "٩(◕‿◕｡)۶", "(✿◠‿◠)", "( ˘▽˘)っ",
    "♪(´ε` )", "(◕ᴗ◕✿)", "ヾ(＾∇＾)", "(≧◡≦)", "(★ω★)",
]

KAWAII_THINKING = [
    "(｡•́︿•̀｡)", "(◔_◔)", "(¬‿¬)", "( •_•)>⌐■-■", "(⌐■_■)",
    "(´･_･`)", "◉_◉", "(°ロ°)", "( ˘⌣˘)♡", "ヽ(>∀<☆)☆",
    "٩(๑❛ᴗ❛๑)۶", "(⊙_⊙)", "(¬_¬)", "( ͡° ͜ʖ ͡°)", "ಠ_ಠ",
]
```

**Thinking verbs (default skin):**

```python
THINKING_VERBS = [
    "pondering", "contemplating", "musing", "cogitating", "ruminating",
    "deliberating", "mulling", "reflecting", "processing", "reasoning",
    "analyzing", "computing", "synthesizing", "formulating", "brainstorming",
]
```

**Spinner "wings" decoration** (from Ares skin as example):

```python
"wings": [
    ["⟪⚔", "⚔⟫"],
    ["⟪▲", "▲⟫"],
    ["⟪╸", "╺⟫"],
    ["⟪⛨", "⛨⟫"],
]
# Rendered as: ⟪⚔ ⠋ forging plans ⚔⟫ (3.2s)
```

**Spinner display format:**

```
  {frame} {message} ({elapsed:.1f}s)          # Without wings
  {left} {frame} {message} {right} ({elapsed:.1f}s)  # With wings
```

### 3.2 Session Start/End Visual Cues

**Welcome banner** uses Rich Panel with skin-aware colors:

```python
# Branding strings (from skin config)
"agent_name": "Hermes Agent"
"welcome": "Welcome to Hermes Agent! Type your message or /help for commands."
"goodbye": "Goodbye! ⚕"      # Shown on exit
```

**ASCII art logo** is rendered with Rich markup containing inline colors:

```
[bold #FFD700]██╗  ██╗███████╗██████╗ ███╗   ███╗███████╗███████╗[/]
[bold #FFD700]██║  ██║██╔════╝██╔══██╗████╗ ████║██╔════╝██╔════╝[/]
[#FFBF00]███████║█████╗  ██████╔╝██╔████╔██║█████╗  ███████╗█████╗[/]
...
```

Each skin can provide its own `banner_logo` and `banner_hero` (Unicode pixel art).

**Goodbye message** uses the skin's `goodbye` branding string, e.g.:
- Default: `Goodbye! ⚕`
- Ares: `Farewell, warrior! ⚔`
- Poseidon: `Fair winds! Ψ`

### 3.3 Prompt Style

**Prompt symbol** is skin-configurable:

```python
# Default skin
"prompt_symbol": "❯"     # Rendered as "❯ " (with trailing space)

# Ares skin
"prompt_symbol": "⚔"

# Poseidon skin
"prompt_symbol": "Ψ"

# Charizard skin
"prompt_symbol": "✦"
```

### 3.4 Tool Call Display Format

During tool execution, Hermes shows:

1. **Spinner line** while the tool runs:
   ```
   ⠋ 🔍 searching... (2.1s)
   ```

2. **Completion line** after the tool finishes:
   ```
   ┊ 🔍 search    "what is Python"  2.1s
   ```

3. **Failure indicator** — red ANSI color prefix + error suffix:
   ```
   ┊ 💻 $         npm install  5.3s [exit 1]
   ┊ 📖 read      /missing.py  0.2s [File not found: missing.py]
   ┊ 🧠 memory    +notes: "..."  0.1s [full]
   ```

4. **Inline diff preview** for file mutations:
   ```
     ┊ review diff
   a/src/main.py → b/src/main.py
   @@ -10,3 +10,4 @@
   {dim} context line
   {red-bg}- removed line
   {green-bg}+ added line
   ```

### 3.5 Response Box

Assistant responses are rendered inside a bordered panel:

- **Border color**: `response_border` from skin (default `#FFD700`)
- **Header label**: skin's `response_label` (default ` ⚕ Hermes `)
- **Content**: 4-space indent (`_STREAM_PAD = "    "`)
- **Streaming**: tokens appear inline as they arrive, with Markdown rendering

### 3.6 Status Bar (TUI)

The status bar uses prompt_toolkit's formatted text with skin-derived styles:

```python
# Style mapping
"status-bar": f"bg:{status_bg} {status_text}",               # Default text
"status-bar-strong": f"bg:{status_bg} {status_strong} bold",  # Highlighted
"status-bar-dim": f"bg:{status_bg} {status_dim}",             # Muted
"status-bar-good": f"bg:{status_bg} {status_good} bold",      # Healthy
"status-bar-warn": f"bg:{status_bg} {status_warn} bold",      # Warning
"status-bar-bad": f"bg:{status_bg} {status_bad} bold",        # High usage
"status-bar-critical": f"bg:{status_bg} {status_critical} bold",  # Critical
```

### 3.7 Help Command Header

```python
# Default skin
"help_header": "(^_^)? Available Commands"

# Ares skin
"help_header": "(⚔) Available Commands"

# Mono skin
"help_header": "[?] Available Commands"
```

### 3.8 Light/Dark Mode Detection

Hermes auto-detects light/dark terminal mode and remaps colors:

**Detection priority:**
1. `HERMES_LIGHT` / `HERMES_TUI_LIGHT` env var (explicit override)
2. `HERMES_TUI_THEME=light|dark`
3. `HERMES_TUI_BACKGROUND=#RRGGBB` (explicit bg hint)
4. `COLORFGBG` env (xterm/Konsole/urxvt — bg slot 7/15 = light)
5. OSC 11 query (`\x1b]11;?\x1b\\`) — ask the terminal directly
6. Default: assume dark

When light mode is detected, `SkinConfig.get_color()` is monkey-patched to remap near-white colors (e.g., `#FFF8DC`) to darker equivalents.

### 3.9 Skin-Aware prompt_toolkit Style Overrides

```python
def get_prompt_toolkit_style_overrides() -> Dict[str, str]:
    return {
        "input-area": "",                                          # Terminal default fg/bg
        "placeholder": f"{dim} italic",                           # Dim italic
        "prompt": prompt,                                          # Skin prompt color
        "prompt-working": f"{dim} italic",
        "hint": f"{dim} italic",
        "status-bar": f"bg:{status_bg} {status_text}",
        "status-bar-strong": f"bg:{status_bg} {status_strong} bold",
        "status-bar-dim": f"bg:{status_bg} {status_dim}",
        "status-bar-good": f"bg:{status_bg} {status_good} bold",
        "status-bar-warn": f"bg:{status_bg} {status_warn} bold",
        "status-bar-bad": f"bg:{status_bg} {status_bad} bold",
        "status-bar-critical": f"bg:{status_bg} {status_critical} bold",
        "input-rule": input_rule,
        "image-badge": f"{label} bold",
        "completion-menu": f"bg:{menu_bg} {text}",
        "completion-menu.completion": f"bg:{menu_bg} {text}",
        "completion-menu.completion.current": f"bg:{menu_current_bg} {title}",
        "clarify-border": input_rule,
        "clarify-title": f"{title} bold",
        "clarify-question": f"{text} bold",
        "clarify-choice": dim,
        "clarify-selected": f"{title} bold",
        "sudo-prompt": f"{error} bold",
        "approval-title": f"{warn} bold",
        "approval-desc": f"{text} bold",
        "approval-cmd": f"{dim} italic",
        "voice-status": f"bg:{voice_bg} {label}",
        "voice-status-recording": f"bg:{voice_bg} {error} bold",
    }
```

---

## 4. Architecture Patterns Worth Noting

### 4.1 Data-Driven Skin System

Hermes' skin engine is fully **YAML-driven** — no code changes needed to add new themes:

```
~/.hermes/skins/<name>.yaml
```

The `SkinConfig` dataclass:

```python
@dataclass
class SkinConfig:
    name: str
    description: str = ""
    colors: Dict[str, str] = field(default_factory=dict)
    spinner: Dict[str, Any] = field(default_factory=dict)
    branding: Dict[str, str] = field(default_factory=dict)
    tool_prefix: str = "┊"
    tool_emojis: Dict[str, str] = field(default_factory=dict)
    banner_logo: str = ""    # Rich-markup ASCII art
    banner_hero: str = ""    # Rich-markup hero art
```

Skin inheritance: every skin starts from the `default` skin and only overrides what it needs.

### 4.2 Skin Resolution at Runtime

```python
def get_active_skin() -> SkinConfig:
    """Get the currently active skin config (cached)."""
    # Cached after first load, invalidated on /skin switch

def set_active_skin(name: str) -> SkinConfig:
    """Switch the active skin. Returns the new SkinConfig."""
    # Hot-swappable at runtime via /skin command
```

### 4.3 Lazy Color Resolution

Colors are resolved lazily to avoid circular imports and to support hot-swapping:

```python
class _SkinAwareAnsi:
    """Lazy ANSI escape that resolves from the skin engine on first use."""
    def __str__(self) -> str:
        if self._cached is None:
            self._cached = _hex_to_ansi(
                get_active_skin().get_color(self._skin_key, self._fallback_hex),
                bold=self._bold,
            )
        return self._cached

    def reset(self) -> None:
        """Clear cache so the next access re-reads the skin."""
        self._cached = None
```

### 4.4 Tool Prefix Character

The `tool_prefix` character is skin-configurable and used as a visual marker for tool output lines:

- Default: `┊` (box drawings light triple dash vertical)
- Ares: `╎` (box drawings light quadruple dash vertical)
- Daylight/Poseidon: `│` (box drawings light vertical)

---

## 5. Specific ANSI Color Codes and Configuration Reference

### 5.1 Direct ANSI Codes Used

| Code | Purpose | Source |
|------|---------|--------|
| `\033[0m` | Reset all attributes | `Colors.RESET` |
| `\033[1m` | Bold | `Colors.BOLD` |
| `\033[2m` | Dim | `Colors.DIM` |
| `\033[2;3m` | Dim + Italic (thinking text) | `cli.py` |
| `\033[31m` | Red (failure indicators) | `Colors.RED` |
| `\033[32m` | Green | `Colors.GREEN` |
| `\033[33m` | Yellow | `Colors.YELLOW` |
| `\033[34m` | Blue | `Colors.BLUE` |
| `\033[35m` | Magenta | `Colors.MAGENTA` |
| `\033[36m` | Cyan | `Colors.CYAN` |
| `\033[1;38;2;255;215;0m` | Bold true-color gold (#FFD700) | `banner.py` |
| `\033[38;2;{R};{G};{B}m` | True-color foreground | `_hex_to_ansi()` |
| `\033[48;2;{R};{G};{B}m` | True-color background | diff rendering |

### 5.2 Skin Configuration YAML Template

```yaml
# ~/.hermes/skins/mytheme.yaml
name: mytheme
description: My custom theme

colors:
  banner_border: "#CD7F32"
  banner_title: "#FFD700"
  banner_accent: "#FFBF00"
  banner_dim: "#B8860B"
  banner_text: "#FFF8DC"
  ui_accent: "#FFBF00"
  ui_label: "#DAA520"
  ui_ok: "#4caf50"
  ui_error: "#ef5350"
  ui_warn: "#ffa726"
  prompt: "#FFF8DC"
  input_rule: "#CD7F32"
  response_border: "#FFD700"
  status_bar_bg: "#1a1a2e"
  status_bar_text: "#C0C0C0"
  status_bar_strong: "#FFD700"
  status_bar_dim: "#8B8682"
  status_bar_good: "#8FBC8F"
  status_bar_warn: "#FFD700"
  status_bar_bad: "#FF8C00"
  status_bar_critical: "#FF6B6B"
  session_label: "#DAA520"
  session_border: "#8B8682"

spinner:
  waiting_faces: ["(⚔)", "(⛨)"]
  thinking_faces: ["(⌁)", "(<>)"]
  thinking_verbs: ["forging", "plotting"]
  wings: [["⟪⚔", "⚔⟫"]]

branding:
  agent_name: "My Agent"
  welcome: "Welcome!"
  goodbye: "Bye! ⚕"
  response_label: " ⚕ Agent "
  prompt_symbol: "❯"
  help_header: "(^_^)? Commands"

tool_prefix: "┊"
tool_emojis:
  terminal: "⚔"
  web_search: "🔮"
```

### 5.3 Config Integration

Skin is selected via `config.yaml`:

```yaml
display:
  skin: default    # or: ares, mono, slate, daylight, warm-lightmode, poseidon, charizard, sisyphus
```

Or switched at runtime with the `/skin` command.
