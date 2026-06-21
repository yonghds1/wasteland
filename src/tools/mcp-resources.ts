/**
 * mcp-resources.ts - MCP Resources 和 Prompts 工具
 *
 * 将 MCP Resources 和 Prompts 功能包装为 AgentTool，
 * 使 Agent 可以直接调用这些功能。
 *
 * ## 工具列表
 *
 * - mcp-resource-list: 列出服务器暴露的资源
 * - mcp-resource-read: 读取资源内容
 * - mcp-prompt-list: 列出服务器提供的提示词模板
 * - mcp-prompt-get: 获取提示词模板内容
 */

import type { AgentTool, ToolInput, ToolExecutionContext, ToolExecutionResult } from './tool-types.js';
import type { MCPClient, MCPResourceDefinition, MCPPromptDefinition } from './mcp-client.js';

// ============================================================
// MCP Resource 工具
// ============================================================

/**
 * MCP 资源列表工具
 *
 * 列出 MCP 服务器暴露的所有资源。
 */
export class McpResourceListTool implements AgentTool {
  readonly name = 'mcp-resource-list';
  readonly description = 'List resources exposed by an MCP server';
  readonly riskLevel = 'read' as const;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      server: {
        type: 'string',
        description: 'MCP server name (optional, uses first server if not specified)',
      },
    },
  };

  constructor(private clients: Map<string, MCPClient>) {}

  async execute(
    input: ToolInput,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const serverName = input.server as string | undefined;

    // 获取客户端
    const client = this.getClient(serverName);
    if (!client) {
      return {
        status: 'error',
        error: serverName
          ? `MCP server not found: ${serverName}`
          : 'No MCP servers available',
      };
    }

    try {
      const resources = await client.listResources();
      return {
        status: 'success',
        output: this.formatResources(resources),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getClient(serverName?: string): MCPClient | undefined {
    if (serverName) {
      return this.clients.get(serverName);
    }
    // 返回第一个可用的客户端
    return this.clients.values().next().value;
  }

  private formatResources(resources: MCPResourceDefinition[]): string {
    if (resources.length === 0) {
      return 'No resources available.';
    }

    const lines = ['Available Resources:', ''];
    for (const resource of resources) {
      lines.push(`- ${resource.name}`);
      lines.push(`  URI: ${resource.uri}`);
      if (resource.description) {
        lines.push(`  Description: ${resource.description}`);
      }
      if (resource.mimeType) {
        lines.push(`  MIME Type: ${resource.mimeType}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * MCP 资源读取工具
 *
 * 读取 MCP 服务器暴露的资源内容。
 */
export class McpResourceReadTool implements AgentTool {
  readonly name = 'mcp-resource-read';
  readonly description = 'Read content from an MCP resource';
  readonly riskLevel = 'read' as const;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      uri: {
        type: 'string',
        description: 'Resource URI to read',
      },
      server: {
        type: 'string',
        description: 'MCP server name (optional)',
      },
    },
    required: ['uri'],
  };

  constructor(private clients: Map<string, MCPClient>) {}

  async execute(
    input: ToolInput,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const uri = input.uri as string;
    const serverName = input.server as string | undefined;

    if (!uri) {
      return {
        status: 'error',
        error: 'URI is required',
      };
    }

    // 获取客户端
    const client = this.getClient(serverName);
    if (!client) {
      return {
        status: 'error',
        error: serverName
          ? `MCP server not found: ${serverName}`
          : 'No MCP servers available',
      };
    }

    try {
      const result = await client.readResource(uri);
      return {
        status: 'success',
        output: this.formatResourceContent(result),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getClient(serverName?: string): MCPClient | undefined {
    if (serverName) {
      return this.clients.get(serverName);
    }
    return this.clients.values().next().value;
  }

  private formatResourceContent(result: { contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }): string {
    if (result.contents.length === 0) {
      return 'No content available.';
    }

    const lines: string[] = [];
    for (const content of result.contents) {
      lines.push(`Resource: ${content.uri}`);
      if (content.mimeType) {
        lines.push(`MIME Type: ${content.mimeType}`);
      }
      if (content.text) {
        lines.push('Content:');
        lines.push(content.text);
      } else if (content.blob) {
        lines.push('Content: [Binary data]');
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ============================================================
// MCP Prompt 工具
// ============================================================

/**
 * MCP 提示词列表工具
 *
 * 列出 MCP 服务器提供的所有提示词模板。
 */
export class McpPromptListTool implements AgentTool {
  readonly name = 'mcp-prompt-list';
  readonly description = 'List prompt templates provided by an MCP server';
  readonly riskLevel = 'read' as const;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      server: {
        type: 'string',
        description: 'MCP server name (optional)',
      },
    },
  };

  constructor(private clients: Map<string, MCPClient>) {}

  async execute(
    input: ToolInput,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const serverName = input.server as string | undefined;

    const client = this.getClient(serverName);
    if (!client) {
      return {
        status: 'error',
        error: serverName
          ? `MCP server not found: ${serverName}`
          : 'No MCP servers available',
      };
    }

    try {
      const prompts = await client.listPrompts();
      return {
        status: 'success',
        output: this.formatPrompts(prompts),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getClient(serverName?: string): MCPClient | undefined {
    if (serverName) {
      return this.clients.get(serverName);
    }
    return this.clients.values().next().value;
  }

  private formatPrompts(prompts: MCPPromptDefinition[]): string {
    if (prompts.length === 0) {
      return 'No prompts available.';
    }

    const lines = ['Available Prompts:', ''];
    for (const prompt of prompts) {
      lines.push(`- ${prompt.name}`);
      if (prompt.description) {
        lines.push(`  Description: ${prompt.description}`);
      }
      if (prompt.arguments && prompt.arguments.length > 0) {
        lines.push('  Arguments:');
        for (const arg of prompt.arguments) {
          const required = arg.required ? ' (required)' : '';
          lines.push(`    - ${arg.name}${required}`);
          if (arg.description) {
            lines.push(`      ${arg.description}`);
          }
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * MCP 提示词获取工具
 *
 * 获取 MCP 服务器提供的提示词模板内容。
 */
export class McpPromptGetTool implements AgentTool {
  readonly name = 'mcp-prompt-get';
  readonly description = 'Get content from an MCP prompt template';
  readonly riskLevel = 'read' as const;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'Prompt template name',
      },
      arguments: {
        type: 'object',
        description: 'Prompt arguments (optional)',
      },
      server: {
        type: 'string',
        description: 'MCP server name (optional)',
      },
    },
    required: ['name'],
  };

  constructor(private clients: Map<string, MCPClient>) {}

  async execute(
    input: ToolInput,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const name = input.name as string;
    const args = input.arguments as Record<string, unknown> | undefined;
    const serverName = input.server as string | undefined;

    if (!name) {
      return {
        status: 'error',
        error: 'Prompt name is required',
      };
    }

    const client = this.getClient(serverName);
    if (!client) {
      return {
        status: 'error',
        error: serverName
          ? `MCP server not found: ${serverName}`
          : 'No MCP servers available',
      };
    }

    try {
      const result = await client.getPrompt(name, args);
      return {
        status: 'success',
        output: this.formatPromptContent(result),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getClient(serverName?: string): MCPClient | undefined {
    if (serverName) {
      return this.clients.get(serverName);
    }
    return this.clients.values().next().value;
  }

  private formatPromptContent(result: {
    description?: string;
    messages: Array<{ role: string; content: { text?: string; type: string } }>;
  }): string {
    const lines: string[] = [];

    if (result.description) {
      lines.push(`Description: ${result.description}`);
      lines.push('');
    }

    lines.push('Messages:');
    lines.push('');

    for (const message of result.messages) {
      lines.push(`[${message.role}]`);
      if (message.content.text) {
        lines.push(message.content.text);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
