/**
 * tool-executor.ts - 工具执行管道抽象 (Phase 2 Refactoring)
 */
import type { SessionToolCallRecord, SessionToolResultRecord } from '../runtime/event-types.js';
import type { ToolRegistry } from '@tools/core/tool-registry.js';
import { Logger } from '../logger/index.js';

export class ToolExecutorPipeline {
  constructor(private registry: ToolRegistry) {}

  async executeTool(call: SessionToolCallRecord): Promise<SessionToolResultRecord> {
    Logger.info({
      sessionId: call.sessionId,
      scope: 'tool',
      message: 'tool_execution_started',
      data: { toolName: call.toolName }
    });

    return {
      type: 'tool_result',
      sessionId: call.sessionId,
      turn: call.turn,
      callId: call.callId,
      toolName: call.toolName,
      status: 'error',
      error: 'Not Implemented: Awaiting migration from agent-loop.ts',
      timestamp: new Date().toISOString()
    };
  }
}
