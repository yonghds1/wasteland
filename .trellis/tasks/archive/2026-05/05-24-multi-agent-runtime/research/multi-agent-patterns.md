# Multi-Agent Framework Patterns Research

> Research on agent spawning and orchestration patterns in existing multi-agent frameworks.

**Date**: 2026-05-24
**Focus**: Agent spawning, parallel execution, identity/context, error handling

---

## Executive Summary

**Key Insight**: Multi-agent frameworks converge on three core patterns:
1. **Graph-based orchestration** (LangGraph) - explicit state machines with conditional edges
2. **Conversation-driven spawning** (AutoGen, CrewAI) - agents as conversational participants
3. **Agents-as-tools** (Anthropic) - hierarchical delegation where parent agents invoke child agents as tools

The current project's RxJS-based `runAgentLoop` pattern is well-positioned to adopt the **agents-as-tools** pattern with minimal architectural changes.

---

## 1. Agent Spawning Patterns

### 1.1 LangGraph (LangChain)

**Pattern**: State Graph with Node-based Agents

LangGraph models multi-agent systems as a **state machine** where each node is an agent:

```python
from langgraph.graph import StateGraph, END

# Define shared state
class AgentState(TypedDict):
    messages: List[Message]
    next_agent: str

# Build graph
graph = StateGraph(AgentState)
graph.add_node("researcher", researcher_agent)
graph.add_node("writer", writer_agent)
graph.add_node("supervisor", supervisor_agent)

# Conditional routing
graph.add_conditional_edges(
    "supervisor",
    lambda state: state["next_agent"],
    {"researcher": "researcher", "writer": "writer", "FINISH": END}
)
```

**Spawning Mechanism**:
- No explicit "spawn" - agents are nodes in a graph
- State is passed between nodes via shared `AgentState`
- Supervisor decides next agent via conditional edges

**Key Concepts**:
| Concept | Description |
|---------|-------------|
| `StateGraph` | Graph where state flows between nodes |
| `add_node` | Register an agent as a graph node |
| `add_conditional_edges` | Route to different agents based on state |
| `checkpointer` | Persist state for resumption |

### 1.2 AutoGen (Microsoft)

**Pattern**: Conversational Agent Group Chat

AutoGen uses a **conversation-centric** model where agents communicate:

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat

# Create agents
researcher = AssistantAgent("researcher", llm_config=...)
writer = AssistantAgent("writer", llm_config=...)
user_proxy = UserProxyAgent("user", ...)

# Group chat orchestrates
groupchat = GroupChat(
    agents=[user_proxy, researcher, writer],
    messages=[],
    max_round=10
)

# Spawning happens via select_speaker mechanism
manager = GroupChatManager(groupchat=groupchat)
user_proxy.initiate_chat(manager, message="Research and write about AI")
```

**Spawning Mechanism**:
- `GroupChatManager` selects next speaker via `select_speaker` method
- Custom speaker selection: override `select_speaker` for intelligent routing
- Nested chats: `initiate_chat` can spawn nested conversations

**Dynamic Spawning**:
```python
# AutoGen supports dynamic agent creation
def create_specialist_agent(topic):
    return AssistantAgent(
        f"specialist_{topic}",
        system_message=f"You are an expert in {topic}",
        llm_config=...
    )

# Spawn on demand
specialist = create_specialist_agent("quantum computing")
```

### 1.3 CrewAI

**Pattern**: Task-based Crew with Role-playing Agents

CrewAI organizes agents around **tasks** in a crew:

```python
from crewai import Agent, Task, Crew, Process

# Define agents with roles
researcher = Agent(
    role="Senior Researcher",
    goal="Uncover groundbreaking data",
    backstory="...",
    tools=[search_tool]
)

writer = Agent(
    role="Writer",
    goal="Create engaging content",
    backstory="...",
    tools=[write_tool]
)

# Tasks assigned to agents
research_task = Task(
    description="Research the topic",
    agent=researcher
)

write_task = Task(
    description="Write the article",
    agent=writer,
    context=[research_task]  # Depends on research
)

# Crew orchestrates execution
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, write_task],
    process=Process.sequential  # or Process.hierarchical
)

