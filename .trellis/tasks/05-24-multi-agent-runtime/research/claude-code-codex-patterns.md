# Claude Code & OpenAI Codex Multi-Agent Patterns Research

> Research on how Claude Code and OpenAI Codex CLI handle multi-agent orchestration, parallel execution, and subagent spawning.

**Date**: 2026-05-24
**Focus**: Multi-agent orchestration, parallel execution, subagent patterns, UX patterns

---

## Executive Summary

**Claude Code** uses a **natural language orchestration model** where specialized agents are launched via declarative commands in markdown files. Parallel execution is achieved through explicit "Launch N agents in parallel" instructions.

**OpenAI Codex** has a **Subagents concept** (documented in their Concepts section) with hierarchical AGENTS.md support via `child_agents_md` feature flag, but detailed public documentation is limited.

**Key Insight**: Both systems converge on the **Agents-as-Tools** pattern where parent agents delegate to specialized child agents through a tool-like interface, returning results back to the parent.

---

## 1. Claude Code Multi-Agent Architecture

### 1.1 Core Pattern: Natural Language Orchestration

Claude Code uses **declarative markdown commands** to orchestrate multi-agent workflows. The pattern is:

```markdown
---
description: Code review a pull request
---

Launch 4 agents in parallel to independently review:
- Agent 1: CLAUDE.md compliance sonnet agent
- Agent 2: CLAUDE.md compliance sonnet agent
- Agent 3: Opus bug agent
- Agent 4: Opus bug agent
```

**Key characteristics**:
- Natural language specifies agent count and model type
- Parallel execution via explicit "in parallel" instruction
- Results aggregated back to parent for synthesis

### 1.2 Agent Definitions

Agents are defined in markdown files with YAML frontmatter:

```markdown
---
name: code-reviewer
description: Reviews code for bugs, logic errors, security vulnerabilities
tools: Glob, Grep, LS, Read, NotebookRead, WebFetch, TodoWrite, WebSearch
model: sonnet
color: red
---

You are an expert code reviewer specializing in modern software development...
```

**Agent attributes**:
| Attribute | Purpose |
|-----------|---------|
| `name` | Unique identifier for the agent |
| `description` | When/why to use this agent |
| `tools` | Allowed tool set for the agent |
| `model` | Model to use (haiku, sonnet, opus) |
| `color` | Visual indicator in UI |

### 1.3 Parallel Execution Pattern

From the code-review command:

```markdown
Launch 4 agents in parallel to independently review:

Agent 1 + 2: CLAUDE.md compliance sonnet agents
Agent 3: Opus bug agent (parallel subagent with agent 4)
Agent 4: Opus bug agent (parallel subagent with agent 3)

**CRITICAL: We only want HIGH SIGNAL issues.**
```

**Pattern**:
1. Parent receives task
2. Parent launches multiple specialized agents in parallel
3. Each agent independently analyzes from its perspective
4. Parent aggregates results
5. Parent filters/synthesizes final output

### 1.4 Hierarchical Agent Launching

Claude Code supports **nested subagent launching**:

```markdown
5. For each issue found, launch parallel subagents to validate the issue.
   Use Opus subagents for bugs and sonnet agents for CLAUDE.md violations.
```

This creates a tree structure:
```
Parent Agent
├── Agent 1 (parallel)
│   ├── Validation Subagent 1
│   └── Validation Subagent 2
├── Agent 2 (parallel)
├── Agent 3 (parallel)
└── Agent 4 (parallel)
```

### 1.5 Model Selection for Agents

Claude Code uses different models for different agent types:

| Model | Use Case | Example |
|-------|----------|---------|
| `haiku` | Quick checks, filtering | PR status check, file listing |
| `sonnet` | Standard analysis | CLAUDE.md compliance, code exploration |
| `opus` | Complex reasoning | Bug detection, deep analysis |

**Pattern**: "Launch a haiku agent to check if..." for fast preliminary checks.

### 1.6 Plugin Architecture for Agents

