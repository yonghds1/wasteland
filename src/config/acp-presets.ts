/**
 * acp-presets.ts - ACP 官方协同智能体预设
 *
 * 预置主流 AI Coding 助手的 ACP（stdio JSON-RPC）适配配置。
 * agent 以子进程启动，无端口概念。
 * 包名与可用性经 P0 冒烟/registry 查证
 * （见 .trellis/tasks/09-13-a2a-to-acp/research/）：
 * - claude_code: @agentclientprotocol/claude-agent-acp（旧 zed 包已 deprecated）
 * - codex: @zed-industries/codex-acp
 * - antigravity: 无已证实 ACP 适配器，不设 preset（走自定义 command）
 */

import type { AcpAgentConfig } from './settings-types.js';

export type AcpPreset = {
  id: string;
  name: string;
  label: string;
  description: string;
  /** 生成一条可直接写入 settings.acp.agents 的配置 */
  toAgentConfig: () => AcpAgentConfig;
};

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'claude_code',
    name: 'claude_code',
    label: 'Claude Code',
    description: '调用本地 Claude Code 智能体执行全工程检索、重构与跨文件编码任务',
    toAgentConfig: () => ({
      name: 'claude_code',
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp'],
      description: '调用本地 Claude Code 智能体执行全工程检索、重构与跨文件编码任务',
    }),
  },
  {
    id: 'codex',
    name: 'codex',
    label: 'Codex CLI',
    description: '调用本地 Codex CLI 智能体执行原子化代码生成、修补与测试编写',
    toAgentConfig: () => ({
      name: 'codex',
      command: 'npx',
      args: ['-y', '@zed-industries/codex-acp'],
      description: '调用本地 Codex CLI 智能体执行原子化代码生成、修补与测试编写',
    }),
  },
];
