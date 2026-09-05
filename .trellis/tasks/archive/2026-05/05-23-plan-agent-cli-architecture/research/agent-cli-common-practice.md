# Agent CLI Common Practice

## Summary

The common architecture for an intelligent-agent CLI is not just "a chat command". It usually splits the system into a terminal-facing shell, an agent runtime loop, provider adapters, tool execution, session persistence, and optional extension/MCP boundaries.

## Common Layers

1. CLI commands and terminal UX
2. Agent runtime / turn loop
3. Provider abstraction
4. Tool execution and permission gating
5. Session persistence and resume
6. Extension / MCP integration

## Why This Matters Here

The current repository already has:

* a CLI shell
* a thin command layout
* an RxJS-based stream prototype

It does **not** yet have:

* real model providers
* a tool protocol
* persistent sessions
* a runtime state machine
* an MCP boundary

So the correct next step is architecture and boundaries, not feature sprawl inside `src/commands/chat.ts`.

## Recommended Local Rule

Use RxJS by default for workflows that are naturally stream-shaped:

* user input
* model token output
* tool call / tool result events
* render/update events
* cancellation and timeout coordination

Do not force RxJS into places where a simple function or plain object model is clearer.

## References

* https://code.claude.com/docs/en/overview
* https://code.claude.com/docs/en/cli-usage
* https://code.claude.com/docs/en/agent-sdk/overview
* https://platform.openai.com/docs/guides/tools
* https://modelcontextprotocol.io/docs/getting-started/intro
