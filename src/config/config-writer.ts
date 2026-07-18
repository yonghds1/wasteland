/**
 * 首次初始化配置写入器
 *
 * 纯函数模块：
 *   - 构造 settings.json 与 auth.json 内容
 *   - 原子写入用户配置目录（tmp + rename）
 *   - 检测是否已有配置
 *
 * 由 InitWizard（TUI）和 `wasteland init` 命令共用。
 */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  AuthSettings,
  RawWastelandSettings,
  ResolvedWastelandSettings,
} from './settings-types.js';
import {
  resolveUserAuthPath,
  resolveUserConfigDir,
  resolveUserSettingsPath,
} from './paths.js';

/**
 * 用户在 InitWizard 中填写的原始输入
 */
export type InitWizardInput = {
  /** provider 配置 key（例如 "deepseek"、"anthropic"） */
  providerName: string;
  /** provider 协议类型 */
  providerType: 'openai-compatible' | 'anthropic';
  /** API baseUrl，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /** API Key（明文，会写入 auth.json） */
  apiKey: string;
  /** 模型 ID，例如 deepseek-chat */
  modelId: string;
};

/**
 * 首次初始化默认写入的 model 配置 key
 */
export const INITIAL_MODEL_KEY = 'default';

/**
 * 由用户输入派生的 auth key（可复用给 UI 展示）
 */
export function deriveAuthKey(providerName: string): string {
  return `${providerName}_api_key`;
}

/**
 * 从输入构造 settings.json 内容
 *
 * 只写最小可运行子集：providers / models / runtime.defaultModel。
 * 其他字段留给用户后续按需扩展。
 */
export function buildInitialSettings(input: InitWizardInput): RawWastelandSettings {
  const authKey = deriveAuthKey(input.providerName);

  return {
    runtime: {
      defaultModel: INITIAL_MODEL_KEY,
    },
    providers: {
      [input.providerName]: {
        type: input.providerType,
        baseUrl: input.baseUrl,
        apiKey: { $auth: authKey },
      },
    },
    models: {
      [INITIAL_MODEL_KEY]: {
        provider: input.providerName,
        model: input.modelId,
      },
    },
  };
}

/**
 * 从输入构造 auth.json 内容
 */
export function buildInitialAuth(input: InitWizardInput): AuthSettings {
  return {
    [deriveAuthKey(input.providerName)]: input.apiKey,
  };
}

/**
 * 判断当前 settings 是否需要初始化
 *
 * 规则：`providers` 与 `models` 都为空即视为空配置。
 * 只要用户已经配置了任意 provider 或 model，就不再触发引导。
 */
export function isConfigEmpty(settings: ResolvedWastelandSettings): boolean {
  return (
    Object.keys(settings.providers).length === 0 &&
    Object.keys(settings.models).length === 0
  );
}

/**
 * 原子写入单个 JSON 文件（tmp + rename）
 *
 * 出错时尝试清理 tmp，但不阻塞抛错。
 */
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    await rename(tmpPath, path);
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore cleanup failure */
    }
    throw error;
  }
}

/**
 * 写入结果，供 UI 展示
 */
export type WriteInitialConfigResult = {
  settingsPath: string;
  authPath: string;
};

/**
 * 将 InitWizard 收集到的输入写入用户配置目录
 *
 * 只写用户级配置（`~/.wasteland/`），不动项目级配置。
 * 分两次原子写：settings 先写；成功后再写 auth。若 auth 写失败会尝试回滚 settings。
 */
export async function writeInitialConfig(
  input: InitWizardInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<WriteInitialConfigResult> {
  const configDir = resolveUserConfigDir(env);
  const settingsPath = resolveUserSettingsPath(env);
  const authPath = resolveUserAuthPath(env);

  await mkdir(configDir, { recursive: true });

  const settings = buildInitialSettings(input);
  const auth = buildInitialAuth(input);

  await atomicWriteJson(settingsPath, settings);
  try {
    await atomicWriteJson(authPath, auth);
  } catch (error) {
    // auth 失败时把 settings 回滚，避免留下引用了不存在的 $auth 的半成品配置
    try {
      await unlink(settingsPath);
    } catch {
      /* best-effort */
    }
    throw error;
  }

  return { settingsPath, authPath };
}
