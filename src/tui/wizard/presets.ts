/**
 * wizard/presets.ts - Provider 预设数据
 *
 * 从 `InitWizard.tsx` 拆出：8 家预设供应商 + Custom 的默认 Base URL。
 * 纯数据，无逻辑。
 */

import type { ProviderPreset } from './types.js';

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'deepseek',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.deepseek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
  },
  {
    id: 'openai',
    name: 'openai',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
  },
  {
    id: 'qwen',
    name: 'qwen',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.qwen',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requiresApiKey: true,
  },
  {
    id: 'glm',
    name: 'glm',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.glm',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    requiresApiKey: true,
  },
  {
    id: 'minimax',
    name: 'minimax',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.minimax',
    defaultBaseUrl: 'https://api.minimaxi.chat/v1',
    requiresApiKey: true,
  },
  {
    id: 'ollama',
    name: 'ollama',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
  },
  {
    id: 'opencode-zen',
    name: 'opencode-zen',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.opencodeZen',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    requiresApiKey: true,
  },
  {
    id: 'opencode-go',
    name: 'opencode-go',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.opencodeGo',
    defaultBaseUrl: 'https://opencode.ai/zen/go/v1',
    requiresApiKey: true,
  },
  {
    id: 'custom',
    name: 'custom',
    type: 'openai-compatible',
    labelKey: 'commands.init.wizard.provider.custom',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
  },
];
