# CLI File Display Practices Research

> Research findings on how CLI tools and AI coding assistants handle displaying file contents in terminal environments.

---

## Executive Summary

**Key Finding**: CLI tools use a variety of strategies to display file contents, with common patterns including:
- Line numbers for reference
- Truncation with hints for large files
- Pagination for interactive viewing
- Syntax highlighting when possible
- Context-aware display (showing relevant sections)

---

## 1. Traditional CLI Tools

### 1.1 `cat` - Basic File Display

**Characteristics**:
- Outputs entire file content to stdout
- Optional line numbers (`cat -n`)
- No built-in pagination or truncation
- Simple, raw output

**Example output**:
```
     1  Line 1: This is a test file
     2  Line 2: With multiple lines
     3  Line 3: To demonstrate formatting
```

**Use case**: Simple concatenation, piping to other tools

---

### 1.2 `head` and `tail` - Partial File Display

**Characteristics**:
- `head -n N`: Show first N lines (default 10)
- `tail -n N`: Show last N lines (default 10)
- Used for quick inspection of large files
- Common pattern: `head -n 20 file.txt`

**Example**:
```bash
$ head -n 5 /tmp/test.txt
Line 1: This is a test file
Line 2: With multiple lines
Line 3: To demonstrate formatting
Line 4: This file has content
Line 5: That could be large
```

**Use case**: Preview, log inspection, quick validation

---

### 1.3 `bat` - Enhanced File Display

**Characteristics** (from GitHub README):
- Syntax highlighting for many languages
- Git integration showing modifications
- Line numbers by default
- Automatic paging for large files
- Non-printable character display
- Works as `cat` replacement when piped

**Key features**:
```bash
# Basic usage with syntax highlighting and line numbers
bat README.md

# Show only line numbers (no other decorations)
bat -n main.rs

# Restrict line range for faster loading
bat --line-range=:500 large_file.txt

# Force colorized output (for piping to fzf)
bat --color=always --style=numbers --line-range=:500 {}

# Plain output (no decorations)
bat -p main.cpp
```

**Output format**:
```
   1 │ fn main() {
   2 │     println!("Hello, world!");
   3 │ }
```

**Automatic paging behavior**:
- Pipes to pager (e.g., `less`) if output exceeds screen height
- Falls back to plain output when piped to another process
- Respects `--paging=never` for `cat`-like behavior

---

### 1.4 `ripgrep` (rg) - Context Display

**Characteristics**:
- Shows matching lines with optional context
- Context flags: `-A N` (after), `-B N` (before), `-C N` (both)
- Context separator: `--` by default
- Line numbers and file paths

**Example**:
```bash
$ rg -C 2 "pattern" file.txt
file.txt
5-Line before
6-Line before
7:Matching line
8-Line after
9-Line after
--
15-Another section
16:Another match
```

**Context separator customization**:
```bash
rg --context-separator="..." pattern file.txt
```

**Use case**: Search results with surrounding context for understanding

---

## 2. Terminal Width and Formatting

### 2.1 Terminal Width Constraints

**Standard assumptions**:
- Default terminal width: 80 columns
- Modern terminals: often 120+ columns
- Safe assumption: 80 characters for compatibility

**From this project's `terminal-theme.ts`**:
```typescript
const DEFAULT_TERMINAL_COLUMNS = 80;
const MIN_PANEL_WIDTH = 24;
const MAX_PANEL_WIDTH = 72;

function resolvePanelWidth(columns?: number): number {
  const terminalColumns = resolveTerminalWidth(columns);
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, terminalColumns - 8));
}
```

**Text wrapping strategy**:
```typescript
function wrapLine(line: string, width: number): string {
  if (line.length === 0) return "";

  const chars = Array.from(line);
  const chunks: string[] = [];

  for (let index = 0; index < chars.length; index += width) {
    chunks.push(chars.slice(index, index + width).join(""));
  }

  return chunks.join("\n");
}
```

