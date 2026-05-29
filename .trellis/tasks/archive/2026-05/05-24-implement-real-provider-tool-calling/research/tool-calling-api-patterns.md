# Tool Calling API Patterns: OpenAI vs Anthropic

> Research findings on how OpenAI and Anthropic implement tool calling in their chat completion APIs.

## Overview

Both OpenAI and Anthropic support tool calling (function calling) in their chat APIs, but they use different formats and conventions. This document details the API request/response formats for both providers.

---

## 1. OpenAI Tool Calling

### 1.1 Defining Tools in Request

Tools are defined in the `tools` array parameter:

```typescript
interface ChatCompletionFunctionTool {
  type: 'function';
  function: {
    name: string;              // Required: a-z, A-Z, 0-9, underscores, dashes (max 64 chars)
    description?: string;      // Optional: description of what the function does
    parameters?: {             // Optional: JSON Schema object for parameters
      type: 'object';
      properties?: { [key: string]: unknown };
      required?: string[];
    };
    strict?: boolean | null;   // Optional: enable strict schema adherence
  };
}

// Request example
{
  model: 'gpt-4o',
  messages: [...],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' }
          },
          required: ['location']
        }
      }
    }
  ],
  tool_choice: 'auto'  // 'none' | 'auto' | 'required' | { type: 'function', function: { name: '...' } }
}
```

### 1.2 Response Format (Non-Streaming)

When the model decides to call a tool:

```typescript
interface ChatCompletionMessageFunctionToolCall {
  id: string;          // Unique identifier for this tool call (e.g., 'call_abc123')
  type: 'function';
  function: {
    name: string;      // Name of the function to call
    arguments: string; // JSON string of arguments (MUST BE PARSED!)
  };
}

// Response example
{
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: null,  // null when tool is called
      tool_calls: [
        {
          id: 'call_xyz789',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location": "San Francisco"}'  // STRING, not object!
          }
        }
      ]
    },
    finish_reason: 'tool_calls'  // Indicates tool call(s) were made
  }]
}
```

**Important Notes:**
- `finish_reason` will be `'tool_calls'` when tools are called
- `arguments` is a **JSON string**, must be parsed with `JSON.parse()`
- Multiple tool calls can be returned in a single response
- The model may generate both `content` and `tool_calls` (though typically one or the other)

### 1.3 Passing Tool Results Back

Tool results are passed as messages with `role: 'tool'`:

```typescript
interface ChatCompletionToolMessageParam {
  role: 'tool';
  tool_call_id: string;  // Must match the id from the tool call
  content: string;       // Result of the tool execution (string or content parts)
}

// Follow-up request with tool results
{
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'What is the weather in SF?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_xyz789',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"location": "San Francisco"}' }
      }]
    },
    {
      role: 'tool',
      tool_call_id: 'call_xyz789',  // Must match!
      content: '{"temperature": 65, "condition": "sunny"}'
    }
  ]
}
```

### 1.4 Streaming Tool Calls

Tool calls are streamed incrementally using `ChatCompletionChunk`:

```typescript
// Streaming chunk format
interface ChatCompletionChunk {
  id: string;  // Same ID across all chunks
  object: 'chat.completion.chunk';
  choices: [{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index: number;      // Index of tool call in the array
        id?: string;        // Tool call ID (usually in first chunk)
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;  // Incremental JSON string chunks
        };
      }>;
    };
    finish_reason: 'stop' | 'tool_calls' | null;
  }];
}
```

**Streaming Implementation Notes:**
- Tool calls are streamed incrementally via `delta.tool_calls`
- `index` identifies which tool call (multiple can be interleaved)
- `id` appears in the first chunk for each tool call
- `arguments` are streamed character by character
- Must accumulate partial `arguments` strings across chunks
- `finish_reason: 'tool_calls'` appears in the final chunk

**Example Streaming Sequence:**

```typescript
// Chunk 1
{ delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_weather' } }] } }

// Chunk 2
{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"loc' } }] } }

// Chunk 3
{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ation": "SF"' } }] } }

// Chunk 4
{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }

// Final chunk
{ delta: {}, finish_reason: 'tool_calls' }
```

---

## 2. Anthropic Tool Calling

### 2.1 Defining Tools in Request

```typescript
interface ToolParam {
  name: string;           // Required: tool name
  input_schema: {         // Required: JSON Schema for input
    type: 'object';
    properties?: { [key: string]: unknown };
    required?: string[];
  };
  description?: string;   // Optional but recommended
  type?: 'custom';        // Optional, defaults to custom
}

// Request example
{
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'What is the weather in SF?' }
  ],
  tools: [
    {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      input_schema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' }
        },
        required: ['location']
      }
    }
  ],
  tool_choice: { type: 'auto' }  // { type: 'auto' } | { type: 'any' } | { type: 'tool', name: '...' }
}
```

