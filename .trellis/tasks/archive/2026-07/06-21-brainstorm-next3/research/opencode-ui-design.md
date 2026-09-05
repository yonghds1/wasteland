# Research: OpenCode UI Design - Single Chat Area Interface

- **Query**: How does OpenCode structure its single-chat-area TUI interface?
- **Scope**: External (GitHub: opencode-ai/opencode, charmbracelet/crush)
- **Date**: 2026-06-16

## Overview

OpenCode (now evolved into Crush by Charmbracelet) is a Go-based terminal AI coding agent built with the Bubble Tea framework. It implements a **single-chat-area interface** where all interactions happen in one main viewport, with dialogs overlaid on top rather than using separate pages.

**Repository**: https://github.com/opencode-ai/opencode (13k+ stars)
**Evolved to**: https://github.com/charmbracelet/crush (25k+ stars)
**Language**: Go with Bubble Tea TUI framework

## 1. TUI Structure

### Architecture Pattern

OpenCode uses a **page-based architecture with dialog overlays**:

```
+------------------------------------------+
|              Status Bar (1 line)          |
+------------------------------------------+
|                                            |
|     Main Chat Viewport (scrollable)        |
|     - Messages (user + assistant)          |
|     - Tool calls and results               |
|     - Working indicators                   |
|                                            |
+------------------------------------------+
|           Input Area (bottom)              |
+------------------------------------------+
```

### Core Components (from `internal/tui/`)

```
internal/tui/
├── tui.go                    # Main app model, dialog management
├── page/
│   ├── chat.go              # Chat page (primary)
│   └── logs.go              # Logs page (secondary)
├── components/
│   ├── chat/
│   │   ├── chat.go          # Chat container, header, logo
│   │   ├── editor.go        # Input editor
│   │   ├── list.go          # Message list/viewport
│   │   ├── message.go       # Message rendering (user, assistant, tools)
│   │   └── sidebar.go       # Session info, file changes
│   ├── dialog/              # Modal overlays
│   │   ├── help.go          # Keyboard shortcuts help
│   │   ├── commands.go      # Command palette (Ctrl+K)
│   │   ├── session.go       # Session switcher
│   │   ├── models.go        # Model selector
│   │   ├── permission.go    # Permission prompts
│   │   ├── filepicker.go    # File picker
│   │   └── theme.go         # Theme switcher
│   └── core/
│       └── status.go        # Status bar
├── layout/
│   ├── split.go             # Split pane layout
│   └── overlay.go           # Overlay system
└── theme/                   # Theme system
```

## 2. Single Chat Area Elements

### What's in the Chat Viewport

The chat area displays these content types in a **single scrollable viewport**:

1. **User Messages**
   - Rendered with left border (secondary color)
   - Supports markdown rendering
   - Shows file attachments as styled tags

2. **Assistant Messages**
   - Rendered with left border (primary color)
   - Markdown formatted content
   - Shows model name and response time on completion
   - Handles thinking/reasoning content display

3. **Tool Call Messages**
   - Collapsible tool call displays
   - Shows tool name, parameters, and results
   - Tools: Bash, Edit, View, Glob, Grep, Fetch, Write, Patch, Agent
   - Truncated results (max 10 lines for tool output)

4. **Working Indicators**
   - Spinner with status text: "Thinking...", "Generating...", "Building tool call...", "Waiting for tool response..."

5. **Empty State**
   - Logo and version display
   - Repository URL
   - Current working directory
   - LSP configuration info

### Key Code: Message Rendering (`message.go`)

```go
type uiMessageType int
const (
    userMessageType uiMessageType = iota
    assistantMessageType
    toolMessageType
)

func renderMessage(msg string, isUser bool, isFocused bool, width int, info ...string) string {
    // Renders message with left border
    // User: secondary color border
    // Assistant: primary color border
    // Applies markdown formatting
}
```

## 3. Configuration, Commands, and Conversations in One View

### Dialog Overlay System

OpenCode uses **modal dialogs** that overlay on the chat area rather than switching pages:

```
Main Chat Viewport
    ├── [Ctrl+K] Command Palette (overlay)
    ├── [Ctrl+O] Model Selector (overlay)
    ├── [Ctrl+A] Session Switcher (overlay)
    ├── [Ctrl+L] Logs Page (replaces view)
    ├── [?] Help Dialog (overlay)
    └── [Permission] Permission Prompt (overlay)
```

### Command Palette (`Ctrl+K`)

```go
type Command struct {
    ID          string
    Title       string
    Description string
    Handler     func(cmd Command) tea.Cmd
}
```

Features:
- Fuzzy search through commands
- Keyboard navigation (↑/↓, Enter to select)
- Esc to close

### Session Management (`Ctrl+A`)

- List of sessions with titles
- Navigate with ↑/↓ or j/k
- Enter to select, Esc to close

### Model Selection (`Ctrl+O`)

- Grid of providers and models
- Navigate with arrow keys
- Shows current selection

### Key Dialog Implementation Pattern

