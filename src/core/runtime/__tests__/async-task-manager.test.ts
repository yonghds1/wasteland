import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import {
  AsyncTaskManager,
  type AsyncTaskRecord,
} from '../async-task-manager.js';
import {
  formatTaskNotification,
  NotificationBridge,
} from '../notification-bridge.js';

describe('AsyncTaskManager & NotificationBridge (PRD Compliance)', () => {
  let manager: AsyncTaskManager;

  beforeEach(() => {
    manager = new AsyncTaskManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  it('registers a task with promise that succeeds', async () => {
    const completedPromise = firstValueFrom(manager.onCompleted$);

    const { taskId } = manager.register(
      'test-tool',
      Promise.resolve({ result: 42 })
    );

    const completed = await completedPromise;
    expect(completed.taskId).toBe(taskId);
    expect(completed.toolName).toBe('test-tool');
    expect(completed.status).toBe('succeeded');
    expect(completed.output).toEqual({ result: 42 });
    expect(typeof completed.elapsedMs).toBe('number');
  });

  it('registers a task with promise that fails', async () => {
    const completedPromise = firstValueFrom(manager.onCompleted$);

    const { taskId } = manager.register(
      'failing-tool',
      Promise.reject(new Error('Boom!'))
    );

    const completed = await completedPromise;
    expect(completed.taskId).toBe(taskId);
    expect(completed.status).toBe('failed');
    expect(completed.error).toContain('Boom!');
  });

  it('formats task notification with all 6 required fields from PRD', () => {
    const task: AsyncTaskRecord = {
      taskId: 'task-1234',
      toolName: 'workflow:review',
      status: 'succeeded',
      startTime: 1000,
      endTime: 2500,
      elapsedMs: 1500,
      output: 'All tests passed',
      metadata: {
        workflowId: 'review',
        runId: 'run-5678',
        agentId: 'reviewer-agent',
        tokens: 3420,
        toolCalls: 5,
      },
    };

    const xml = formatTaskNotification(task);
    expect(xml).toContain('<workflowId>review</workflowId>');
    expect(xml).toContain('<runId>run-5678</runId>');
    expect(xml).toContain('<agentId>reviewer-agent</agentId>');
    expect(xml).toContain('<status>succeeded</status>');
    expect(xml).toContain('<tokens>3420</tokens>');
    expect(xml).toContain('<toolCalls>5</toolCalls>');
    expect(xml).toContain('<elapsedMs>1500</elapsedMs>');
    expect(xml).toContain('<output>All tests passed</output>');
  });

  it('bridges notifications to a notification$ Observable', async () => {
    const bridge = new NotificationBridge(manager);
    const receivedPromise = firstValueFrom(bridge.notification$);

    manager.register('bridge-tool', Promise.resolve('data'), {
      workflowId: 'test-wf',
      runId: 'run-999',
    });

    const turn = await receivedPromise;
    expect(turn.content).toContain('<workflowId>test-wf</workflowId>');
    expect(turn.content).toContain('<runId>run-999</runId>');
    expect(turn.content).toContain('<status>succeeded</status>');

    bridge.destroy();
  });
});
