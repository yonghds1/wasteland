/**
 * a2a-integration.test.ts - A2A 端到端集成测试
 *
 * 测试完整链路：config → tool registration → A2A protocol → result
 *
 * ## 测试场景
 *
 * 1. 启动真实 A2A 测试服务器
 * 2. 通过 config 注册 A2A 工具
 * 3. 通过 A2AClient 执行协议通信
 * 4. 验证完整链路：config → tool → A2A protocol → result
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ClaudeCodeA2AServer } from './a2a-claude-code-adapter.js';
import { A2AClient } from './a2a-client.js';
import { createDefaultToolRegistry } from '@tools/core/default-registry.js';
import { filterToolRegistry, MAIN_AGENT_TOOL_NAMES } from '../core/engine/agent-loop.js';
import type { A2ASettings } from '../config/settings-types.js';

// ============================================================
// 测试服务器配置
// ============================================================

const TEST_PORT = 19876; // 固定端口避免冲突
const TEST_URL = `http://localhost:${TEST_PORT}`;

// ============================================================
// 测试套件
// ============================================================

describe('A2A 端到端集成', () => {
  let server: ClaudeCodeA2AServer;

  beforeAll(async () => {
    // 启动测试服务器
    server = new ClaudeCodeA2AServer({ port: TEST_PORT });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('1. 配置 → 工具注册链路', () => {
    it('a2a.agents 配置正确注册为 a2a_<name> 工具', () => {
      const a2aSettings: A2ASettings = {
        agents: [
          {
            name: 'echo-agent',
            url: TEST_URL,
            description: 'Echo agent for testing',
          },
        ],
        servers: {},
      };

      const { toolRegistry } = createDefaultToolRegistry({ a2a: a2aSettings });

      // 验证工具已注册
      const tool = toolRegistry.get('a2a_echo-agent');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('a2a_echo-agent');
      expect(tool?.description).toBe('Echo agent for testing');
      expect(tool?.riskLevel).toBe('execute');
    });

    it('多个 A2A agents 全部注册', () => {
      const a2aSettings: A2ASettings = {
        agents: [
          { name: 'agent-1', url: 'http://localhost:9201' },
          { name: 'agent-2', url: 'http://localhost:9202' },
          { name: 'agent-3', url: 'http://localhost:9203' },
        ],
        servers: {},
      };

      const { toolRegistry } = createDefaultToolRegistry({ a2a: a2aSettings });

      expect(toolRegistry.get('a2a_agent-1')).toBeDefined();
      expect(toolRegistry.get('a2a_agent-2')).toBeDefined();
      expect(toolRegistry.get('a2a_agent-3')).toBeDefined();
    });
  });

  describe('2. A2A 协议通信', () => {
    it('A2AClient 能发现 Agent Card', async () => {
      const client = new A2AClient({ baseUrl: TEST_URL });
      const card = await client.discoverAgent();

      expect(card.name).toBe('claude-code');
      expect(card.capabilities.streaming).toBe(true);
    });

    it('A2AClient 能发送异步任务', async () => {
      const client = new A2AClient({ baseUrl: TEST_URL, timeoutMs: 5000 });
      const taskId = await client.sendTaskAsync('test task');

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
    });

    it('A2AClient 能查询任务状态', async () => {
      const client = new A2AClient({ baseUrl: TEST_URL, timeoutMs: 5000 });
      const taskId = await client.sendTaskAsync('query test');
      const task = await client.getTask(taskId);

      expect(task.id).toBe(taskId);
      expect(task.status.state).toBeDefined();
    });
  });

  describe('3. 工具执行链路', () => {
    it('a2a_<name> 工具能构造正确的 A2AClient', async () => {
      const a2aSettings: A2ASettings = {
        agents: [
          {
            name: 'test-server',
            url: TEST_URL,
            description: 'Test A2A server',
            token: 'test-token',
          },
        ],
        servers: {},
      };

      const { toolRegistry } = createDefaultToolRegistry({ a2a: a2aSettings });
      const tool = toolRegistry.get('a2a_test-server');

      expect(tool).toBeDefined();
      expect(tool?.name).toBe('a2a_test-server');

      // 验证工具元数据
      if (tool) {
        expect(tool.riskLevel).toBe('execute');
        expect(tool.description).toBe('Test A2A server');
        expect(tool.inputSchema).toEqual({
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: expect.any(String),
            },
          },
          required: ['task'],
        });
      }
    });

    it('工具执行失败时返回 error 结果（不抛异常）', async () => {
      const a2aSettings: A2ASettings = {
        agents: [
          {
            name: 'unreachable-server',
            url: 'http://localhost:19999', // 未启动的服务器
            description: 'Unreachable server',
          },
        ],
        servers: {},
      };

      const { toolRegistry } = createDefaultToolRegistry({ a2a: a2aSettings });
      const tool = toolRegistry.get('a2a_unreachable-server');

      expect(tool).toBeDefined();

      // 执行工具（应该返回 error 而不是抛异常）
      const result = await tool!.execute(
        { task: 'should fail' },
        { sessionId: 'test-session', turn: 1, cwd: '/tmp' }
      );

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('4. 工具过滤集成', () => {
    it('filterToolRegistry 放行 a2a_ 前缀工具', () => {
      const a2aSettings: A2ASettings = {
        agents: [
          { name: 'filtered-agent', url: TEST_URL },
        ],
        servers: {},
      };

      const { toolRegistry } = createDefaultToolRegistry({ a2a: a2aSettings });
      const filtered = filterToolRegistry(toolRegistry, MAIN_AGENT_TOOL_NAMES);

      // 验证 a2a_ 工具被放行
      expect(filtered.list()).toContain('a2a_filtered-agent');
      // 验证其他工具被过滤
      expect(filtered.list()).not.toContain('edit-file');
      expect(filtered.list()).not.toContain('write-file');
    });

    it('子 agent 继承包含 a2a_ 工具的 registry', () => {
      const a2aSettings: A2ASettings = {
        agents: [
          { name: 'child-agent', url: TEST_URL },
        ],
        servers: {},
      };

      const { toolRegistry } = createDefaultToolRegistry({ a2a: a2aSettings });
      const filtered = filterToolRegistry(toolRegistry, MAIN_AGENT_TOOL_NAMES);

      // 子 agent 通过继承 filtered registry 获得 a2a_ 工具
      expect(filtered.list()).toContain('a2a_child-agent');
      expect(filtered.list()).toContain('spawn_agent');
      expect(filtered.list()).toContain('read-file');
      expect(filtered.list()).toContain('bash');
    });
  });
});
