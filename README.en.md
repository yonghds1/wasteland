# ☢️ WASTELAND

<div align="center">

```text
██╗    ██╗ █████╗ ███████╗████████╗███████╗██╗      █████╗ ███╗   ██╗██████╗ 
██║    ██║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██║     ██╔══██╗████╗  ██║██╔══██╗
██║ █╗ ██║███████║███████╗   ██║   █████╗  ██║     ███████║██╔██╗ ██║██║  ██║
██║███╗██║██╔══██║╚════██║   ██║   ██╔══╝  ██║     ██╔══██║██║╚██╗██║██║  ██║
╚███╔███╔╝██║  ██║███████║   ██║   ███████╗███████╗██║  ██║██║ ╚████║██████╔╝
 ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
```

### Sovereign · Terminal-First · Industrial-Grade AI Programming Workbench

**[English](./README.en.md) | [简体中文](./README.md)**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![RxJS](https://img.shields.io/badge/Reactive-RxJS-e10079.svg)](https://rxjs.dev/)
[![Ink](https://img.shields.io/badge/TUI-Ink%2FReact-00d8ff.svg)](https://github.com/vadimdemedes/ink)
[![APCA Contrast](https://img.shields.io/badge/Contrast-APCA%20Validated-success.svg)](https://www.w3.org/WAI/GL/task-forces/silver/wiki/Visual_Contrast_of_Text_Subgroup)
[![MCP](https://img.shields.io/badge/MCP-1.0%20Ready-purple.svg)](https://modelcontextprotocol.io/)

</div>

---

## 📖 Introduction & Philosophy

**Wasteland** is a sovereign, terminal-first, full-featured open-source AI programming workbench engineered for serious software developers, built on **TypeScript + RxJS + Ink**.

In today's landscape of AI coding assistants, developers are routinely held hostage by proprietary vendor lock-in, invasive Git log pollutions, sluggish terminal interfaces that lag after prolonged conversations, and brittle multi-agent coordination. **Wasteland refuses to compromise**:

- **Model Sovereignty**: 100% neutral and vendor-agnostic. Freely hot-swap between DeepSeek, MiniMax, Claude, OpenAI, Qwen, GLM, or local Ollama instances.
- **Zero-Pollution Version Control**: Powered by dedicated low-level Git Plumbing, creating invisible isolated checkpoints without cluttering your project branches or commit histories.
- **Constant-Frame TUI**: Built with a strict 1:1 viewport height-budget virtualization engine. Whether at turn 10 or turn 500, render latency and frame rates remain constant in milliseconds.
- **Wasteland Punk Persona**: Seven distinctive personas certified under W3C APCA for maximum terminal contrast and visual ergonomics, providing dynamic and immersive feedback from inference to delivery.

---

## 🌟 6 Killer Core Features

### 1. ⏱️ Git Checkpoint Invisible Time Machine
Traditional AI code assistants either spam your main Git branch with garbage commits or rely on primitive memory undo that dangerously overwrites your concurrent external edits.
- **Dedicated Git Plumbing Driver**: Executes directly via low-level Git plumbing primitives (`git write-tree`, `git commit-tree`, `git update-ref`), isolating snapshot metadata under the dedicated `refs/wasteland/` namespace.
- **Zero Pollution of User Repositories**: Your regular `git status`, `git log`, and remote branch tracking remain pristine and unaffected.
- **Atomic Time-Machine Commands**:
  - `/undo [turnId]`: Instant sub-second rollback to the previous turn or a specific historical checkpoint, automatically refilling the prompt into your input draft buffer.
  - `/redo`: Restores changes undone by an accidental rollback via automatically minted rescue checkpoints.
  - `/diff [turnId]`: Displays rich, colorized Unified Diffs comparing your working tree against snapshot revisions.
  - `/checkpoints`: Inspects the snapshot lineage tree and affected file lists for the active session.
- **3-Way Hash Conflict Guard**: Before executing any rollback, Wasteland computes a 3-way hash comparison across working tree files. If concurrent modifications from an external editor (VSCode, Cursor, Neovim) are detected, rollback is **immediately blocked**, preventing catastrophic code loss unless explicitly overridden via `/undo --force`.

### 2. 🎭 Wasteland Punk Persona & Skin System
No more sterile, repetitive, robotic corporate tones. Wasteland breathes raw post-apocalyptic cyberpunk grit into your daily development workflow:
- **7 Distinct Built-in Personas**:
  - 👑 **Warlord Immortal (`warlord-immortal`)**: Supreme convoy orchestrator, crushing engineering roadblocks under heavy war-rig tracks.
  - 🏍️ **Road Nomad (`road-nomad`)**: Solo full-stack scout, tearing through legacy ruins with a supercharged V8 engine.
  - 🦾 **Fury Vanguard (`fury-vanguard`)**: Breaching lead developer, prying open twisted metal frames to forge a path to the oasis.
  - 🔧 **V8 Mechanic (`v8-mechanic`)**: Architecture refactorer and master tinkerer, welding loose bolts and supercharging carburetors.
  - 📡 **Sand Scout (`sand-scout`)**: Reconnaissance radar specialist, sniffing out critical dependencies and hidden signals across the dunes.
  - 🎯 **Bullet Tester (`bullet-tester`)**: Extreme load test master, unleashing armor-piercing rounds until every hidden flaw is exposed.
  - 🎸 **Doof Analyst (`doof-analyst`)**: Heavy-bass topology analyst, syncing complex multi-agent battle formations to flame-throwing guitar riffs.
- **100% APCA Contrast Verification**: Color schemes strictly pass the W3C APCA (Advanced Perceptual Contrast Algorithm 0.0.98G-4g) standard, ensuring optimal legibility across both dark and light terminal themes.
- **Full Lifecycle Immersion**: Every persona features distinct greeting phrases, deep inference thinking feedback, and mission delivery catchphrases.
- **Multi-Tier Seamless Customization**: Built-in defaults smoothly extend and merge with user-level (`~/.wasteland/skins.json`) and project-level (`.wasteland/skins.json`) configurations with hot-reloading support.

### 3. 🖥️ Strict 1:1 Viewport Virtualization
Solving Ink / React's notorious rendering bottlenecks in terminal applications:
- **Height-Budget Line Slicing**: Implemented via `flattenMessageToLines` and `useChatScroll`, calculating exact line height budgets for each message component.
- **Constant Node Mount Overhead**: Regardless of whether a session spans 10 turns or 500+ turns, the real terminal DOM tree only mounts ~30 virtual lines visible in the active viewport. Memory overhead and cursor jitter are eliminated.
- **Fluid Viewport Ergonomics**: Native mouse wheel scrolling, interactive draggable scrollbar on the right border, `PageUp` / `PageDown` / `Shift+↑↓` fine-grained steps, and unread new message indicators.

### 4. 🌳 Multi-Agent Panoramic DAG Tree View
Leveraging the **Agents-as-Tools** architectural paradigm to conquer complex multi-step missions:
- **Live Topology Visualization**: When the main orchestrator dispatches sub-agents via `spawn_agent`, the sidebar / inspector dynamically renders a live DAG tree of tasks.
- **Comprehensive Lifecycle Badges**: Nodes visually reflect execution states (`[RUNNING]`, `[COMPLETED]`, `[FAILED]`), alongside real-time step counts and token expenditure.
- **One-Key Viewport Navigation**: Navigate with arrow keys and hit Enter to inspect any sub-agent's isolated log and message stream, or switch effortlessly via `Alt+1` ~ `Alt+9` or `/tab <id>`.

### 5. 🔍 Lightweight Perception & Intelligence Engine (LPIE)
Blazing-fast contextual awareness without bulky external binaries:
- **Workspace Architecture Memory Auto-Assembly**: Automatically discovers and parses `CLAUDE.md`, `PROJECT.md`, or `.wasteland/rules.md` in your workspace, automatically injecting high-priority architecture constraints into the agent's system prompt.
- **3-Tier Adaptive Grep Probe**: Transparently escalates across `ripgrep (rg)` ➔ `git-grep` ➔ `Node.js concurrent stream` fallback. Guarantees sub-second full-text searches with full `contextLines` support in any environment.
- **Zero-C++ Symbolic Search (`find-symbol`)**: Free from native C++ compilation bindings (e.g. node-gyp or Tree-sitter binaries), using optimized cross-language regex pattern tables to locate classes, interfaces, functions, methods, types, and enums across TypeScript, JavaScript, Python, Rust, and Go in milliseconds.

### 6. 🛡️ Open Neutrality & Battle-Tested Security Governance
- **Unrestricted Model Neutrality**: Full OpenAI-compatible protocol compatibility out-of-the-box. Seamlessly switch between DeepSeek-V3/R1, MiniMax, Claude 3.5 Sonnet, GPT-4o, Qwen 2.5, GLM-4, and local Ollama deployments.
- **Standard MCP Plugin Hot-Plugging**: Fully adheres to Model Context Protocol (MCP) 1.0 specifications for both `stdio` and `sse` transports. Dynamically register, inspect, and reload MCP servers on the fly with `/mcp add` and `/mcp reload`.
- **Unified POSIX Path Sanitization**: Pre-cleans Windows backslashes, UNC shares, and drive letter casing discrepancies, eliminating sandbox path traversal bugs and false-positive out-of-boundary exceptions.
- **Phased Negative-PID Process Cleanup**: Commands execute in detached process groups. Upon timeout or abort, Wasteland issues `SIGTERM` to the negative process group (`-pid`), escalating to `SIGKILL` after a grace period to ensure complete eradication of orphan and zombie processes.

---

## ⚔️ Competitive Matrix

| Evaluation Dimension | ☢️ Wasteland | Claude Code | Aider | OpenCode | Cline (VSCode) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Model Neutrality & Freedom** | 🟢 **Fully Neutral**<br>(DeepSeek/MiniMax/Claude/OpenAI/Qwen/GLM/Ollama) | 🔴 **Vendor Locked**<br>(Anthropic Claude only) | 🟡 **Multi-Model**<br>(Via LiteLLM, complex setup) | 🟡 **Multi-Model**<br>(Requires custom provider wiring) | 🟢 **Multi-Model**<br>(Wide provider coverage) |
| **UI / UX Terminal Experience** | 🟢 **Modern Immersive TUI**<br>(Ink/React + 1:1 Virtualization + Mouse & Scrollbar) | 🟡 **CLI Line Prompt**<br>(Single prompt + direct terminal stream) | 🟡 **Interactive CLI**<br>(Readline-based, rudimentary UI) | 🟡 **Minimalist TUI**<br>(Basic list without rich panel layout) | 🔴 **No Standalone TUI**<br>(Coupled to VSCode editor window) |
| **Atomic Version Rollback** | 🟢 **Invisible Checkpoints**<br>(`refs/wasteland/` zero git-log pollution + 3-way guard) | 🟡 **Coarse Local Undo**<br>(Local tracking prone to conflict overwrites) | 🔴 **Git Log Pollution**<br>(Commits real commits on every iteration) | 🔴 **No Time Machine**<br>(Relies on manual reverts) | 🟡 **Basic Checkpoints**<br>(VSCode file history storage) |
| **Multi-Agent DAG Visualization** | 🟢 **DAG Panoramic Tree**<br>(Live Main/Sub tree + Token telemetry + Fast switch) | 🔴 **Single-Agent**<br>(No multi-agent topology dashboard) | 🔴 **Single-Agent**<br>(No sub-agent orchestration) | 🔴 **Single-Agent**<br>(No DAG views) | 🔴 **Single-Agent**<br>(No native sub-agent hierarchy) |
| **Long-Session Virtualization** | 🟢 **Strict 1:1 Virtualization**<br>(Constant ms rendering across 500+ turns, 0 lag) | 🔴 **No Virtualization**<br>(Dumps to terminal buffer, lag on large logs) | 🔴 **No Virtualization**<br>(Linear text stream) | 🟡 **Basic Pagination**<br>(Lacks accurate line-height budget) | 🟡 **Webview Render**<br>(Chromium-based, high memory consumption) |
| **Persona & Emotional Immersion** | 🟢 **7 Wasteland Personas**<br>(APCA verified colors + thinking phrases + catchphrases) | 🔴 **No Personas**<br>(Sterile, corporate assistant tone) | 🔴 **No Personas**<br>(Purely mechanical tool) | 🔴 **No Personas**<br>(Basic tool output) | 🔴 **No Personas**<br>(Single static system prompt) |
| **Hot-Pluggable MCP Ecosystem** | 🟢 **Dynamic Hot-Plugging**<br>(stdio & sse transports, runtime `/mcp` controls) | 🟡 **Partial Support**<br>(Requires manual restart) | 🔴 **No MCP Support** | 🟡 **Experimental**<br>(Partial protocol support) | 🟢 **Supports MCP**<br>(Configured via GUI extension pane) |

---

## 🎭 Wasteland Punk Persona & Skin Gallery

Wasteland rejects the sterile monotony of generic assistants. Choose from 7 finely-tuned wasteland personas, each 100% verified against W3C APCA contrast metrics:

| Skin ID | Persona Name | Role Specialty | Signature Catchphrase |
| :--- | :--- | :--- | :--- |
| `warlord-immortal` | **Warlord Immortal** | Supreme Orchestrator | *"On the Fury Road, only those who deliver results enter Valhalla!"* |
| `road-nomad` | **Mad Mike** | Lone Full-Stack Scout | *"Hope is a mistake. But the V8 engine in my hands never lies."* |
| `fury-vanguard` | **Imperator Furiosa** | Breaching Lead Developer | *"Remember this moment! We ride not to survive, but to reach the Green Place!"* |
| `v8-mechanic` | **Rictus Mechanic** | Refactoring & Tooling Master | *"Weld the chassis tight enough, and no sandstorm can tear it apart."* |
| `sand-scout` | **Nux Sand Scout** | Deep Reconnaissance & Research | *"As long as there is a faint signal in the dunes, the convoy will find a way."* |
| `bullet-tester` | **Bullet Major** | Extreme Stress QA Inspector | *"My tests fire like ten thousand tracer rounds—no hidden flaw escapes!"* |
| `doof-analyst` | **Doof Warrior** | Topology & Rhythm Analyst | *"A convoy is a symphony. Break the rhythm, and the war rig collapses in the sand!"* |

### Skin Management Commands (/skin)

Manage and inspect skins directly within the TUI or CLI:

```bash
/skin list              # List all available skins with the active marker (●)
/skin show              # Display details and color palette of the active skin
/skin load <skinId>     # Switch to a designated skin (e.g., /skin load fury-vanguard)
/skin info <skinId>     # Inspect phrases and thinking lines of a specific skin
/skin reset             # Reset back to the default skin
```

### Custom Skins Extension

Add custom personas by creating a `skins.json` file in your user home directory (`~/.wasteland/skins.json`) or project root (`.wasteland/skins.json`):

```json
{
  "skins": {
    "my-wasteland-hacker": {
      "label": "Dune Hacker",
      "colors": {
        "label": "#00ffcc",
        "text": "#e0e0e0",
        "thinking": "#7a7a7a"
      },
      "greeting": [
        "Satellite dish deployed, darknet channel open. State your target code!"
      ],
      "thinking": [
        "Piercing firewalls, constructing AST dependency graph..."
      ],
      "catchphrases": [
        "Target compromised, logic verified without flaws. Task delivered!"
      ]
    }
  },
  "singleAgent": {
    "skin": "my-wasteland-hacker"
  }
}
```

---

## ⚡ Quick Start & Configuration

### 1. Requirements
- **Node.js**: `>= 20.0.0`
- **npm**: `>= 9.0.0`
- Supported OS: Linux, macOS, Windows (WSL / PowerShell)

### 2. Installation & Global Link

```bash
# Clone the repository
git clone https://github.com/yonghds1/wasteland.git
cd wasteland

# Install dependencies
npm install

# Compile the TypeScript project
npm run build

# Link CLI globally (optional, enables running 'wasteland' anywhere)
npm link
```

### 3. Model Provider Configuration

#### Method A: Environment Variables (Recommended)

```bash
# DeepSeek
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxx"

# Qwen (Alibaba DashScope)
export qwen_api_key="sk-xxxxxxxxxxxxxxxxxxxxxxxx"

# Anthropic Claude
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxx"

# OpenAI
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxx"

# MiniMax
export MINIMAX_API_KEY="xxxxxxxxxxxxxxxxxxxxxxxx"

# GLM (Zhipu AI)
export GLM_API_KEY="xxxxxxxxxxxxxxxxxxxxxxxx"
```

#### Method B: Interactive Setup Wizard (InitWizard)
Running `wasteland` for the first time automatically launches the interactive `InitWizard`. It guides you through configuring your default Provider, API keys, permission gates, and initial persona skin. Settings are persisted to `~/.wasteland/auth.json` and `~/.wasteland/settings.json`.

### 4. Launching the TUI

```bash
# Launch via TypeScript dev mode (automatically opens TUI)
npm run dev

# Or run globally in any workspace directory
wasteland

# Launch with explicit provider and role flags
wasteland --provider deepseek --role orchestrator
```

---

## ⌨️ TUI Navigation & Slash Commands

### Slash Commands Reference

Type `/` in the input bar to bring up the command auto-completion popup:

| Category | Command | Description |
| :--- | :--- | :--- |
| **Time Machine** | `/undo [turnId]` | Atomic rollback to previous or specific turn; supports `--force`; auto-fills prompt draft |
| | `/redo` | Restores code changes reversed during undo using rescue checkpoints |
| | `/diff [turnId]` | Displays colorized Unified Diff between current workspace and target checkpoint |
| | `/checkpoints` | Lists all Git Checkpoint invisible snapshots for the session |
| **Skin System** | `/skin list` | Lists all available skins |
| | `/skin load <id>` | Dynamically switches to the designated skin |
| | `/skin show` | Displays active skin palette and configuration |
| | `/skin info <id>` | Inspects dialogue lines and persona statistics |
| | `/skin reset` | Resets to default system skin |
| **MCP Ecosystem** | `/mcp list` | Lists all mounted stdio / sse MCP servers |
| | `/mcp add <name> <cmd\|url>` | Dynamically mounts a new MCP server |
| | `/mcp reload` | Hot-reloads all MCP server connections |
| **Viewport & Agents**| `/tab [index\|name]` | Switches active Agent tab viewport (e.g. `/tab 2`) |
| | `/mode [single\|multi]` | Switches between Single Agent and Multi-Agent Orchestration modes |
| | `/logs` | Opens global log stream view (supports `/logs errors`, `/logs show <id>`, `/logs level <lvl>`) |
| **Workspace LPIE** | `/context` (`/ctx`) | Displays workspace awareness overview and injected rules status |
| | `/init` (`/i`) | Analyzes workspace and initializes standard `CLAUDE.md` architecture guide |
| | `/tools` (`/tls`) | Lists all registered tools and their permission levels |
| | `/status` (`/stat`) | Displays runtime status, token telemetry, and session metadata |
| **Session Control** | `/clear` | Clears current viewport messages |
| | `/help` (`/h`) | Opens interactive command and shortcuts help view |
| | `/exit` (`/quit`) | Prompts safety exit confirmation |

### Keyboard Shortcuts

| Shortcut | Scope | Action |
| :--- | :--- | :--- |
| `Enter` | Input Bar / Tabs | Send message / Confirm selected Agent tab |
| `Shift + Enter` / `Alt + Enter` | Input Bar | Insert newline at cursor |
| `Escape` | Global | Blur input to navigation mode / Close active modal or help popup |
| `Tab` / `Shift + Tab` | Global | Cycle permission mode (`default` ask ➔ `accept_edits` auto-accept edits ➔ `bypass` autonomous) |
| `PageUp` / `Ctrl + U` | Chat Area | Scroll up half a page |
| `PageDown` / `Ctrl + D` | Chat Area | Scroll down half a page |
| `Shift + ↑` / `Shift + ↓` | Chat Area | Micro-scroll up / down by 3 lines |
| `Home` / `End` | Chat Area | (Navigation mode) Jump to top / bottom of session |
| `Ctrl + T` | Chat Area | Expand / collapse tool execution details |
| `Alt + 1` ~ `Alt + 9` | Global | Instant switch to corresponding Agent tab |
| `t` | Global (Nav mode) | Cycle views (`Chat` ➔ `Logs` ➔ `Sessions`) |
| `Ctrl + C` | Global | Trigger exit confirmation or terminate process |

---

## 🏛️ System Architecture & Layering

Wasteland enforces strict three-tier decoupling, ensuring the core engine is free from any UI framework dependencies:

```text
┌─────────────────────────────────────────────────────────────┐
│  1. UI Layer (Presentation Layer - Completely Decoupled)    │
│                                                             │
│   Modern Terminal TUI (Primary Citizen)   CLI Fallback      │
│   src/tui/ (Ink / React)                  src/ui/ (readline)│
│   - 1:1 Height-Budget Virtualization      - CliInputAdapter │
│   - Live DAG Tree View & Status Bars      - CliOutputAdapter│
│   - APCA Wasteland Punk Theme Engine                        │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               │  Unified to ChatInputTurn Reactive Stream
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Adapter Layer (src/core/input-adapter.ts & output)      │
│                                                             │
│  - InputAdapter: Normalizes inputs into reactive input$     │
│  - OutputAdapter: 1:1 maps RuntimeEvent to DisplayEvent     │
│  - Completely isolates Core from UI rendering media         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Core Runtime Layer (src/core/ - Pure TypeScript / RxJS) │
│                                                             │
│  - runAgentLoop({ input$ }) -> { events$, debug$ }          │
│  - Git Checkpoint Invisible Time Machine Engine (Plumbing)  │
│  - LPIE Perception Engine (CLAUDE.md / 3-Tier Grep / Symbol)│
│  - Reactive Multi-Agent (Agents-as-Tools / forkJoin)        │
│  - Permission Gate & Phased Negative-PID Process Cleanup    │
└─────────────────────────────────────────────────────────────┘
```

- **Reactive Event Bus (RxJS)**: All runtime interactions—reasoning steps, tool executions, streamed tokens, permission gates—stream through reactive Observable pipelines, providing cancellation, timeouts, and concurrency.
- **Agents-as-Tools Paradigm**: Spawning sub-agents is encapsulated as a standard tool call (`spawn_agent`). This keeps the runtime interface simple and scalable without introducing branching ad-hoc protocols.

---

## 🔌 Extensions: MCP & Custom Skills

### Model Context Protocol (MCP)

Wasteland embraces open industry standards. Configure any standard MCP server inside `~/.wasteland/mcp.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "memory-service": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

Run `/mcp reload` inside the TUI to hot-reload tools and resources instantly without restarting your session.

### Custom Skills

Extend the agent's capabilities with custom scripts in `.wasteland/skills/`:

```typescript
// .wasteland/skills/git-summary.ts
export default {
  definition: {
    name: "git-summary",
    description: "Summarize recent commits and generate a release diff log",
    riskLevel: "read",
    aliases: ["gs"]
  },
  async execute(args, context) {
    const result = await context.toolRegistry.get("bash")!.execute(
      { command: "git log -n 5 --oneline" },
      { sessionId: context.sessionId, turn: context.turn, cwd: context.cwd }
    );
    return { status: "success", output: result.output };
  }
};
```

---

## 🛠️ Quality Gates & Engineering Scripts

Wasteland adheres to industrial-grade standards with co-located tests and strict typing:

```bash
# Fast quality check (TypeCheck + ESLint, required before commits)
npm run check:fast

# Full quality gate (TypeCheck + Lint + i18n check + Contrast check + Full tests)
npm run check

# Run test suite via Vitest
npm test

# Verify APCA contrast across all skins and themes
npm run check:contrast

# Verify localization dictionary parity (zh <-> en)
npm run check:locale-parity

# Create shortcut terminal aliases for wasteland personas (e.g., 'warlord')
./scripts/create-aliases.sh
```

---

## 📄 License

Distributed under the [Apache-2.0 License](./LICENSE).  
Copyright © yonghds1.