result = crew.kickoff()
```

**Spawning Mechanism**:
- **Sequential**: Tasks execute in order, agent per task
- **Hierarchical**: Manager agent delegates to worker agents
- **Context passing**: Tasks can depend on other tasks' outputs

**Hierarchical Mode** (manager spawns workers):
```python
crew = Crew(
    agents=[researcher, writer],
    tasks=[task1, task2],
    process=Process.hierarchical,
    manager_llm=manager_llm  # Manager decides who does what
)
```

### 1.4 Anthropic: Agents as Tools Pattern

**Pattern**: Hierarchical Delegation via Tool Calls

Anthropic's recommended pattern treats **agents as tools**:

```python
# Parent agent has "delegate to specialist" as a tool
def create_specialist_tool(specialist_type):
    def delegate_to_specialist(task: str) -> str:
        # Spawn child agent
        specialist = create_agent(specialist_type)
        return specialist.run(task)
    
    return {
        "name": f"delegate_to_{specialist_type}",
        "description": f"Delegate task to {specialist_type} specialist",
        "input_schema": {"type": "string"},
        "execute": delegate_to_specialist
    }

# Parent agent's tools include delegation
parent_agent = Agent(
    model="claude-sonnet-4",
    tools=[
        read_file_tool,
        create_specialist_tool("researcher"),
        create_specialist_tool("coder"),
    ]
)
```

**Spawning Mechanism**:
- No separate "spawn" API - delegation is a tool call
- Child agent runs, returns result to parent
- Parent continues with child's result in context

**Key Insight from Anthropic**:
> "The most natural way to build multi-agent systems with Claude is to give the parent agent tools that invoke child agents. This keeps the architecture simple and leverages Claude's native tool-calling."

---

## 2. Parallel Execution Patterns

### 2.1 LangGraph Parallel Branches

```python
from langgraph.graph import StateGraph

# Fan-out: multiple agents in parallel
graph.add_node("parallel_research", parallel_research_node)

def parallel_research_node(state):
    # Execute multiple research agents concurrently
    results = await asyncio.gather(
        researcher_a.run(state),
        researcher_b.run(state),
        researcher_c.run(state)
    )
    return {"research_results": results}
```

**Aggregation**:
- Results collected via `asyncio.gather` or similar
- State updated with all results before next node

### 2.2 AutoGen Parallel Conversations

```python
# AutoGen supports parallel nested chats
responses = await asyncio.gather(
    agent_a.initiate_chat(manager_a, message=task_a),
    agent_b.initiate_chat(manager_b, message=task_b)
)
```

### 2.3 CrewAI Parallel Tasks

```python
# Tasks without dependencies run in parallel
task_a = Task(description="Task A", agent=agent_a)
task_b = Task(description="Task B", agent=agent_b)  # Runs parallel if no context dependency

crew = Crew(
    agents=[agent_a, agent_b],
    tasks=[task_a, task_b],
    process=Process.sequential  # Still parallelizes independent tasks
)
```

### 2.4 RxJS Patterns for Parallel Execution

**Relevant to current project**:

```typescript
import { forkJoin, merge, combineLatest } from 'rxjs';

// Pattern 1: forkJoin - wait for all to complete
const parallelAgents$ = forkJoin({
  researcher: researcherAgent.run(task),
  coder: coderAgent.run(task),
  reviewer: reviewerAgent.run(task)
});
// Emits once when all complete: { researcher: ..., coder: ..., reviewer: ... }

// Pattern 2: merge - interleave events
const mergedEvents$ = merge(
  researcherAgent.events$,
  coderAgent.events$,
  reviewerAgent.events$
);
// Emits events as they happen from any agent

// Pattern 3: combineLatest - react to any change
const combined$ = combineLatest({
  research: researcherState$,
  code: coderState$
});
// Emits whenever any agent updates
```

---

## 3. Agent Identity and Context

### 3.1 LangGraph State Passing

```python
class AgentState(TypedDict):
    messages: List[Message]      # Shared conversation
    agent_outputs: Dict[str, Any]  # Per-agent outputs
    current_agent: str           # Identity tracking
    parent_agent: Optional[str]  # Parent-child relationship
```

**Context Inheritance**:
- Child agents receive subset of parent state
- Reducer functions merge child output back

### 3.2 AutoGen Agent Identity

```python
agent = AssistantAgent(
    name="researcher",           # Unique identity
    system_message="...",        # Instructions
    llm_config=...,              # Model config
    human_input_mode="NEVER"     # Behavior
)

