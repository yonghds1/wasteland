/**
 * task-tools.ts - 任务管理工具集
 *
 * 提供任务的创建、更新、列表、详情功能。
 * 使用 JSON 文件存储任务（.wasteland/tasks.json）。
 *
 * ## 工具列表
 *
 * - task-create: 创建新任务（标题、描述、优先级）
 * - task-update: 更新任务状态（进行中、完成、阻塞）
 * - task-list: 列出所有任务
 * - task-get: 获取单个任务详情
 *
 * ## 存储格式
 *
 * 任务存储在 `.wasteland/tasks.json` 文件中，格式如下：
 * ```json
 * {
 *   "tasks": [
 *     {
 *       "id": "string",
 *       "title": "string",
 *       "description": "string",
 *       "status": "pending" | "in-progress" | "completed" | "blocked",
 *       "priority": "low" | "medium" | "high",
 *       "createdAt": "ISO string",
 *       "updatedAt": "ISO string"
 *     }
 *   ]
 * }
 * ```
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import type { AgentTool } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Types
// ============================================================

export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high';

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
};

export type TaskStore = {
  tasks: Task[];
};

// ============================================================
// Constants
// ============================================================

const TASKS_FILE = '.wasteland/tasks.json';

// ============================================================
// Storage Helpers
// ============================================================

/**
 * 获取任务文件路径
 */
function getTasksFilePath(cwd: string): string {
  return join(cwd, TASKS_FILE);
}

/**
 * 读取任务存储
 */
async function readTaskStore(cwd: string): Promise<TaskStore> {
  const filePath = getTasksFilePath(cwd);
  try {
    const content = await readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    return { tasks: data.tasks ?? [] };
  } catch {
    return { tasks: [] };
  }
}

/**
 * 写入任务存储
 */
async function writeTaskStore(cwd: string, store: TaskStore): Promise<void> {
  const filePath = getTasksFilePath(cwd);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Zod Schemas
// ============================================================

const taskStatusSchema = z.enum(['pending', 'in-progress', 'completed', 'blocked']);
const taskPrioritySchema = z.enum(['low', 'medium', 'high']);

const taskCreateInputSchema = z.object({
  title: z.string().min(1).describe('任务标题'),
  description: z.string().default('').describe('任务描述（可选）'),
  priority: taskPrioritySchema.default('medium').describe('优先级：low / medium / high'),
});

const taskUpdateInputSchema = z.object({
  id: z.string().min(1).describe('任务 ID'),
  status: taskStatusSchema.describe('新状态：pending / in-progress / completed / blocked'),
});

const taskGetInputSchema = z.object({
  id: z.string().min(1).describe('任务 ID'),
});

const taskListInputSchema = z.object({
  status: taskStatusSchema.optional().describe('按状态过滤（可选）'),
  priority: taskPrioritySchema.optional().describe('按优先级过滤（可选）'),
});

export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateInputSchema>;
export type TaskGetInput = z.infer<typeof taskGetInputSchema>;
export type TaskListInput = z.infer<typeof taskListInputSchema>;

// ============================================================
// Tool Factories
// ============================================================

/**
 * 创建 task-create 工具
 */
export function createTaskCreateTool(): AgentTool {
  return {
    name: 'task-create',
    riskLevel: 'write',
    description: '创建新任务，支持设置标题、描述和优先级',
    inputSchema: zodToJsonSchema(taskCreateInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = taskCreateInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const store = await readTaskStore(context.cwd);
        const now = new Date().toISOString();

        const task: Task = {
          id: generateId(),
          title: parsed.data.title,
          description: parsed.data.description,
          status: 'pending',
          priority: parsed.data.priority,
          createdAt: now,
          updatedAt: now,
        };

        store.tasks.push(task);
        await writeTaskStore(context.cwd, store);

        return {
          status: 'success',
          output: `任务已创建: ${task.id}\n标题: ${task.title}\n优先级: ${task.priority}`,
          data: task,
        };
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 创建 task-update 工具
 */
export function createTaskUpdateTool(): AgentTool {
  return {
    name: 'task-update',
    riskLevel: 'write',
    description: '更新任务状态（进行中、完成、阻塞）',
    inputSchema: zodToJsonSchema(taskUpdateInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = taskUpdateInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const store = await readTaskStore(context.cwd);
        const task = store.tasks.find(t => t.id === parsed.data.id);

        if (!task) {
          return {
            status: 'error',
            error: `任务不存在: ${parsed.data.id}`,
          };
        }

        task.status = parsed.data.status;
        task.updatedAt = new Date().toISOString();

        await writeTaskStore(context.cwd, store);

        return {
          status: 'success',
          output: `任务已更新: ${task.id}\n标题: ${task.title}\n状态: ${task.status}`,
          data: task,
        };
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 创建 task-list 工具
 */
export function createTaskListTool(): AgentTool {
  return {
    name: 'task-list',
    riskLevel: 'read',
    description: '列出所有任务，可按状态或优先级过滤',
    inputSchema: zodToJsonSchema(taskListInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = taskListInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const store = await readTaskStore(context.cwd);

        let tasks = store.tasks;

        // 按状态过滤
        if (parsed.data.status) {
          tasks = tasks.filter(t => t.status === parsed.data.status);
        }

        // 按优先级过滤
        if (parsed.data.priority) {
          tasks = tasks.filter(t => t.priority === parsed.data.priority);
        }

        if (tasks.length === 0) {
          return {
            status: 'success',
            output: '没有找到任务。',
            data: { tasks: [] },
          };
        }

        const lines = tasks.map(t =>
          `[${t.id}] ${t.title} (${t.status}, ${t.priority})`
        );

        return {
          status: 'success',
          output: `共 ${tasks.length} 个任务:\n${lines.join('\n')}`,
          data: { tasks },
        };
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 创建 task-get 工具
 */
export function createTaskGetTool(): AgentTool {
  return {
    name: 'task-get',
    riskLevel: 'read',
    description: '获取单个任务详情',
    inputSchema: zodToJsonSchema(taskGetInputSchema) as JsonSchema,

    async execute(input, context) {
      const parsed = taskGetInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const store = await readTaskStore(context.cwd);
        const task = store.tasks.find(t => t.id === parsed.data.id);

        if (!task) {
          return {
            status: 'error',
            error: `任务不存在: ${parsed.data.id}`,
          };
        }

        const lines = [
          `ID: ${task.id}`,
          `标题: ${task.title}`,
          `描述: ${task.description || '(无)'}`,
          `状态: ${task.status}`,
          `优先级: ${task.priority}`,
          `创建时间: ${task.createdAt}`,
          `更新时间: ${task.updatedAt}`,
        ];

        return {
          status: 'success',
          output: lines.join('\n'),
          data: task,
        };
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