Claude Code agents are organized as plugins:

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── commands/                # Slash commands
│   └── command-name.md      # Command definition
├── agents/                  # Specialized agents
│   ├── agent-1.md
│   └── agent-2.md
├── skills/                  # Agent Skills
└── hooks/                   # Event handlers
```

---

## 2. Feature-Dev: Structured Multi-Agent Workflow

The feature-dev plugin demonstrates a **7-phase multi-agent workflow**:

### Phase 2: Codebase Exploration (Parallel Agents)

```markdown
Launch 2-3 code-explorer agents in parallel. Each agent should:
- Trace through the code comprehensively
- Target a different aspect of the codebase
- Include a list of 5-10 key files to read
```

### Phase 4: Architecture Design (Competing Agents)

```markdown
Launch 2-3 code-architect agents in parallel with different focuses:
- minimal changes (smallest change, maximum reuse)
- clean architecture (maintainability, elegant abstractions)
- pragmatic balance (speed + quality)
```

### Phase 6: Quality Review (Specialized Agents)

```markdown
Launch 3 code-reviewer agents in parallel with different focuses:
- simplicity/DRY/elegance
- bugs/functional correctness
- project conventions/abstractions
```

**Key pattern**: Multiple agents with **different perspectives** run in parallel, then parent synthesizes.

---

## 3. OpenAI Codex Multi-Agent Patterns

### 3.1 Subagents Concept

From the Codex documentation navigation, there is a **Subagents** section under:
- `Using Codex > Concepts > Subagents`
- `Configuration > Plugins > Subagents`

### 3.2 Hierarchical AGENTS.md

From `docs/agents_md.md`:
> "When the `child_agents_md` feature flag is enabled, Codex appends additional guidance about AGENTS.md scope and precedence..."

This suggests:
- Parent-child agent relationships via AGENTS.md files
- Feature flag controlled: `child_agents_md`
- Hierarchical instruction inheritance

### 3.3 Observed Patterns from Navigation

Codex documentation structure indicates:
- **Subagents** as a first-class concept
- **Skills** as composable agent capabilities
- **Plugins** for extending agent behavior

---

## 4. Comparison: Claude Code vs Codex

| Aspect | Claude Code | Codex |
|--------|-------------|-------|
| **Orchestration** | Natural language in commands | Feature flags + AGENTS.md |
| **Parallel Execution** | Explicit "Launch N in parallel" | Inferred (limited public docs) |
| **Agent Definition** | Markdown with YAML frontmatter | AGENTS.md files |
| **Model Selection** | Per-agent `model:` attribute | Per-task configuration |
| **Hierarchy** | Nested subagent launching | `child_agents_md` feature flag |
| **Tool Access** | Per-agent `tools:` list | Skills system |
| **UX Pattern** | Slash commands trigger agents | CLI + IDE + Web surfaces |

---

## 5. Key Patterns to Adopt

### 5.1 Natural Language Orchestration

**From Claude Code**:
```
"Launch N agents in parallel with different focuses: [list]"
```

This is simple, flexible, and doesn't require complex API design.

### 5.2 Agents-as-Tools Pattern

**From Anthropic's recommended pattern**:
```typescript
// Parent agent has "delegate to specialist" as a tool
spawn_agent({
  name: "researcher",
  task: "Research the topic"
})
```

**Benefits**:
- No separate "spawn" API - delegation is a tool call
- Child runs, returns result to parent
- Parent continues with child's result in context

### 5.3 Model Selection per Agent Type

**From Claude Code**:
- `haiku` for quick checks (fast, cheap)
- `sonnet` for standard tasks (balanced)
- `opus` for complex reasoning (capable, expensive)

### 5.4 Confidence-Based Filtering

**From code-review**:
```markdown
Rate each issue on a scale from 0-100.
Only report issues with confidence ≥ 80.
```

This reduces noise from false positives in multi-agent systems.

### 5.5 Perspective Diversity

**From feature-dev**:
Launch multiple agents with **different focuses**:
- One for minimal changes
- One for clean architecture
- One for pragmatic balance

Parent synthesizes different perspectives into a recommendation.

---

## 6. Implementation Recommendations

### 6.1 For This Project (RxJS-based Agent Runtime)

Based on the research, adopt:

1. **Natural Language Spawn Instructions**
   ```typescript
   // In tool definitions, allow:
   spawn_agent: {
     description: "Launch a specialized sub-agent",
     parameters: {
       name: string,
       task: string,
       model?: "haiku" | "sonnet" | "opus",
       tools?: string[]
     }
   }
   ```

2. **Parallel Execution via forkJoin**
   ```typescript
   // When parent requests parallel agents
   const parallelAgents$ = forkJoin({
     researcher: runChildAgent({ name: "researcher", task: "..." }),
     coder: runChildAgent({ name: "coder", task: "..." }),
     reviewer: runChildAgent({ name: "reviewer", task: "..." })
   });
   ```

3. **Per-Agent Model Selection**
   ```typescript
   type AgentConfig = {
     name: string;
     model: "haiku" | "sonnet" | "opus";
     tools: Tool[];
     timeout?: number;
   };
   ```

4. **Confidence Filtering**
   ```typescript
   // Child agents return confidence scores
   type AgentResult = {
     output: string;
     confidence: number;  // 0-100
   };
   
   // Parent filters by threshold
   const highConfidenceResults = results.filter(r => r.confidence >= 80);
   ```

### 6.2 Architecture Integration

```
runAgentLoop
  → runTurnLoop
    → Provider.runStep
      → tool_call: spawn_agent
        → dispatchToolCall
          → spawn_agent tool
            → runAgentLoop (child, mode="single")
              → returns tool_result
            ←
          ←
        ←
      ←
    ←
  ←
