/**
 * async-task-manager.ts - 通用异步后台任务管理器
 *
 * 管理长耗时工具调用的生命周期，提供全局事件订阅
 */

import { Subject, type Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';

export type AsyncTaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AsyncTaskRecord<T = unknown> {
  taskId: string;
  toolName: string;
  status: AsyncTaskStatus;
  startTime: number;
  endTime?: number;
  elapsedMs?: number;
  output?: T;
  error?: string;
  metadata?: {
    workflowId?: string;
    runId?: string;
    agentId?: string;
    tokens?: number;
    toolCalls?: number;
    [key: string]: unknown;
  };
}

export class AsyncTaskManager {
  private readonly tasks = new Map<string, AsyncTaskRecord>();
  private readonly completedSubject$ = new Subject<AsyncTaskRecord>();

  /**
   * 任务完成/失败的事件流
   */
  get onCompleted$(): Observable<AsyncTaskRecord> {
    return this.completedSubject$.asObservable();
  }

  /**
   * 注册并启动一个后台异步任务
   */
  register<T = unknown>(
    toolName: string,
    promiseOrFn?: Promise<T> | (() => Promise<T>),
    metadata?: Record<string, unknown>
  ): { taskId: string } {
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const record: AsyncTaskRecord<T> = {
      taskId,
      toolName,
      status: 'running',
      startTime: Date.now(),
      metadata,
    };

    this.tasks.set(taskId, record as AsyncTaskRecord<unknown>);

    if (promiseOrFn) {
      const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
      promise
        .then((result) => {
          this.complete(taskId, result);
        })
        .catch((err) => {
          this.fail(taskId, err instanceof Error ? err.message : String(err));
        });
    }

    return { taskId };
  }

  /**
   * 标记任务完成
   */
  complete<T = unknown>(
    taskId: string,
    output?: T,
    metadataUpdate?: Record<string, unknown>
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    const endTime = Date.now();
    task.status = 'succeeded';
    task.endTime = endTime;
    task.elapsedMs = endTime - task.startTime;
    task.output = output;
    if (metadataUpdate) {
      task.metadata = { ...(task.metadata ?? {}), ...metadataUpdate };
    }

    this.completedSubject$.next({ ...task });
    return true;
  }

  /**
   * 标记任务失败
   */
  fail(
    taskId: string,
    error: string,
    metadataUpdate?: Record<string, unknown>
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    const endTime = Date.now();
    task.status = 'failed';
    task.endTime = endTime;
    task.elapsedMs = endTime - task.startTime;
    task.error = error;
    if (metadataUpdate) {
      task.metadata = { ...(task.metadata ?? {}), ...metadataUpdate };
    }

    this.completedSubject$.next({ ...task });
    return true;
  }

  /**
   * 查询任务
   */
  get(taskId: string): AsyncTaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 列出所有任务
   */
  list(): AsyncTaskRecord[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.completedSubject$.complete();
    this.tasks.clear();
  }
}

// 全局单例
let globalTaskManager: AsyncTaskManager | null = null;

export function getAsyncTaskManager(): AsyncTaskManager {
  if (!globalTaskManager) {
    globalTaskManager = new AsyncTaskManager();
  }
  return globalTaskManager;
}

export function resetAsyncTaskManager(): void {
  if (globalTaskManager) {
    globalTaskManager.destroy();
    globalTaskManager = null;
  }
}
