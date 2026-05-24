import { createLocalProvider } from "./local.js";
import { createOllamaProvider } from "./ollama.js";
import { createQwenProvider } from "./qwen.js";
import type { AgentProvider } from "./provider-types.js";
import type { ProviderSettings } from "../config/settings-types.js";

export type ProviderFactory = (config?: ProviderSettings) => AgentProvider;

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  constructor(entries: Array<[string, ProviderFactory]> = []) {
    for (const [id, factory] of entries) {
      this.register(id, factory);
    }
  }

  register(id: string, factory: ProviderFactory): void {
    const normalizedId = id.trim();

    if (normalizedId.length === 0) {
      throw new Error("provider id 不能为空。");
    }

    if (this.factories.has(normalizedId)) {
      throw new Error(`provider 已注册: ${normalizedId}`);
    }

    this.factories.set(normalizedId, factory);
  }

  resolve(id: string, config?: ProviderSettings): AgentProvider {
    const factory = this.factories.get(id);

    if (!factory) {
      throw new Error(`当前不支持 provider: ${id}`);
    }

    return factory(config);
  }

  list(): string[] {
    return [...this.factories.keys()].sort();
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    ["local", createLocalProvider],
    ["ollama", createOllamaProvider],
    ["qwen", createQwenProvider],
  ]);
}
