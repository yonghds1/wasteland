/**
 * a2a-presets.ts - A2A 官方协同智能体预设
 *
 * 预置主流 AI Coding 助手的本地 A2A 适配配置。
 * 默认端口从 9041 开始分配：
 * - claude_code: 9041
 * - codex: 9042
 * - antigravity: 9043
 */

export type A2APreset = {
  id: string;
  name: string;
  label: string;
  serverName: string;
  command: string;
  defaultPort: number;
  description: string;
  toolName: string;
};

export const A2A_PRESETS: A2APreset[] = [
  {
    id: 'claude_code',
    name: 'claude_code',
    label: 'Claude Code',
    serverName: 'claude-code',
    command: 'claude',
    defaultPort: 9041,
    description: '调用本地 Claude Code 智能体执行全工程检索、重构与跨文件编码任务',
    toolName: 'a2a_claude_code',
  },
  {
    id: 'codex',
    name: 'codex',
    label: 'Codex CLI',
    serverName: 'codex',
    command: 'codex-cli',
    defaultPort: 9042,
    description: '调用本地 Codex CLI 智能体执行底层原子化代码生成、修补与测试编写',
    toolName: 'a2a_codex',
  },
  {
    id: 'antigravity',
    name: 'antigravity',
    label: 'Google Antigravity (AGY)',
    serverName: 'antigravity',
    command: 'agy',
    defaultPort: 9043,
    description: '调用 Google Antigravity (AGY) 智能体执行总监级架构分析、多智能体协同与规划',
    toolName: 'a2a_antigravity',
  },
];