### 2.2 Response Format (Non-Streaming)

Anthropic returns tool calls as content blocks:

```typescript
interface ToolUseBlock {
  type: 'tool_use';
  id: string;          // Unique identifier for this tool use
  name: string;        // Name of the tool
  input: {             // PARSED OBJECT, not string!
    [key: string]: unknown;
  };
}

// Response example
{
  id: 'msg_abc123',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_xyz789',
      name: 'get_weather',
      input: {  // Already an OBJECT, not a string!
        location: 'San Francisco'
      }
    }
  ],
  model: 'claude-sonnet-4-20250514',
  stop_reason: 'tool_use',  // Indicates tool use
  usage: { input_tokens: 100, output_tokens: 50 }
}
```

**Key Differences from OpenAI:**
- `content` is an **array of blocks**, not a single string
- `input` is a **parsed object**, not a JSON string
- `stop_reason: 'tool_use'` instead of `finish_reason: 'tool_calls'`
- Tool use blocks can be mixed with text blocks in the same response

### 2.3 Passing Tool Results Back

Tool results are passed as content blocks with `type: 'tool_result'`:

```typescript
interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;           // Must match the id from tool_use block
  content?: string | Content[];  // Result content
  is_error?: boolean;            // Optional: mark as error
}

// Follow-up request with tool results
{
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'What is the weather in SF?' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_xyz789',
          name: 'get_weather',
          input: { location: 'San Francisco' }
        }
      ]
    },
    {
      role: 'user',  // Note: tool results are in a user message!
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_xyz789',
          content: '{"temperature": 65, "condition": "sunny"}'
        }
      ]
    }
  ]
}
```

**Critical Differences from OpenAI:**
- Tool results are placed in a **`user` role message**, not a special `tool` role
- Multiple tool results go in the **same user message** as separate content blocks
- Content blocks support both string and structured content

### 2.4 Streaming Tool Calls

Anthropic streams tool calls via content block events:

```typescript
// Stream event types
type MessageStreamEvent =
  | { type: 'message_start'; message: Message }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: ContentBlockDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string } }
  | { type: 'message_stop' };

// Tool-specific events
interface InputJsonEvent {
  type: 'input_json';
  partial_json: string;  // Incremental JSON string
  snapshot: object;      // Currently accumulated parsed object
}
```

**Streaming Sequence:**

```typescript
// 1. Message starts
{ type: 'message_start', message: { id: 'msg_abc', role: 'assistant', content: [] } }

// 2. Content block starts
{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_xyz', name: 'get_weather' } }

// 3. Input JSON deltas (incremental)
{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"loc' } }
{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ation": "SF"' } }
{ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '}' } }

// 4. Content block stops
{ type: 'content_block_stop', index: 0 }

// 5. Message stops
{ type: 'message_delta', delta: { stop_reason: 'tool_use' } }
{ type: 'message_stop' }
```

---

## 3. Key Differences Summary

| Aspect | OpenAI | Anthropic |
|--------|--------|-----------|
| **Tool Definition Field** | `tools` array with `function` nested | `tools` array with `input_schema` |
| **Tool Arguments Format** | JSON **string** (requires parsing) | **Object** (already parsed) |
| **Response Location** | `message.tool_calls[]` array | `content[]` array as `tool_use` blocks |
| **Tool Result Role** | `role: 'tool'` | `role: 'user'` (with `tool_result` blocks) |
| **Tool Result ID Field** | `tool_call_id` | `tool_use_id` |
| **Finish Reason** | `finish_reason: 'tool_calls'` | `stop_reason: 'tool_use'` |
| **Content with Tools** | Usually `content: null` | Can have both text and tool_use blocks |
| **Streaming Delta Type** | `delta.tool_calls[].function.arguments` | `delta.input_json_delta.partial_json` |

---

## 4. Implementation Recommendations

### 4.1 Type Definitions for Our Project

Based on our existing `ToolCall` type:

```typescript
// Our current type (from tool-types.ts)
type ToolCall = {
  id: string;
  toolName: string;
  input: ToolInput;  // Record<string, unknown>
};

// OpenAI adapter needs to:
// 1. Parse arguments string: JSON.parse(call.function.arguments)
// 2. Map: function.name → toolName, function.arguments → input

// Anthropic adapter needs to:
// 1. Use input directly (already parsed)
// 2. Map: name → toolName, input → input
```

