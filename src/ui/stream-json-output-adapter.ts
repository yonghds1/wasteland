/**
 * stream-json-output-adapter.ts - Stream-JSON 输出适配器（控制在 180 行以内）
 *
 * 订阅 RuntimeEvent 并将标准事件转为 JSONL 逐行写入 stdout。
 * 非协议日志导向 stderr，确保 stdout 纯净。
 */

import type { Writable } from 'node:stream';
import type { Observable } from 'rxjs';

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import type { OutputAdapter, DisplayEvent } from '@core/output-adapter.js';
import type { StreamJsonEvent } from './stream-json-types.js';

export type StreamJsonOutputAdapterParams = {
  stdout?: Writable;
  stderr?: Writable;
  onTurnComplete?: () => void;
};

export class StreamJsonOutputAdapter implements OutputAdapter {
  private readonly stdout: Writable;
  private readonly stderr: Writable;
  private onTurnComplete?: () => void;
  private isThinking = false;

  constructor(params?: StreamJsonOutputAdapterParams) {
    this.stdout = params?.stdout ?? process.stdout;
    this.stderr = params?.stderr ?? process.stderr;
    this.onTurnComplete = params?.onTurnComplete;
  }

  processEvent(event: RuntimeEvent): DisplayEvent {
    return event as unknown as DisplayEvent;
  }

  setOnTurnComplete(callback: () => void): void {
    this.onTurnComplete = callback;
  }

  private writeStdout(event: StreamJsonEvent): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  private writeStderr(message: string): void {
    this.stderr.write(message);
  }

  private processChunk(sessionId: string, turn: number, chunk: string): void {
    let remaining = chunk;
    while (remaining.length > 0) {
      if (!this.isThinking) {
        const idx = remaining.indexOf('<think>');
        if (idx !== -1) {
          const before = remaining.slice(0, idx);
          if (before.length > 0) this.writeStdout({ type: 'text_delta', sessionId, turn, delta: before });
          this.isThinking = true;
          remaining = remaining.slice(idx + 7);
        } else {
          this.writeStdout({ type: 'text_delta', sessionId, turn, delta: remaining });
          break;
        }
      } else {
        const idx = remaining.indexOf('</think>');
        if (idx !== -1) {
          const before = remaining.slice(0, idx);
          if (before.length > 0) this.writeStdout({ type: 'thinking_delta', sessionId, turn, delta: before });
          this.isThinking = false;
          let after = remaining.slice(idx + 8);
          if (after.startsWith('\n')) after = after.slice(1);
          remaining = after;
        } else {
          this.writeStdout({ type: 'thinking_delta', sessionId, turn, delta: remaining });
          break;
        }
      }
    }
  }

  handleEvent(event: RuntimeEvent): void {
    switch (event.type) {
      case 'session_started':
        this.writeStdout({ type: 'session_start', sessionId: event.sessionId, sessionPath: event.sessionPath, mode: event.mode });
        break;
      case 'user_turn':
        this.writeStdout({ type: 'turn_start', sessionId: event.sessionId, turn: event.turn, content: event.content, source: event.source });
        break;
      case 'assistant_chunk':
        this.processChunk(event.sessionId, event.turn, event.chunk);
        break;
      case 'agent_thinking':
        this.writeStdout({ type: 'thinking_delta', sessionId: event.childId, turn: 0, delta: event.content });
        break;
      case 'assistant_message':
        this.isThinking = false;
        this.writeStdout({ type: 'turn_end', sessionId: event.sessionId, turn: event.turn, content: event.content });
        this.onTurnComplete?.();
        break;
      case 'tool_call_requested':
        this.writeStdout({ type: 'tool_call', sessionId: event.sessionId, turn: event.turn, callId: event.callId, toolName: event.toolName, input: event.input });
        break;
      case 'permission_decision':
        this.writeStdout({
          type: 'permission_decision',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          toolName: event.toolName,
          decision: event.decision,
          reason: event.reason,
          mode: event.mode,
        });
        break;
      case 'tool_started':
        this.writeStdout({ type: 'tool_started', sessionId: event.sessionId, turn: event.turn, callId: event.callId, toolName: event.toolName });
        break;
      case 'tool_result':
        this.writeStdout({ type: 'tool_result', sessionId: event.sessionId, turn: event.turn, callId: event.callId, toolName: event.toolName, status: 'success', output: event.output });
        break;
      case 'tool_failed':
        this.writeStdout({ type: 'tool_result', sessionId: event.sessionId, turn: event.turn, callId: event.callId, toolName: event.toolName, status: event.status, error: event.error });
        break;
      case 'usage_update':
        this.writeStdout({ type: 'usage', sessionId: event.sessionId, turn: event.turn, usage: event.usage, timing: event.timing });
        break;
      case 'session_ended':
        this.writeStdout({ type: 'session_ended', sessionId: event.sessionId, finishReason: event.finishReason, error: event.error });
        break;
      default:
        break;
    }
  }

  async handleEvents(events$: Observable<RuntimeEvent>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      events$.subscribe({
        next: (event) => this.handleEvent(event),
        error: (err) => {
          this.writeStderr(`[StreamJsonOutputAdapter] Error: ${String(err)}\n`);
          reject(err);
        },
        complete: () => resolve(),
      });
    });
  }
}
