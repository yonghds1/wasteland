import { createLocalProvider } from "./local.js";
import { createOpenAIProvider } from "./openai.js";
import type { AgentProvider } from "./provider-types.js";
import type { ProviderSettings } from "../config/settings-types.js";
import { t } from "../locales/index.js";

export type ProviderFactory = (config?: ProviderSettings) => AgentProvider;

/**
 * Provider 注册表
 *
 * 按 API 协议/格式注册工厂函数，而非按服务商名称。
 * 支持的协议类型：
 * - local: 本地命令执行
 * - openai-compatible: OpenAI 兼容 API（包括 OpenAI、Ollama、Azure、各类国内大模型）
 * - anthropic: Anthropic Claude API
 */
export class ProviderRegistry {
  /** 按 API 协议类型注册的工厂函数 */
  private readonly factories = new Map<string, ProviderFactory>();

  /** 向后兼容：按服务商 ID 注册的工厂函数 */
  private readonly legacyFactories = new Map<string, ProviderFactory>();

  constructor(entries: Array<[string, ProviderFactory]> = []) {
    for (const [id, factory] of entries) {
      this.register(id, factory);
    }
  }

  /**
   * 注册 API 协议类型的工厂函数
   *
   * @param type - API 协议类型（如 "openai-compatible"、"anthropic"）
   * @param factory - 工厂函数
   */
  register(type: string, factory: ProviderFactory): void {
    const normalizedType = type.trim();

    if (normalizedType.length === 0) {
      throw new Error(t("providers.typeEmpty"));
    }

    if (this.factories.has(normalizedType)) {
      throw new Error(`${t("providers.typeRegistered")} ${normalizedType}`);
    }

    this.factories.set(normalizedType, factory);
  }

  /**
   * 向后兼容：注册服务商 ID 的工厂函数
   *
   * @deprecated 使用 register() 注册 API 协议类型
   */
  registerLegacy(id: string, factory: ProviderFactory): void {
    const normalizedId = id.trim();

    if (normalizedId.length === 0) {
      throw new Error(t("providers.idEmpty"));
    }

    if (this.legacyFactories.has(normalizedId)) {
      throw new Error(`${t("providers.alreadyRegistered")} ${normalizedId}`);
    }

    this.legacyFactories.set(normalizedId, factory);
  }

  /**
   * 解析 provider
   *
   * 优先级：
   * 1. 使用 config.type 指定的 API 协议类型
   * 2. 向后兼容：使用 legacyFactories 中的 ID
   * 3. 使用 factories 中的 ID（直接匹配）
   */
  resolve(id: string, config?: ProviderSettings): AgentProvider {
    // 优先使用 config.type 指定的 API 协议类型
    const type = config?.type;
    if (type) {
      const factory = this.factories.get(type);
      if (factory) {
        return factory(config);
      }
      throw new Error(`${t("providers.unsupportedProtocol")} ${type}`);
    }

    // 向后兼容：检查 legacyFactories
    const legacyFactory = this.legacyFactories.get(id);
    if (legacyFactory) {
      return legacyFactory(config);
    }

    // 直接匹配（用于 local、ollama 等内置 provider）
    const factory = this.factories.get(id);
    if (factory) {
      return factory(config);
    }

    throw new Error(`${t("providers.unsupportedProvider")} ${id}`);
  }

  /**
   * 列出所有已注册的 API 协议类型
   */
  listTypes(): string[] {
    return [...this.factories.keys()].sort();
  }

  /**
   * 列出所有已注册的服务商 ID（向后兼容）
   */
  list(): string[] {
    const allIds = new Set([...this.factories.keys(), ...this.legacyFactories.keys()]);
    return [...allIds].sort();
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  // 按 API 协议类型注册
  registry.register("local", createLocalProvider);
  registry.register("openai-compatible", createOpenAIProvider);  // 包括 OpenAI、Ollama、各类国内大模型
  registry.register("anthropic", createOpenAIProvider); // 暂时复用 OpenAI 格式

  // 向后兼容：按服务商 ID 注册
  registry.registerLegacy("local", createLocalProvider);
  registry.registerLegacy("ollama", createOpenAIProvider);  // Ollama 也使用 openai-compatible
  registry.registerLegacy("openai", createOpenAIProvider);

  return registry;
}