```go
// From tui.go - Dialog state management
type appModel struct {
    // Dialog states
    showHelp bool
    help     dialog.HelpCmp

    showSessionDialog bool
    sessionDialog     dialog.SessionDialog

    showCommandDialog bool
    commandDialog     dialog.CommandDialog

    showModelDialog bool
    modelDialog     dialog.ModelDialog

    showPermission bool
    permissions    dialog.PermissionDialogCmp
    // ...
}
```

## 4. Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Quit application |
| `Ctrl+?` / `?` | Toggle help dialog |
| `Ctrl+L` | View logs |
| `Ctrl+A` | Switch session |
| `Ctrl+K` | Command dialog |
| `Ctrl+O` | Model selection dialog |
| `Esc` | Close current overlay/dialog |

### Chat Page Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | Create new session |
| `Ctrl+X` | Cancel current operation |
| `i` | Focus editor (when not in writing mode) |
| `Esc` | Exit writing mode, focus messages |

### Editor Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` / `Enter` | Send message |
| `Ctrl+E` | Open external editor |
| `Esc` | Blur editor, focus messages |

### Message Navigation

| Shortcut | Action |
|----------|--------|
| `PgUp` / `b` | Page up |
| `PgDown` / `f` | Page down |
| `Ctrl+U` | Half page up |
| `Ctrl+D` | Half page down |

### Permission Dialog

| Shortcut | Action |
|----------|--------|
| `←`/`→` / `Tab` | Switch options |
| `Enter` / `Space` | Confirm selection |
| `a` | Allow permission |
| `A` | Allow for session |
| `d` | Deny permission |

## 5. Content Display Patterns

### Message Types and Rendering

```go
// User messages - blue/secondary border
renderUserMessage(msg, isFocused, width, position)

// Assistant messages - green/primary border
renderAssistantMessage(msg, msgIndex, allMessages, messagesService, 
                      focusedUIMessageId, isSummary, width, position)

// Tool messages - inline with collapsible details
renderToolMessage(toolCall, allMessages, messagesService, 
                  focusedUIMessageId, false, width, i+1)
```

### Tool Call Display

Each tool has specific rendering:

```go
func toolName(name string) string {
    switch name {
    case agent.AgentToolName: return "Task"
    case tools.BashToolName: return "Bash"
    case tools.EditToolName: return "Edit"
    case tools.ViewToolName: return "View"
    case tools.GlobToolName: return "Glob"
    case tools.GrepToolName: return "Grep"
    // ...
    }
}
```

Tool results are truncated and formatted:
- **Bash**: Code block with syntax highlighting
- **Edit**: Diff view with additions/removals
- **View**: File content with line numbers
- **Glob/Grep**: List format
- **Fetch**: Markdown or text block

### Diff Rendering

```go
case tools.EditToolName:
    metadata := tools.EditResponseMetadata{}
    json.Unmarshal([]byte(response.Metadata), &metadata)
    truncDiff := truncateHeight(metadata.Diff, maxResultHeight)
    formattedDiff, _ := diff.FormatDiff(truncDiff, diff.WithTotalWidth(width))
    return formattedDiff
```

### Status Bar

Shows at the bottom with:
- Current model name
- Session info
- Token usage (if available)
- Working status

## 6. Layout System

### Split Pane Layout

OpenCode uses a flexible split pane system:

```go
type splitPaneLayout struct {
    width, height    int
    ratio            float64  // left/right ratio
    verticalRatio    float64  // top/bottom ratio
    rightPanel       Container
    leftPanel        Container
    bottomPanel      Container
}
```

### Chat Page Layout

The chat page typically uses:
- **Left panel**: Sidebar (session info, file changes) - optional
- **Right panel**: Main chat viewport (messages + editor)
- **Bottom panel**: Input editor

### Responsive Design

```go
func (s *splitPaneLayout) SetSize(width, height int) tea.Cmd {
    s.width = width
    s.height = height
    // Calculates panel sizes based on ratios
}
```

## 7. Key Design Patterns

### 1. Single Viewport Pattern
All messages flow in one scrollable area. No separate pages for different message types.

### 2. Dialog Overlay Pattern
Configuration, commands, and settings appear as overlays without leaving the chat context.

### 3. Focus Management
Clear focus states between:
- Message list (scrolling)
- Editor (typing)
- Dialogs (modal interaction)

### 4. Real-time Updates
Uses Bubble Tea's `tea.Msg` system for:
- New messages from AI
- Tool call progress
- Session updates
- File change tracking

### 5. Caching
```go
type cacheItem struct {
    width   int
    content []uiMessage
}
// Caches rendered messages by ID and width
```

## External References

- [Bubble Tea Framework](https://github.com/charmbracelet/bubbletea) - Core TUI framework
- [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Styling library
- [OpenCode Repository](https://github.com/opencode-ai/opencode) - Original project
- [Crush Repository](https://github.com/charmbracelet/crush) - Current maintained fork

## Caveats / Not Found

1. **Crush Differences**: The Crush fork may have additional UI changes not covered here
2. **Theme System**: Multiple themes available (Catppuccin, Dracula, Gruvbox, Monokai, etc.) but details not fully explored
3. **LSP Integration**: How LSP diagnostics integrate with the chat display not fully documented
4. **External Editor**: The `Ctrl+E` external editor integration details not explored
