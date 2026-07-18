/**
 * 代码助手适配器测试
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  createCodeAssistantTool,
  createCodeAssistantStreamTool,
} from './code-assistant-adapter.js';

describe('Code Assistant Adapter', () => {
  describe('ClaudeCodeAdapter', () => {
    it('should have correct name', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.name).toBe('claude-code');
    });

    it('should create tool with correct metadata', () => {
      const adapter = new ClaudeCodeAdapter();
      const tool = createCodeAssistantTool(adapter);

      expect(tool.name).toBe('code-assistant-claude-code');
      expect(tool.riskLevel).toBe('execute');
      expect(tool.inputSchema?.properties).toHaveProperty('task');
    });

    it('should create stream tool with correct metadata', () => {
      const adapter = new ClaudeCodeAdapter();
      const tool = createCodeAssistantStreamTool(adapter);

      expect(tool.name).toBe('code-assistant-claude-code-stream');
      expect(tool.riskLevel).toBe('execute');
    });

    it('should return error when task is missing', async () => {
      const adapter = new ClaudeCodeAdapter();
      const tool = createCodeAssistantTool(adapter);

      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });
      expect(result.status).toBe('error');
    });
  });

  describe('CodexAdapter', () => {
    it('should have correct name', () => {
      const adapter = new CodexAdapter();
      expect(adapter.name).toBe('codex');
    });

    it('should create tool with correct metadata', () => {
      const adapter = new CodexAdapter();
      const tool = createCodeAssistantTool(adapter);

      expect(tool.name).toBe('code-assistant-codex');
      expect(tool.riskLevel).toBe('execute');
    });
  });

  describe('Custom Config', () => {
    it('should accept custom config', () => {
      const adapter = new ClaudeCodeAdapter({
        command: '/usr/local/bin/claude',
        timeoutMs: 60000,
      });

      // name is always 'claude-code' for ClaudeCodeAdapter
      expect(adapter.name).toBe('claude-code');
    });
  });
});
