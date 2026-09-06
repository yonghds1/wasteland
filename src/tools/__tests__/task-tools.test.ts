/**
 * task-tools.test.ts - 任务管理工具单元测试
 *
 * 覆盖：
 * - task-create: 创建任务
 * - task-update: 更新任务状态
 * - task-list: 列出任务
 * - task-get: 获取任务详情
 * - 持久化: JSON 文件存储
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskListTool,
  createTaskGetTool,
} from '../agent/task-tools.js';
import type { TaskStore } from '../agent/task-tools.js';
import type { ToolExecutionContext, ToolExecutionResult, ToolSuccessResult, ToolErrorResult } from '../core/tool-types.js';

// ============================================================
// Test Helpers
// ============================================================

const TEST_DIR = join(import.meta.dirname, '../../.test-tasks');

function isSuccess(result: ToolExecutionResult): result is ToolSuccessResult {
  return result.status === 'success';
}

function isError(result: ToolExecutionResult): result is ToolErrorResult {
  return result.status === 'error';
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    sessionId: 'test-session',
    turn: 1,
    cwd: TEST_DIR,
    ...overrides,
  };
}

function resetTasksDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.wasteland'), { recursive: true });
}

function readTasksFile(): TaskStore {
  const content = readFileSync(join(TEST_DIR, '.wasteland/tasks.json'), 'utf8');
  return JSON.parse(content);
}

// ============================================================
// Tests
// ============================================================

describe('task-create', () => {
  const tool = createTaskCreateTool();

  beforeEach(() => {
    resetTasksDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('创建任务并返回成功', async () => {
    const result = await tool.execute(
      { title: '测试任务', description: '这是一个测试', priority: 'high' },
      makeContext()
    );

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('任务已创建');
      expect(result.output).toContain('测试任务');
      expect(result.data).toMatchObject({
        title: '测试任务',
        description: '这是一个测试',
        status: 'pending',
        priority: 'high',
      });
    }
  });

  it('默认优先级为 medium', async () => {
    const result = await tool.execute({ title: '默认优先级' }, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect((result.data as any).priority).toBe('medium');
    }
  });

  it('默认描述为空', async () => {
    const result = await tool.execute({ title: '无描述' }, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect((result.data as any).description).toBe('');
    }
  });

  it('持久化到 JSON 文件', async () => {
    await tool.execute({ title: '持久化测试' }, makeContext());

    const store = readTasksFile();
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].title).toBe('持久化测试');
  });

  it('多次创建任务', async () => {
    await tool.execute({ title: '任务1' }, makeContext());
    await tool.execute({ title: '任务2' }, makeContext());
    await tool.execute({ title: '任务3' }, makeContext());

    const store = readTasksFile();
    expect(store.tasks).toHaveLength(3);
  });

  it('缺少 title 返回错误', async () => {
    const result = await tool.execute({}, makeContext());

    expect(result.status).toBe('error');
    if (isError(result)) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('task-update', () => {
  const createTool = createTaskCreateTool();
  const updateTool = createTaskUpdateTool();

  beforeEach(() => {
    resetTasksDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('更新任务状态', async () => {
    const createResult = await createTool.execute({ title: '待更新' }, makeContext());
    let taskId: string = '';
    if (isSuccess(createResult)) {
      taskId = (createResult.data as any).id;
    }

    const result = await updateTool.execute(
      { id: taskId, status: 'in-progress' },
      makeContext()
    );

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('任务已更新');
      expect(result.output).toContain('in-progress');
    }
  });

  it('更新不存在的任务返回错误', async () => {
    const result = await updateTool.execute(
      { id: 'nonexistent', status: 'completed' },
      makeContext()
    );

    expect(result.status).toBe('error');
    if (isError(result)) {
      expect(result.error).toContain('任务不存在');
    }
  });

  it('更新后持久化', async () => {
    const createResult = await createTool.execute({ title: '持久化更新' }, makeContext());
    let taskId: string = '';
    if (isSuccess(createResult)) {
      taskId = (createResult.data as any).id;
    }

    await updateTool.execute({ id: taskId, status: 'completed' }, makeContext());

    const store = readTasksFile();
    const task = store.tasks.find(t => t.id === taskId);
    expect(task?.status).toBe('completed');
  });

  it('缺少 id 返回错误', async () => {
    const result = await updateTool.execute({ status: 'completed' }, makeContext());

    expect(result.status).toBe('error');
    if (isError(result)) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('task-list', () => {
  const createTool = createTaskCreateTool();
  const listTool = createTaskListTool();

  beforeEach(() => {
    resetTasksDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('列出所有任务', async () => {
    await createTool.execute({ title: '任务A' }, makeContext());
    await createTool.execute({ title: '任务B' }, makeContext());

    const result = await listTool.execute({}, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('共 2 个任务');
      expect(result.output).toContain('任务A');
      expect(result.output).toContain('任务B');
    }
  });

  it('无任务时返回提示', async () => {
    const result = await listTool.execute({}, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('没有找到任务');
    }
  });

  it('按状态过滤', async () => {
    await createTool.execute({ title: '任务1' }, makeContext());
    await createTool.execute({ title: '任务2' }, makeContext());

    const store = readTasksFile();
    store.tasks[0].status = 'completed';
    writeFileSync(join(TEST_DIR, '.wasteland/tasks.json'), JSON.stringify(store, null, 2));

    const result = await listTool.execute({ status: 'completed' }, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('共 1 个任务');
      expect(result.output).toContain('任务1');
    }
  });

  it('按优先级过滤', async () => {
    await createTool.execute({ title: '高优先级', priority: 'high' }, makeContext());
    await createTool.execute({ title: '低优先级', priority: 'low' }, makeContext());

    const result = await listTool.execute({ priority: 'high' }, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('共 1 个任务');
      expect(result.output).toContain('高优先级');
    }
  });
});

describe('task-get', () => {
  const createTool = createTaskCreateTool();
  const getTool = createTaskGetTool();

  beforeEach(() => {
    resetTasksDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('获取任务详情', async () => {
    const createResult = await createTool.execute(
      { title: '详情测试', description: '这是描述', priority: 'high' },
      makeContext()
    );
    let taskId: string = '';
    if (isSuccess(createResult)) {
      taskId = (createResult.data as any).id;
    }

    const result = await getTool.execute({ id: taskId }, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain(`ID: ${taskId}`);
      expect(result.output).toContain('标题: 详情测试');
      expect(result.output).toContain('描述: 这是描述');
      expect(result.output).toContain('状态: pending');
      expect(result.output).toContain('优先级: high');
    }
  });

  it('获取不存在的任务返回错误', async () => {
    const result = await getTool.execute({ id: 'nonexistent' }, makeContext());

    expect(result.status).toBe('error');
    if (isError(result)) {
      expect(result.error).toContain('任务不存在');
    }
  });

  it('无描述时显示占位符', async () => {
    const createResult = await createTool.execute({ title: '无描述' }, makeContext());
    let taskId: string = '';
    if (isSuccess(createResult)) {
      taskId = (createResult.data as any).id;
    }

    const result = await getTool.execute({ id: taskId }, makeContext());

    expect(result.status).toBe('success');
    if (isSuccess(result)) {
      expect(result.output).toContain('描述: (无)');
    }
  });

  it('缺少 id 返回错误', async () => {
    const result = await getTool.execute({}, makeContext());

    expect(result.status).toBe('error');
    if (isError(result)) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('持久化集成', () => {
  const createTool = createTaskCreateTool();
  const updateTool = createTaskUpdateTool();
  const listTool = createTaskListTool();
  const getTool = createTaskGetTool();

  beforeEach(() => {
    resetTasksDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('完整生命周期：创建 → 更新 → 列表 → 详情', async () => {
    // 创建
    const createResult = await createTool.execute(
      { title: '生命周期测试', priority: 'high' },
      makeContext()
    );
    expect(createResult.status).toBe('success');
    let taskId: string = '';
    if (isSuccess(createResult)) {
      taskId = (createResult.data as any).id;
    }

    // 更新为进行中
    const updateResult = await updateTool.execute(
      { id: taskId, status: 'in-progress' },
      makeContext()
    );
    expect(updateResult.status).toBe('success');

    // 列表
    const listResult = await listTool.execute({}, makeContext());
    expect(listResult.status).toBe('success');
    if (isSuccess(listResult)) {
      expect((listResult.data as any).tasks).toHaveLength(1);
      expect((listResult.data as any).tasks[0].status).toBe('in-progress');
    }

    // 详情
    const getResult = await getTool.execute({ id: taskId }, makeContext());
    expect(getResult.status).toBe('success');
    if (isSuccess(getResult)) {
      expect(getResult.output).toContain('状态: in-progress');
    }
  });

  it('任务数据在多次调用间持久化', async () => {
    await createTool.execute({ title: '持久任务1' }, makeContext());
    await createTool.execute({ title: '持久任务2' }, makeContext());

    // 读取文件验证
    const store = readTasksFile();
    expect(store.tasks).toHaveLength(2);
    expect(store.tasks.map(t => t.title)).toContain('持久任务1');
    expect(store.tasks.map(t => t.title)).toContain('持久任务2');
  });
});