# Parent-child via nested chat
parent.initiate_chat(
    child,
    message="...",
    # Child gets parent's message as context
)
```

### 3.3 CrewAI Role-based Identity

```python
agent = Agent(
    role="Senior Researcher",    # Role identity
    goal="...",                  # Goal context
    backstory="...",             # Behavioral context
    tools=[...],                 # Capabilities
    llm=...                      # Model
)
```

### 3.4 Context Propagation Patterns

| Framework | Parent → Child Context | Child → Parent Result |
|-----------|------------------------|----------------------|
| LangGraph | State subset via graph edge | State reducer |
| AutoGen | Message in `initiate_chat` | Reply message |
| CrewAI | Task `context` field | Task output |
| Agents-as-Tools | Tool input | Tool return value |

---

## 4. Error Handling and Timeouts

### 4.1 LangGraph Error Handling

```python
from langgraph.pregel import RetryPolicy

graph.add_node(
    "agent",
    agent_node,
    retry_policy=RetryPolicy(
        max_attempts=3,
        on=[RateLimitError, TimeoutError]
    )
)

# Checkpointer enables resume on failure
checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)

# Resume from last good state
result = app.invoke(None, config={"configurable": {"thread_id": "session-123"}})
```

### 4.2 AutoGen Error Handling

```python
# Max rounds prevents infinite loops
groupchat = GroupChat(
    agents=[...],
    max_round=20  # Timeout after 20 turns
)

# Error in agent
try:
    result = agent.generate_reply(messages)
except Exception as e:
    # Send error message back to group
    return f"Agent failed: {e}"
```

### 4.3 CrewAI Error Handling

```python
task = Task(
    description="...",
    agent=agent,
    max_iter=5,           # Max retries
    retry_on_fail=True    # Auto-retry
)

# Callbacks for error handling
@task.on_error
def handle_error(task, error):
    print(f"Task {task.description} failed: {error}")
```

### 4.4 RxJS Timeout Patterns (Current Project)

```typescript
import { timeout, retry, catchError, race } from 'rxjs';

// Pattern 1: Timeout
agent$.pipe(
  timeout(30000),  // 30 second timeout
  catchError(err => of({ type: 'timeout', error: err }))
)

// Pattern 2: Retry with backoff
agent$.pipe(
  retry({
    count: 3,
    delay: (err, retryCount) => timer(1000 * Math.pow(2, retryCount))
  })
)