### 4.2 Unified Tool Definition Format

```typescript
// Recommended internal format
interface ToolDefinition {
  name: string;
  description?: string;
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchema>;
    required?: string[];
  };
}

// OpenAI conversion
function toOpenAITool(tool: ToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

// Anthropic conversion
function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}
```

### 4.3 Tool Result Handling

```typescript
// OpenAI format
interface OpenAIToolResult {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

// Anthropic format
interface AnthropicToolResult {
  role: 'user';
  content: [{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }];
}

// Conversion from our internal format
function toOpenAIToolResult(result: ToolExecutionResult, callId: string): OpenAIToolResult {
  return {
    role: 'tool',
    tool_call_id: callId,
    content: result.status === 'success' ? result.output : result.error,
  };
}

function toAnthropicToolResult(result: ToolExecutionResult, callId: string): AnthropicToolResult {
  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: callId,
      content: result.status === 'success' ? result.output : result.error,
      is_error: result.status === 'error',
    }],
  };
}
```

---

## 5. Code Examples

### 5.1 OpenAI Non-Streaming Tool Call Flow

```typescript
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Step 1: Send request with tools
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is the weather in SF?' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    },
  }],
});

// Step 2: Check for tool calls
const toolCalls = response.choices[0].message.tool_calls;
if (toolCalls) {
  for (const call of toolCalls) {
    // Parse arguments string to object
    const args = JSON.parse(call.function.arguments);

    // Execute tool
    const result = await executeToolCall(call.function.name, args);

    // Step 3: Send tool result back
    const finalResponse = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'What is the weather in SF?' },
        response.choices[0].message,  // Include the assistant's tool call
        { role: 'tool', tool_call_id: call.id, content: result },
      ],
    });

    console.log(finalResponse.choices[0].message.content);
  }
}
```

### 5.2 Anthropic Non-Streaming Tool Call Flow

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Step 1: Send request with tools
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'What is the weather in SF?' }],
  tools: [{
    name: 'get_weather',
    description: 'Get current weather',
    input_schema: {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    },
  }],
});

// Step 2: Check for tool use
const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
if (toolUseBlocks.length > 0) {
  const toolResults = [];

  for (const block of toolUseBlocks) {
    // Input is already parsed - no need to parse!
    const result = await executeToolCall(block.name, block.input);

    toolResults.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: result,
    });
  }

  // Step 3: Send tool results back (in a user message!)
  const finalResponse = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'What is the weather in SF?' },
      { role: 'assistant', content: response.content },  // Include assistant's response
      { role: 'user', content: toolResults },  // Tool results as user message!
    ],
  });

  console.log(finalResponse.content[0].text);
}
```

### 5.3 OpenAI Streaming Tool Call Accumulation

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Check weather in SF and NYC' }],
  tools: [/* ... */],
  stream: true,
});

const toolCallChunks: Map<number, { id: string; name: string; arguments: string }> = new Map();

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;

  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (!toolCallChunks.has(tc.index)) {
        toolCallChunks.set(tc.index, { id: '', name: '', arguments: '' });
      }

      const existing = toolCallChunks.get(tc.index)!;
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
    }
  }

  if (chunk.choices[0]?.finish_reason === 'tool_calls') {
    // All tool calls complete - now parse and execute
    for (const [index, tc] of toolCallChunks) {
      const args = JSON.parse(tc.arguments);
      console.log(`Tool ${tc.name}(${JSON.stringify(args)})`);
    }
  }
}
```

### 5.4 Anthropic Streaming Tool Call Accumulation

```typescript
const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Check weather in SF and NYC' }],
  tools: [/* ... */],
});

stream.on('contentBlockStart', (event) => {
  if (event.content_block.type === 'tool_use') {
    console.log(`Tool use started: ${event.content_block.name}`);
  }
});

stream.on('inputJson', (partialJson, snapshot) => {
  // partialJson: incremental string like '{"loc'
  // snapshot: parsed object so far like { location: 'San Francisco' }
  console.log('Partial:', partialJson);
  console.log('Snapshot:', snapshot);
});

const finalMessage = await stream.finalMessage();
// finalMessage.content contains all content blocks including tool_use blocks
```

---

## 6. References

- OpenAI Function Calling Guide: https://platform.openai.com/docs/guides/function-calling
- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat
- Anthropic Tool Use Guide: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
- OpenAI Node SDK: https://github.com/openai/openai-node
- Anthropic Python SDK: https://github.com/anthropics/anthropic-sdk-python