```

---

## 7. References

### Claude Code
- GitHub: https://github.com/anthropics/claude-code
- Plugins: https://github.com/anthropics/claude-code/tree/main/plugins
- Code Review Plugin: plugins/code-review/
- Feature-Dev Plugin: plugins/feature-dev/

### OpenAI Codex
- GitHub: https://github.com/openai/codex
- Docs: https://developers.openai.com/codex
- Subagents: /codex/concepts/subagents (requires authentication)

### Multi-Agent Patterns
- LangGraph: https://langchain-ai.github.io/langgraph/
- AutoGen: https://microsoft.github.io/autogen/
- CrewAI: https://docs.crewai.com/

---

## Appendix: Agent Definition Examples

### A.1 Claude Code code-reviewer Agent

```markdown
---
name: code-reviewer
description: Reviews code for bugs, logic errors, security vulnerabilities
tools: Glob, Grep, LS, Read, NotebookRead, WebFetch, TodoWrite, WebSearch
model: sonnet
color: red
---

You are an expert code reviewer specializing in modern software development.

## Review Scope
By default, review unstaged changes from `git diff`.

## Confidence Scoring
Rate each potential issue on a scale from 0-100:
- **0**: Not confident at all, false positive
- **25**: Somewhat confident, might be real
- **50**: Moderately confident, real but minor
- **75**: Highly confident, real and important
- **100**: Absolutely certain, definitely real

**Only report issues with confidence ≥ 80.**
```

### A.2 Claude Code code-explorer Agent

```markdown
---
name: code-explorer
description: Deeply analyzes existing codebase features by tracing execution paths
tools: Glob, Grep, LS, Read, NotebookRead, WebFetch, TodoWrite, WebSearch
model: sonnet
color: yellow
---

You are an expert code analyst specializing in tracing feature implementations.

## Output Guidance
Provide:
- Entry points with file:line references
- Step-by-step execution flow
- Key components and responsibilities
- List of 5-10 essential files to understand the topic
```

### A.3 Parallel Launch Example (from code-review)

```markdown
Launch 4 agents in parallel to independently review:

Agents 1 + 2: CLAUDE.md compliance sonnet agents
- Audit changes for CLAUDE.md compliance in parallel

Agent 3: Opus bug agent (parallel subagent with agent 4)
- Scan for obvious bugs, focus only on diff

Agent 4: Opus bug agent (parallel subagent with agent 3)
- Look for problems in introduced code

Each agent should return the list of issues with confidence scores.
```