---

### 2.2 Indentation and Gutter

**Common pattern**: Use a gutter or prefix for nested content

**From this project**:
```typescript
export const PANEL_GUTTER = `${paint("│", ANSI.dim, ANSI.gray)}  `;

function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
```

**Visual effect**:
```
tool  result read-file
      │ 1: First line of file
      │ 2: Second line of file
      │ 3: Third line of file
```

---

## 3. Current Tool Output Display in This Project

### 3.1 Tool Result Event Structure

**From `event-types.ts`**:
```typescript
type RuntimeEvent =
  | {
      type: "tool_result";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      status: "success";
      output: string;  // Full output string
    }
```

**Current display behavior** (from `terminal-renderer.ts`):
```typescript
case "tool_result": {
  if (style === "interactive") {
    writeInteractiveBlock(stdout, {
      label: "tool",
      content: [
        `result ${event.toolName}`,
        event.output.length > 0 ? event.output : "(no output)"
      ].join("\n"),
      styles: [ANSI.bold, ANSI.green],
      width: panelWidth,
    });
    break;
  }
  // Classic style
  stdout.write(`tool[${event.turn}]> result ${event.toolName}: ${event.output}\n`);
  break;
}
```

### 3.2 Current Read File Tool

**From `read-file.ts`**:
```typescript
async execute(input, context) {
  const targetPath = resolveReadablePath(context.cwd, input.path);

  if (!targetPath) {
    return {
      status: "error",
      error: "read-file 需要一个位于当前工作目录内的相对路径。",
    };
  }

  try {
    const content = await readFile(targetPath, "utf8");

    return {
      status: "success",
      output: content,  // Returns entire file content
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

**Current behavior**: Returns entire file content with no truncation or formatting.

---

## 4. AI Coding Assistant Patterns

### 4.1 Claude Code (This Project)

**Read tool behavior** (from system description):
- Reads files and returns content with line numbers
- Uses `cat -n` format (line numbers starting at 1)
- Can read specific page ranges for PDFs
- Can read Jupyter notebooks
- Has a default limit of 2000 lines
- Can specify `offset` and `limit` for large files

**Format example**:
```
     1  function example() {
     2    return "hello";
     3  }
```

### 4.2 Common AI Assistant Patterns

Based on analysis of streaming-tool-calling-practices.md:

**Text display**:
- Streaming for text responses (character-by-character)
- Wrapped to terminal width
- Often with syntax highlighting

**Tool output display**:
- Complete tool results shown after execution
- May truncate very long outputs
- Often shows "..." or line count hints for truncated content
- File reads typically show line numbers

---

## 5. Recommendations for Tool Output Display

### 5.1 Principles

1. **Dual audience**: Output must serve both LLM (for context) and user (for visibility)
2. **Terminal constraints**: Assume 80-char width, limited vertical space
3. **Readability**: Line numbers, clear formatting, appropriate truncation
4. **Information density**: Show what's relevant, hide what's not

### 5.2 Proposed Strategies

#### Strategy A: Line Numbers + Smart Truncation

**Format**:
```
tool  result read-file
      │ 1: import { readFile } from "node:fs/promises";
      │ 2: import { relative, resolve } from "node:path";
      │ 3:
      │ 4: import type { AgentTool } from "./tool-types.js";
      │ ... (50 lines hidden)
      │ 55: }
```

**Implementation approach**:
1. Add line numbers to each line
2. If file > N lines, show first N/2 and last N/2 with hint
3. Include total line count in hint

**Pros**:
- Clear reference for LLM and user
- Shows file structure
- Truncation hint preserves context

**Cons**:
- May hide important middle content
- Line numbers add width

---

#### Strategy B: Full Content + Scroll/Pager

**Format**:
```
tool  result read-file (152 lines)
      │ 1: import { readFile } from "node:fs/promises";
      │ 2: import { relative, resolve } from "node:path";
      │ ...
      │ [Press Enter to continue, q to quit]
