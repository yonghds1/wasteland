# Research: ACP/A2A Implementation in wasteland

- **Query**: What ACP (Agent Communication Protocol) features are currently implemented vs missing, how A2A is used, and what features are missing for agent-to-agent collaboration
- **Scope**: internal + external
- **Date**: 2026-06-16

## Findings

### Current A2A Implementation Status

The codebase uses the Google A2A (Agent-to-Agent) protocol, not a separate "ACP" protocol. The `src/acp/` directory contains three files:

| File Path | Description |
|---|---|
| `src/acp/a2a-types.ts` | Type definitions based on Google A2A spec |
| `src/acp/a2a-client.ts` | HTTP client for A2A protocol |
| `src/acp/a2a-registry.ts` | Agent registry for discovery and lookup |

### Implemented Features

#### 1. Agent Discovery (AgentCard)
- **Endpoint**: `GET /.well-known/agent.json`
- **Implementation**: `A2AClient.discoverAgent()` at `src/acp/a2a-client.ts:109-113`
- **Status**: Implemented. Returns `AgentCard` with name, description, url, capabilities, skills, authentication.

#### 2. Task Operations
| Operation | Endpoint | Implementation | Status |
|---|---|---|---|
| Send task (blocking) | `POST /tasks/send` | `A2AClient.sendTask()` line 131-153 | Implemented |
| Send task (async) | `POST /tasks/send` | `A2AClient.sendTaskAsync()` line 164-181 | Implemented |
| Get task status | `GET /tasks/{id}` | `A2AClient.getTask()` line 191-202 | Implemented |
| Cancel task | `POST /tasks/{id}/cancel` | `A2AClient.cancelTask()` line 247-254 | Implemented |
| Wait for task (polling) | `GET /tasks/{id}` | `A2AClient.waitForTask()` line 216-238 | Implemented |

#### 3. Agent Registry
- **Registration**: `A2AAgentRegistry.register()` at `src/acp/a2a-registry.ts:71-85`
- **Discovery**: `A2AAgentRegistry.discoverAndRegister()` line 96-109
- **Lookup by capability**: `discoverByCapability()` line 123-141
- **Lookup by name**: `findByName()` line 150-153

#### 4. Integration with spawn_agent
- **File**: `src/tools/a2a-spawn-agent.ts`
- **Mechanism**: `createA2ASpawnAgentTool()` wraps the local spawn_agent tool
- **Behavior**: Checks if target agent name matches a registered remote agent; if yes, uses A2A protocol; otherwise falls back to local spawn_agent
- **Registration**: In `src/tools/default-registry.ts:141-146`, the A2A spawn tool replaces the local placeholder when A2A agents are configured

#### 5. Configuration
- **Settings type**: `A2AAgentConfig` in `src/config/settings-types.ts:73-80`
- **Config key**: `a2aAgents` in settings.json (array of `{name, url, token?}`)
- **Runtime integration**: `src/core/shared/initialize-runtime.ts` starts A2A during runtime init (line 162-169)

#### 6. Test Server
- **File**: `examples/a2a-test-server.ts`
- **Purpose**: Simple HTTP server implementing A2A endpoints for testing
- **Capabilities**: Agent card, task send, task get, task cancel

### Type Definitions (Implemented)

From `src/acp/a2a-types.ts`:

| Type | Status |
|---|---|
| `AgentCard` | Defined with name, description, url, version, capabilities, skills, authentication, inputModes, outputModes |
| `TaskState` | Defined: submitted, working, input-required, completed, failed, canceled, rejected, auth-required, unknown |
| `TaskStatus` | Defined: state, message, timestamp |
| `Task` | Defined: id, sessionId, status, history, artifacts, metadata |
| `MessagePart` | Defined: text, file, data variants |
| `Message` | Defined: role (user/agent), parts, metadata |
| `Artifact` | Defined: name, description, parts, metadata |
| `TaskSendRequest` | Defined with configuration including blocking, pushNotifications, acceptedOutputModes, timeoutSeconds |
| `TaskGetQuery` | Defined |
| `TaskCancelRequest` | Defined |
| `TaskResubscribeRequest` | **Type defined but NOT implemented in client** |
| `TaskStatusUpdateEvent` | **Type defined but NOT used** |
| `TaskArtifactUpdateEvent` | **Type defined but NOT used** |
| `SSEEvent` | **Type defined but NOT used** |
| `A2AError` | Defined |

### Missing Features (Gap Analysis)

