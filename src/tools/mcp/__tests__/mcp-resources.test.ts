/**
 * MCP Resources 和 Prompts 工具测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpResourceListTool, McpResourceReadTool, McpPromptListTool, McpPromptGetTool } from '../mcp-resources.js';
import type { MCPClient } from '../mcp-client.js';

describe('MCP Resources Tools', () => {
  let mockClients: Map<string, MCPClient>;

  beforeEach(() => {
    mockClients = new Map();
  });

  describe('McpResourceListTool', () => {
    it('should list resources from MCP server', async () => {
      const mockClient = {
        listResources: vi.fn().mockResolvedValue([
          { uri: 'file:///test.txt', name: 'test.txt', description: 'Test file' },
        ]),
      } as unknown as MCPClient;

      mockClients.set('test-server', mockClient);

      const tool = new McpResourceListTool(mockClients);
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.output).toContain('test.txt');
        expect(result.output).toContain('file:///test.txt');
      }
    });

    it('should return error when no servers available', async () => {
      const tool = new McpResourceListTool(mockClients);
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('No MCP servers available');
      }
    });

    it('should return error when specific server not found', async () => {
      const tool = new McpResourceListTool(mockClients);
      const result = await tool.execute(
        { server: 'nonexistent' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('MCP server not found');
      }
    });
  });

  describe('McpResourceReadTool', () => {
    it('should read resource content', async () => {
      const mockClient = {
        readResource: vi.fn().mockResolvedValue({
          contents: [{ uri: 'file:///test.txt', text: 'Hello, World!' }],
        }),
      } as unknown as MCPClient;

      mockClients.set('test-server', mockClient);

      const tool = new McpResourceReadTool(mockClients);
      const result = await tool.execute(
        { uri: 'file:///test.txt' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.output).toContain('Hello, World!');
      }
    });

    it('should return error when URI is missing', async () => {
      const tool = new McpResourceReadTool(mockClients);
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('URI is required');
      }
    });
  });

  describe('McpPromptListTool', () => {
    it('should list prompts from MCP server', async () => {
      const mockClient = {
        listPrompts: vi.fn().mockResolvedValue([
          { name: 'code-review', description: 'Review code' },
        ]),
      } as unknown as MCPClient;

      mockClients.set('test-server', mockClient);

      const tool = new McpPromptListTool(mockClients);
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.output).toContain('code-review');
        expect(result.output).toContain('Review code');
      }
    });

    it('should return error when no servers available', async () => {
      const tool = new McpPromptListTool(mockClients);
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('No MCP servers available');
      }
    });
  });

  describe('McpPromptGetTool', () => {
    it('should get prompt content', async () => {
      const mockClient = {
        getPrompt: vi.fn().mockResolvedValue({
          description: 'Code review prompt',
          messages: [
            { role: 'user', content: { type: 'text', text: 'Review this code' } },
          ],
        }),
      } as unknown as MCPClient;

      mockClients.set('test-server', mockClient);

      const tool = new McpPromptGetTool(mockClients);
      const result = await tool.execute(
        { name: 'code-review' },
        { sessionId: 'test', turn: 1, cwd: '/tmp' }
      );

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.output).toContain('Code review prompt');
        expect(result.output).toContain('Review this code');
      }
    });

    it('should return error when name is missing', async () => {
      const tool = new McpPromptGetTool(mockClients);
      const result = await tool.execute({}, { sessionId: 'test', turn: 1, cwd: '/tmp' });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Prompt name is required');
      }
    });
  });
});
