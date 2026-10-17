/**
 * notification-bridge.ts - 任务完成通知与会话输入回灌桥
 */

import { Subject, type Observable, type Subscription } from 'rxjs';
import type { ChatInputTurn } from './event-types.js';
import { getAsyncTaskManager, type AsyncTaskManager, type AsyncTaskRecord } from './async-task-manager.js';

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 格式化任务完成通知为符合 PRD 验收标准的 XML 结构（六字段齐全）
 * 包含：workflowId, runId, agentId, tokens, toolCalls, elapsedMs
 */
export function formatTaskNotification(task: AsyncTaskRecord): string {
  const content = task.status === 'failed' ? (task.error ?? 'Unknown error') : task.output;
  const serialized =
    content === undefined
      ? ''
      : typeof content === 'string'
      ? content
      : JSON.stringify(content, null, 2);

  const payloadTag = task.status === 'failed' ? 'error' : 'output';
  const meta = task.metadata ?? {};

  const workflowId = String(meta.workflowId ?? task.toolName.replace(/^workflow:/, ''));
  const runId = String(meta.runId ?? task.taskId);
  const agentId = String(meta.agentId ?? 'main');
  const tokens = Number(meta.tokens ?? 0);
  const toolCalls = Number(meta.toolCalls ?? 0);
  const elapsedMs = task.elapsedMs ?? 0;

  return [
    '<task-notification>',
    `  <workflowId>${escapeXml(workflowId)}</workflowId>`,
    `  <runId>${escapeXml(runId)}</runId>`,
    `  <agentId>${escapeXml(agentId)}</agentId>`,
    `  <status>${task.status}</status>`,
    `  <tokens>${tokens}</tokens>`,
    `  <toolCalls>${toolCalls}</toolCalls>`,
    `  <elapsedMs>${elapsedMs}</elapsedMs>`,
    `  <${payloadTag}>${escapeXml(serialized)}</${payloadTag}>`,
    '</task-notification>',
  ].join('\n');
}

/**
 * 通知桥：监听 AsyncTaskManager 完成事件并提供可合并的 notification$ 流
 */
export class NotificationBridge {
  private readonly notificationSubject$ = new Subject<ChatInputTurn>();
  private subscription: Subscription | null = null;
  private turnCounter = 5000;

  constructor(private readonly manager: AsyncTaskManager = getAsyncTaskManager()) {
    this.startListening();
  }

  get notification$(): Observable<ChatInputTurn> {
    return this.notificationSubject$.asObservable();
  }

  private startListening(): void {
    this.subscription = this.manager.onCompleted$.subscribe((task) => {
      this.turnCounter += 1;
      const turn: ChatInputTurn = {
        turn: this.turnCounter,
        content: formatTaskNotification(task),
        source: 'notification' as unknown as 'interactive',
      };
      this.notificationSubject$.next(turn);
    });
  }

  destroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.notificationSubject$.complete();
  }
}