// Pattern 3: Race with timeout
race(
  agent$,
  timer(30000).pipe(map(() => ({ type: 'timeout' })))
)
```

---

## 5. Current Project Architecture Analysis

### 5.1 Existing Patterns

The project already implements several patterns relevant to multi-agent:

**From `agent-loop.ts`**:
```typescript
// Core loop pattern: defer + concat + recursion
function runTurnLoop(params): Observable<RuntimeEvent> {
  return defer(() => {
    // Check termination
    if (shouldTerminate) return of(finalEvent);
    
    // Execute step
    const step$ = provider.runStep(...);
    
    // Continue or terminate
    const continuation$ = defer(() => {
      if (shouldContinue) return runTurnLoop(nextState);
      return EMPTY;
    });
    
    return concat(step$, continuation$);
  });
}
```

**From `tool-dispatch.ts`**:
```typescript
// Tool lifecycle with permission gate
function dispatchToolCall(params): Observable<RuntimeEvent> {
  // 1. Record request
  // 2. Check permission
  // 3. Execute or block
  // 4. Record result
  return concat(requested$, permission$, started$, result$);
}
```

### 5.2 Extension Points for Multi-Agent

The current architecture supports multi-agent via these extension points:

| Extension Point | Current Use | Multi-Agent Use |
|-----------------|-------------|-----------------|
| `ToolRegistry` | File, Bash tools | Add "spawn_agent" tool |
| `AgentProvider` | Single provider | Provider can be child agent |
| `TurnState` | Single agent state | Add `childAgents: AgentState[]` |
| `RuntimeEvent` | Single agent events | Add `agent_spawned`, `agent_completed` events |

### 5.3 Proposed Agents-as-Tools Integration

```typescript
// Add to ToolRegistry
const spawnAgentTool: AgentTool = {
  name: "spawn_agent",
  riskLevel: "execute",  // Spawning is high-risk
  async execute(input, context) {
    const { agentType, task } = input;
    
    // Create child agent
    const childAgent = await createAgent(agentType, {
      parentId: context.sessionId,
      parentHistory: context.history
    });
    
    // Run child agent
    const result = await lastValueFrom(
      runAgentLoop({
        input$: of({ turn: 1, content: task, source: "spawned" }),
        provider: childAgent.provider,
        sessionManager: childAgent.sessionManager,
        cwd: context.cwd,
        mode: "single"
      }).events$.pipe(
        filter(e => e.type === "assistant_message"),
        take(1)
      )
    );
    
    return {
      status: "success",
      output: result.content
    };
  }
};
```

---

## 6. Comparative Summary

### 6.1 Framework Comparison Table

| Aspect | LangGraph | AutoGen | CrewAI | Agents-as-Tools |
|--------|-----------|---------|--------|-----------------|
| **Orchestration** | State graph | Group chat | Crew/Task | Tool calls |
| **Spawning** | Graph nodes | Dynamic agents | Task assignment | Tool invocation |
| **Parallelism** | Async in nodes | Async gather | Task parallel | forkJoin/merge |
| **Context** | Shared state | Messages | Task context | Tool input |
| **Error Handling** | Retry + checkpoint | Max rounds | Retry + callbacks | catchError |
| **Complexity** | Medium | Medium | Low | Low |

### 6.2 Recommended Approach for This Project

**Agents-as-Tools Pattern** is recommended because:

1. **Minimal changes**: Add spawn tool to existing `ToolRegistry`
2. **Consistent with existing patterns**: Tool dispatch already handles lifecycle
3. **Natural for Claude**: Claude's native tool-calling aligns with this pattern
4. **Observable-friendly**: Child agent runs as Observable, easily composed
5. **Permission integration**: Existing `PermissionGate` can control spawning

---

## 7. Implementation Considerations

### 7.1 Agent Identity Schema

```typescript
type AgentIdentity = {
  id: string;              // Unique agent ID
  type: string;            // Agent type (researcher, coder, etc.)
  parentId?: string;       // Parent agent ID (if spawned)
  sessionId: string;       // Session ID
  depth: number;           // Nesting depth (0 = root)
};
```

### 7.2 Context Inheritance

```typescript
type SpawnContext = {
  task: string;                    // Task for child agent
  parentHistory: MessageRecord[];  // Relevant history from parent
  workingDir: string;              // Working directory
  maxDepth: number;                // Prevent infinite nesting
  timeout: number;                 // Child agent timeout
};
```

### 7.3 Event Extensions

```typescript
type MultiAgentRuntimeEvent = 
  | RuntimeEvent  // Existing events
  | {
      type: "agent_spawned";
      parentId: string;
      childId: string;
      agentType: string;
      task: string;
    }
  | {
      type: "agent_completed";
      agentId: string;
      status: "success" | "error" | "timeout";
      result?: string;
    };
```

### 7.4 Timeout and Resource Limits

```typescript
type SpawnLimits = {
  maxDepth: 3;           // Max nesting depth
  maxChildren: 10;       // Max children per parent
  childTimeout: 60000;   // 60s per child
  totalTimeout: 300000;  // 5min total
};
```

---

## 8. References

### Framework Documentation

- **LangGraph**: https://langchain-ai.github.io/langgraph/
- **AutoGen**: https://microsoft.github.io/autogen/
- **CrewAI**: https://docs.crewai.com/
- **Anthropic Agents**: https://docs.anthropic.com/claude/docs/agents-and-tools

### Project Internal References

- `.trellis/spec/backend/runtime-contracts.md` - Runtime contracts
- `.trellis/spec/backend/tool-runtime-contracts.md` - Tool contracts
- `src/runtime/agent-loop.ts` - Core agent loop
- `src/runtime/tool-dispatch.ts` - Tool lifecycle
- `docs/rxjs-guide.md` - RxJS patterns

---

## Appendix A: Code Examples from Current Project

### A.1 Current Agent Loop (simplified)

```typescript
// From src/runtime/agent-loop.ts
export function runAgentLoop(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  mode: RuntimeMode;
  maxStepsPerTurn?: number;
}): {
  events$: Observable<RuntimeEvent>;
  debug$: Observable<DebugTraceEvent>;
}
```

### A.2 Current Tool Dispatch

```typescript
// From src/runtime/tool-dispatch.ts
export function dispatchToolCall(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  turn: number;
  call: ToolCall;
  registry: ToolRegistry;
  permissionGate: PermissionGate;
  cwd: string;
  turnState: TurnState;
}): Observable<RuntimeEvent>
```

### A.3 Current Provider Contract

```typescript
// From src/providers/provider-types.ts
interface AgentProvider {
  readonly id: string;
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}

type ProviderStreamEvent =
  | { type: "assistant_chunk"; text: string; }
  | { type: "tool_call"; call: ToolCall; }
  | { type: "assistant_message"; text: string; };
```
