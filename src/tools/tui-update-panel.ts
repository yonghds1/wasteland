import type { AgentTool } from './tool-types.js';

export function createTuiUpdatePanelTool(): AgentTool {
  return {
    name: 'tui_update_panel',
    riskLevel: 'read',
    description: '专门用于更新用户界面（TUI）右侧的动态信息面板。用它来向用户广播你当前的高级计划、进度或重要提示。',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '任务或计划列表',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '任务简述' },
              status: { type: 'string', enum: ['pending', 'running', 'done', 'error'] },
            },
            required: ['title', 'status'],
          },
        },
      },
      required: ['tasks'],
    },
    async execute(params: any): Promise<any> {
      // 这是一个前端消费型的伪工具：实际状态并不存在后端，
      // 它的 args 会直接保存在 Session 的工具调用历史中。
      // TUI 只需要从历史记录里找到最新的 tui_update_panel 调用，即可解析并渲染出任务面板。
      const taskCount = Array.isArray(params.tasks) ? params.tasks.length : 0;
      return { status: 'success', output: `Panel successfully updated with ${taskCount} tasks.` };
    },
  };
}