```

**Implementation approach**:
1. Show first N lines
2. Pause for user input
3. Continue or quit

**Pros**:
- Full content available
- User control

**Cons**:
- Requires interactive mode
- Interrupts flow
- Bad for LLM context (incomplete view)

---

#### Strategy C: Structured Output with Metadata

**Format**:
```
tool  result read-file
      │ path: src/tools/read-file.ts
      │ size: 152 lines (4.2KB)
      │ ─────────────────────────────────────
      │ 1: import { readFile } from "node:fs/promises";
      │ 2: import { relative, resolve } from "node:path";
      │ 3:
      │ 4: import type { AgentTool } from "./tool-types.js";
      │ ... (142 more lines)
```

**Implementation approach**:
1. Add metadata header (path, size, type)
2. Show preview (first N lines)
3. Indicate total content

**Pros**:
- Rich context for LLM
- Clear what file was read
- Compact display

**Cons**:
- More parsing for LLM
- May not need metadata every time

---

#### Strategy D: Adaptive Based on Content Size

**Rules**:
1. **Small files (< 50 lines)**: Show full content with line numbers
2. **Medium files (50-200 lines)**: Show full content with line numbers, wrapped
3. **Large files (> 200 lines)**: Show first/last N lines with count hint

**Example for large file**:
```
tool  result read-file
      │ src/runtime/agent-loop.ts (302 lines)
      │ ─────────────────────────────────────
      │   1: import { Observable, from, of } from "rxjs";
      │   2: import { map, mergeMap } from "rxjs/operators";
      │   3:
      │   4: import type { Provider, ProviderStreamEvent } from ...
      │   ... (292 lines hidden)
      │ 299: }
      │ 300:
      │ 301: }
      │ 302: ]);
```

**Pros**:
- Adaptive to content
- Always useful amount of info
- Clear about what's hidden

**Cons**:
- More complex logic
- May hide relevant middle sections

---

## 6. Specific Recommendations for This Project

### 6.1 For LLM Context (tool_result event)

**Current issue**: Tool output is raw string, displayed as-is in terminal.

**Recommended changes**:

1. **Add line numbers to file read output**:
   ```typescript
   // In read-file.ts
   const lines = content.split("\n");
   const numberedContent = lines
     .map((line, index) => `${String(index + 1).padStart(6)}\t${line}`)
     .join("\n");

   return {
     status: "success",
     output: numberedContent,
   };
   ```

2. **Add truncation for large files**:
   ```typescript
   const MAX_LINES = 500; // Reasonable limit

   if (lines.length > MAX_LINES) {
     const firstHalf = lines.slice(0, MAX_LINES / 2);
     const lastHalf = lines.slice(-MAX_LINES / 2);
     const truncated = [
       ...firstHalf.map((line, i) => `${i + 1}\t${line}`),
       `... (${lines.length - MAX_LINES} lines hidden)`,
       ...lastHalf.map((line, i) => `${lines.length - MAX_LINES/2 + i + 1}\t${line}`),
     ].join("\n");

     return {
       status: "success",
       output: truncated,
       data: { totalLines: lines.length, truncated: true },
     };
   }
   ```

3. **Add file metadata to output**:
   ```typescript
   return {
     status: "success",
     output: `File: ${relativePath} (${lines.length} lines)\n${numberedContent}`,
     data: {
       path: relativePath,
       totalLines: lines.length,
       truncated: false,
     },
   };
   ```

### 6.2 For Terminal Display (terminal-renderer.ts)

**Current display**:
```
tool  result read-file
      │ <entire file content>
