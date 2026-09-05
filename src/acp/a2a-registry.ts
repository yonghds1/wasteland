/**
 * a2a-registry.ts - A2A Agent Registry
 *
 * 管理已发现的 Agent，支持按能力、名称查找。
 *
 * ## 使用方式
 *
 * ```typescript
 * const registry = new A2AAgentRegistry();
 *
 * // 手动注册
 * registry.register(agentCard);
 *
 * // 自动发现并注册
 * await registry.discoverAndRegister('http://localhost:8080');
 *
 * // 按能力查找
 * const agents = registry.discoverByCapability(['code-review']);
 *
 * // 按名称查找
 * const agent = registry.findByName('my-agent');
 * ```
 */

import type { AgentCard } from './a2a-types.js';
import { A2AClient } from './a2a-client.js';

// ============================================================
// Registry Error
// ============================================================

/**
 * Registry 错误
 */
export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

// ============================================================
// A2AAgentRegistry
// ============================================================

/**
 * A2A Agent 注册表
 *
 * 管理所有已注册的 Agent，提供发现和查找能力。
 * 使用 Agent 名称作为唯一键。
 */
export class A2AAgentRegistry {
  /** 已注册的 Agent (以 name 为键) */
  private agents: Map<string, AgentCard> = new Map();

  // ----------------------------------------------------------
  // Registration
  // ----------------------------------------------------------

  /**
   * 注册 Agent
   *
   * 如果同名 Agent 已存在，会覆盖旧的注册信息。
   *
   * @param card - Agent Card
   */
  register(card: AgentCard): void {
    if (!card.name || card.name.trim() === '') {
      throw new RegistryError(
        'Agent card must have a non-empty name',
        'INVALID_CARD',
      );
    }
    if (!card.url || card.url.trim() === '') {
      throw new RegistryError(
        `Agent card "${card.name}" must have a non-empty url`,
        'INVALID_CARD',
      );
    }
    this.agents.set(card.name, card);
  }

  /**
   * 从 URL 发现并注册 Agent
   *
   * 向目标 URL 请求 /.well-known/agent.json，获取 Agent Card 后注册。
   *
   * @param url - Agent 基础 URL
   * @param token - 认证令牌 (可选)
   * @throws {RegistryError} 发现失败时抛出
   */
  async discoverAndRegister(url: string, token?: string): Promise<void> {
    const client = new A2AClient({ baseUrl: url, token });

    try {
      const card = await client.discoverAgent();
      this.register(card);
    } catch (error) {
      throw new RegistryError(
        `Failed to discover agent at ${url}: ${error instanceof Error ? error.message : String(error)}`,
        'DISCOVERY_FAILED',
        error,
      );
    }
  }

  // ----------------------------------------------------------
  // Lookup
  // ----------------------------------------------------------

  /**
   * 按能力查找 Agent
   *
   * 匹配 Agent 的技能标签 (tags)。只要有一个 tag 匹配即算命中。
   *
   * @param capabilities - 需要的能力标签列表
   * @returns 匹配的 Agent Card 列表 (按名称排序)
   */
  discoverByCapability(capabilities: string[]): AgentCard[] {
    const capabilitySet = new Set(capabilities.map((c) => c.toLowerCase()));

    const matched: AgentCard[] = [];

    for (const card of this.agents.values()) {
      for (const skill of card.skills) {
        const hasMatch = skill.tags.some((tag) =>
          capabilitySet.has(tag.toLowerCase()),
        );
        if (hasMatch) {
          matched.push(card);
          break; // One skill match is enough for this agent
        }
      }
    }

    // Sort by name for deterministic output
    return matched.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 按名称查找 Agent
   *
   * @param name - Agent 名称
   * @returns Agent Card，未找到返回 undefined
   */
  findByName(name: string): AgentCard | undefined {
    return this.agents.get(name);
  }

  /**
   * 列出所有已注册的 Agent
   *
   * @returns Agent Card 列表 (按名称排序)
   */
  listAll(): AgentCard[] {
    return Array.from(this.agents.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  // ----------------------------------------------------------
  // Management
  // ----------------------------------------------------------

  /**
   * 取消注册 Agent
   *
   * @param name - Agent 名称
   * @returns 是否成功移除
   */
  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  /**
   * 获取已注册 Agent 数量
   */
  get size(): number {
    return this.agents.size;
  }

  /**
   * 检查 Agent 是否已注册
   *
   * @param name - Agent 名称
   */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * 清空所有注册信息
   */
  clear(): void {
    this.agents.clear();
  }
}
