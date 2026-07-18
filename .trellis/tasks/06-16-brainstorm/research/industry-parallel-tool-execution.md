# Research: Industry Standard Parallel Tool Execution Patterns

- **Query**: How do popular AI agent frameworks handle parallel tool execution?
- **Scope**: external
- **Date**: 2026-06-16

## Findings

### 1. OpenAI Agents SDK (openai-agents)

**Parallel Execution Pattern**: Provider-level batching with asyncio.Task parallel execution

**Key Implementation Details**:
- When a provider (OpenAI) returns multiple tool calls in a single response, they are executed **in parallel** using `asyncio.create_task()`
- The `_FunctionToolBatchExecutor` class manages concurrent execution with configurable max concurrency
- Uses `asyncio.wait()` with `return_when=asyncio.FIRST_COMPLETED` to drain tasks as they complete
- Failure isolation: when `isolate_parallel_failures=True`, one tool failure cancels siblings

**State Accumulation**:
- Results are collected in `results_by_tool_run` dictionary keyed by tool run ID
- Ordering is preserved via `order` field on each task
- Results are sorted by order before returning to maintain deterministic output

**Special Handling**:
- `max_function_tool_concurrency` config option limits parallel tasks
- Post-invoke cleanup phase handles teardown for cancelled tasks
- Failed tasks trigger cancellation of siblings with configurable timeout

**Source**: `src/agents/run_internal/tool_execution.py`

### 2. LangChain / LangGraph

**Parallel Execution Pattern**: Graph-level fan-out/fan-in with waiting edges

**Key Implementation Details**:
- LangGraph uses `waiting_edges` to define parallel execution paths
- Multiple nodes can be scheduled concurrently via the `PregelRunner` class
- Uses `concurrent.futures.Future` for sync execution and `asyncio.Future` for async
- `FuturesDict` manages concurrent task execution with event-based coordination

**State Accumulation**:
- State is managed through channels in the `StateGraph`
- Reducer functions merge state from parallel branches
- Checkpointing allows pause/resume of parallel execution

**Special Handling**:
- Graph compilation determines parallel execution paths at build time
- `PregelRunner` handles task scheduling, commit, and interruption
- Built-in retry policies for failed tasks

**Source**: `libs/langgraph/langgraph/pregel/_runner.py`, `libs/langgraph/langgraph/graph/state.py`

### 3. CrewAI

**Parallel Execution Pattern**: Task-level async execution with asyncio.create_task

**Key Implementation Details**:
- Tasks with `async_execution=True` are executed concurrently
- Uses `asyncio.create_task()` to spawn parallel task execution
- `kickoff_for_each_async()` runs multiple crew instances in parallel
- `concurrent.futures.ThreadPoolExecutor` used for sync-to-async bridging

**State Accumulation**:
- Task outputs are collected in `task_outputs` list
- Pending tasks tracked in `pending_tasks` list of tuples
- `_aprocess_async_tasks()` gathers results from parallel executions

**Special Handling**:
- Conditional tasks can interrupt parallel execution
- Context propagation between sequential and parallel tasks
- Streaming support via `CrewStreamingOutput`

**Source**: `lib/crewai/src/crewai/crew.py`

### 4. AutoGen (Microsoft)

**Parallel Execution Pattern**: Agent-level concurrent execution with SingleThreadedAgentRuntime

**Key Implementation Details**:
- Multiple tool calls from model response are executed **concurrently** by default
- Uses `asyncio.create_task()` for parallel tool execution
- `max_tool_iterations` controls sequential vs parallel execution
- `reflect_on_tool_use` determines if results are processed sequentially

**State Accumulation**:
- Tool call results collected in `FunctionExecutionResult` messages
- Messages published to group topic for broadcast to all participants
- State managed via `AssistantAgentState` for each agent

**Special Handling**:
- `parallel_tool_calls=False` can be set on model client to disable parallel execution
- Handoff execution happens before returning results
- Team-based execution via `RoundRobinGroupChat`, `SelectorGroupChat`, etc.

**Source**: `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py`

### 5. Claude Code (Anthropic)

**Parallel Execution Pattern**: Provider-level batching with buffer + batch pattern

**Key Implementation Details**:
- Multiple tool calls from a single response are batched and executed together
- Uses `Promise.all()` pattern for parallel tool execution
- Tool results are collected and returned as a batch
- Sequential execution within a batch if tools have dependencies

**State Accumulation**:
- Tool results accumulated in order of tool call IDs
- State updates happen after all tools in batch complete
- Conversation history updated with all tool results at once

**Special Handling**:
- Some tools (e.g., file writes) may require sequential execution
- Error handling per tool within parallel batch
- Timeout handling for individual tool executions

**Source**: Internal implementation (not fully open-source)

## Industry Standard Approach Summary

### Common Patterns Across Frameworks

1. **Provider-Level Batching**: All frameworks receive multiple tool calls from the model in a single response and execute them in parallel
2. **asyncio.create_task()**: Python-based frameworks (OpenAI SDK, CrewAI, AutoGen) use asyncio tasks for parallel execution
3. **State Accumulation**: Results are collected in dictionaries/lists with ordering preserved
4. **Failure Isolation**: Most frameworks support cancelling siblings when one tool fails
5. **Configurable Concurrency**: Max parallel task limits are common (OpenAI SDK has `max_function_tool_concurrency`)

### Key Design Decisions

| Framework | Parallel Scope | State Model | Failure Handling |
|-----------|---------------|-------------|------------------|
| OpenAI SDK | Tool calls within single response | Ordered results by task ID | Cancel siblings on failure |
| LangGraph | Graph nodes via waiting edges | Channel-based state with reducers | Retry policies per node |
| CrewAI | Tasks with async_execution flag | Task output list | Sequential fallback |
| AutoGen | Tool calls from model response | Agent state + message pub/sub | Configurable parallel disabled |
| Claude Code | Tool calls within single response | Ordered results by call ID | Per-tool error handling |

### Recommendations for Implementation

1. **Buffer + Batch Pattern**: Collect all tool calls from a provider step, then execute in parallel
2. **Ordered Results**: Preserve tool call order via indexing/ID-based ordering
3. **Configurable Concurrency**: Allow users to set max parallel tasks
4. **Failure Isolation**: Support both "fail-fast" (cancel siblings) and "continue-on-failure" modes
5. **State Reducers**: Use reducer functions for parallel state updates (LangGraph pattern)

## External References

- [OpenAI Agents SDK GitHub](https://github.com/openai/openai-agents-python) - Tool execution implementation
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Graph-based parallel execution
- [CrewAI Documentation](https://docs.crewai.com/) - Task-level parallel execution
- [AutoGen Documentation](https://microsoft.github.io/autogen/) - Agent-level parallel execution

## Caveats / Not Found

1. **Claude Code internals**: Not fully open-source, analysis based on observed behavior
2. **LangGraph edge cases**: Complex graph topologies may have additional parallel execution patterns
3. **CrewAI sync mode**: ThreadPoolExecutor usage for sync tasks not fully analyzed
4. **AutoGen team orchestration**: Multiple team types (RoundRobin, Selector, Swarm) have different parallel patterns