```

**Recommended improvements**:

1. **Detect and format file content**:
   ```typescript
   // If output looks like file content (has line numbers), wrap nicely
   const isFileContent = /^\s*\d+[:\t]/m.test(event.output);

   if (isFileContent) {
     // Apply special formatting for file content
     const lines = event.output.split("\n");
     // Show first N lines, with "..." if more
   }
   ```

2. **Add syntax highlighting hints**:
   - Detect file type from tool name or metadata
   - Apply basic syntax highlighting (keywords, strings)

3. **Better truncation display**:
   ```typescript
   const MAX_DISPLAY_LINES = 40;
   const lines = event.output.split("\n");

   if (lines.length > MAX_DISPLAY_LINES) {
     const preview = lines.slice(0, MAX_DISPLAY_LINES);
     const hidden = lines.length - MAX_DISPLAY_LINES;
     content = [...preview, `... (${hidden} more lines)`].join("\n");
   }
   ```

### 6.3 Implementation Priorities

**Phase 1: Essential** (Immediate)
1. Add line numbers to read-file output (for LLM reference)
2. Add basic truncation for large files (>500 lines)

**Phase 2: Enhanced** (Near-term)
3. Add file metadata header (path, size)
4. Improve terminal display formatting for file content

**Phase 3: Advanced** (Future)
5. Syntax highlighting
6. Smart truncation (preserve relevant sections)
7. Configurable display preferences

---

## 7. Code Examples

### 7.1 Line Numbering Implementation

```typescript
function formatWithLineNumbers(content: string): string {
  const lines = content.split("\n");
  const maxLineNum = lines.length;
  const padding = String(maxLineNum).length;

  return lines
    .map((line, index) => {
      const lineNum = String(index + 1).padStart(padding);
      return `${lineNum}\t${line}`;
    })
    .join("\n");
}
```

### 7.2 Truncation Implementation

```typescript
function truncateFileContent(
  content: string,
  maxLines: number = 500
): { output: string; truncated: boolean; totalLines: number } {
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines) {
    return {
      output: formatWithLineNumbers(content),
      truncated: false,
      totalLines,
    };
  }

  const halfMax = Math.floor(maxLines / 2);
  const firstLines = lines.slice(0, halfMax);
  const lastLines = lines.slice(-halfMax);
  const hiddenLines = totalLines - maxLines;

  const output = [
    ...firstLines.map((line, i) => `${i + 1}\t${line}`),
    ``,
    `... ${hiddenLines} lines hidden ...`,
    ``,
    ...lastLines.map((line, i) => `${totalLines - halfMax + i + 1}\t${line}`),
  ].join("\n");

  return {
    output,
    truncated: true,
    totalLines,
  };
}
```

### 7.3 Terminal Display with Smart Formatting

```typescript
function formatToolOutput(
  toolName: string,
  output: string,
  width: number
): string {
  // Detect if output is file content
  const isFileOutput = toolName === "read-file";
  const lines = output.split("\n");

  // For file output, ensure proper formatting
  if (isFileOutput) {
    const maxDisplayLines = Math.floor(width * 0.75); // Use 75% of terminal height

    if (lines.length > maxDisplayLines) {
      const preview = lines.slice(0, maxDisplayLines - 1);
      const hidden = lines.length - maxDisplayLines + 1;
      return [...preview, `... (${hidden} more lines, use limit/offset)`].join("\n");
    }
  }

  return output;
}
```

---

## 8. Summary

### Key Findings

1. **Line numbers** are standard in most file display tools (`cat -n`, `bat`, `ripgrep`)
2. **Truncation with hints** is common for large content (`head`/`tail`, `bat --line-range`)
3. **Terminal width** should be assumed at 80 chars for compatibility
4. **Dual audience** (LLM + user) requires both machine-parseable and human-readable output
5. **Context preservation** is important - show what was hidden, not just hide it

### Recommended Approach

For this project, implement:
1. **Line numbers** for all file read output (cat -n style)
2. **Smart truncation** at ~500 lines with first/last split
3. **Metadata header** showing file path and line count
4. **Terminal display** that respects width and shows preview for large content

This balances:
- LLM needs: clear reference points, complete context
- User needs: readable output, not overwhelming
- Technical constraints: terminal width, screen height