#### 1. Streaming/SSE Support (HIGH PRIORITY)
- **Types defined**: `SSEEvent`, `TaskStatusUpdateEvent`, `TaskArtifactUpdateEvent` in `src/acp/a2a-types.ts:270-300`
- **AgentCard capability declared**: `streaming: boolean` field exists
- **Client implementation**: None. No SSE/EventSource handling in `A2AClient`
- **Impact**: Cannot receive real-time status updates or incremental artifacts from remote agents. Only polling-based wait is available.

#### 2. Push Notifications (HIGH PRIORITY)
- **Types defined**: `pushNotifications` in `TaskSendRequest.configuration` (line 217-219)
- **AgentCard capability declared**: `pushNotifications: boolean` field exists
- **Client implementation**: None
- **Impact**: Cannot register webhook URLs for task completion notifications. Must poll for status.

#### 3. Task Resubscription (MEDIUM PRIORITY)
- **Types defined**: `TaskResubscribeRequest` in `src/acp/a2a-types.ts:256-261`
- **Endpoint**: `GET /tasks/{id}/subscribe`
- **Client implementation**: None
- **Impact**: Cannot re-subscribe to a task's SSE stream after disconnection.

#### 4. State Transition History (MEDIUM PRIORITY)
- **AgentCard capability declared**: `stateTransitionHistory: boolean` field exists
- **Task type includes**: `history?: Message[]` field
- **Client implementation**: None. No endpoint to fetch task history.
- **Impact**: Cannot retrieve the full history of state transitions for a task.

#### 5. File/Data Message Parts (MEDIUM PRIORITY)
- **Types defined**: `MessagePart` supports `file` and `data` variants (lines 140-157)
- **Client implementation**: Only creates `text` type parts in `createUserMessage()` (line 263-268)
- **Impact**: Cannot send file attachments or structured data to remote agents.

#### 6. Authentication Schemes (LOW PRIORITY)
- **Types defined**: `authentication` field in AgentCard with `schemes` and `credentials`
- **Client implementation**: Only supports Bearer token via `token` option
- **Impact**: Cannot handle OAuth, API key, or other authentication schemes.

#### 7. Input/Output Mode Negotiation (LOW PRIORITY)
- **Types defined**: `defaultInputModes` and `defaultOutputModes` in AgentCard
- **Client implementation**: None
- **Impact**: Cannot negotiate content types between agents.

#### 8. Multi-turn Session Management (LOW PRIORITY)
- **Types defined**: `sessionId` field in Task
- **Client implementation**: Only passes sessionId to sendTask; no session lifecycle management
- **Impact**: Limited multi-turn conversation support with remote agents.

### Relationship to spawn_agent

The A2A integration extends the existing `spawn_agent` tool with a transparent fallback mechanism:

1. **Local spawn_agent** (`src/tools/spawn-agent.ts`): Creates child sessions, runs `runAgentLoop` with `mode: 'single'`, waits for completion
2. **A2A spawn_agent** (`src/tools/a2a-spawn-agent.ts`): Wraps local spawn_agent, checks registry for remote agents, uses A2A protocol if found
3. **Registration** (`src/tools/default-registry.ts`): When `a2aAgents` config exists, the A2A-aware tool replaces the local placeholder

The integration is minimal - it only uses `sendTask()` (blocking mode) and extracts text output from artifacts/status message. No streaming, no multi-turn, no file exchange.

### External References

- Google A2A Protocol: The implementation follows Google's A2A specification with endpoints at `/.well-known/agent.json` and `/tasks/*`
- The A2A test server (`examples/a2a-test-server.ts`) demonstrates the expected server-side behavior

### Related Specs

- `.trellis/spec/backend/runtime-contracts.md` - Runtime entry points, provider contract
- `.trellis/spec/backend/tool-runtime-contracts.md` - Tool lifecycle contracts

## Caveats / Not Found

1. **No ACP protocol exists**: The codebase uses A2A (Agent-to-Agent), not a separate ACP (Agent Communication Protocol). The `src/acp/` directory name is misleading - it contains A2A code.
2. **No streaming implementation**: Despite types being defined, zero SSE/streaming code exists in the client.
3. **No test coverage**: No unit tests found for A2A client, registry, or the A2A spawn tool integration.
4. **Registry is static**: Agents are registered from config at startup. No dynamic discovery or health checking.
5. **The A2A spawn tool is a thin wrapper**: It does not handle edge cases like agent unavailability, partial results, or streaming output.
