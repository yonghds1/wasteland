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

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type {
  AuthSettings,
  RawWastelandSettings,
  ResolvedWastelandSettings,
} from './settings-types.js';
import { resolveModelContextWindow } from '@providers/profiles.js';
import type { SkinsFile } from '@skins/loader.js';
import type { RolesFile } from './roles/types.js';
import { ACP_PRESETS } from './acp-presets.js';
import {
  findProjectConfigDir,
  resolveProjectSettingsPath,
  resolveUserAuthPath,
  resolveUserConfigDir,
  resolveUserSettingsPath,
} from './paths.js';

/**
 * 单个 Provider 配置输入
 */
export type WizardProviderConfig = {
  name: string;
  type: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
};

/**
 * 角色绑定（Provider + Model）
 */
export type WizardRoleBinding = {
  providerName: string;
  modelId: string;
  contextWindow?: number;
};

/**
 * ACP 协同生态输入（stdio JSON-RPC 子进程 agent）
 *
 * 无 server/port/token 概念，agent 以子进程 command 启动，用完即回收。
 */
export type WizardACPSelection = {
  /** 启用的预设 ID 列表（如 ['claude_code', 'codex']） */
  enabledPresetIds?: string[];
  /** 自定义 ACP Agents（command/args 直配） */
  customAgents?: Array<{
    name: string;
    command: string;
    args?: string[];
    description?: string;
  }>;
};

/**
 * 用户在 InitWizard 中填写的原始输入
 */
export type InitWizardInput = {
  /** 运行模式：'multi' (默认多智能体) | 'single' (单智能体) */
  mode?: 'multi' | 'single';
  /** 配置的 Provider 列表（至少 1 个） */
  providers?: WizardProviderConfig[];
  /** 主 Agent 绑定 */
  mainAgent?: WizardRoleBinding;
  /** 子 Agent 调度策略：'inherit_main' | 'unified' | 'role_by_role' | 'single' */
  subAgentStrategy?: 'inherit_main' | 'unified' | 'role_by_role' | 'single' | 'reuse' | 'custom';
  /** 统一子 Agent 绑定（当 subAgentStrategy === 'unified' 时） */
  unifiedSubAgent?: WizardRoleBinding;
  /** 各角色专属绑定（当 subAgentStrategy === 'role_by_role' 时） */
  roleBindings?: {
    developer?: WizardRoleBinding;
    researcher?: WizardRoleBinding;
    tester?: WizardRoleBinding;
    analyst?: WizardRoleBinding;
  };
  /** ACP 智能体协同配置 */
  acp?: WizardACPSelection;
  /** 战甲皮肤 ID（默认 'warlord-immortal'） */
  skinId?: string;
  /** 界面语言：'zh' | 'en' */
  language?: string;

  // 兼容单 Provider 字段（供单测与简易调用）
  providerName?: string;
  providerType?: 'openai-compatible' | 'anthropic';
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  subAgentModelId?: string;
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
 * 由 ACP 选择构造 settings.acp 块（preset 展开为 command/args，合并自定义 agents）
 */
function buildAcpBlock(acpInput?: WizardACPSelection): RawWastelandSettings['acp'] {
  if (!acpInput) return undefined;

  const agents: NonNullable<RawWastelandSettings['acp']>['agents'] = [];

  if (acpInput.enabledPresetIds?.length) {
    for (const presetId of acpInput.enabledPresetIds) {
      const preset = ACP_PRESETS.find((p) => p.id === presetId);
      if (preset) agents.push(preset.toAgentConfig());
    }
  }

  if (acpInput.customAgents) {
    for (const agent of acpInput.customAgents) {
      agents.push({
        name: agent.name,
        command: agent.command,
        ...(agent.args ? { args: agent.args } : {}),
        ...(agent.description ? { description: agent.description } : {}),
      });
    }
  }

  if (agents.length === 0) return undefined;
  return { agents };
}

/**
 * 从输入构造 settings.json 内容
 */
export function buildInitialSettings(input: InitWizardInput): RawWastelandSettings {
  const skinId = input.skinId ?? 'warlord-immortal';
  const isSingle = input.mode === 'single' || input.subAgentStrategy === 'single';
  const acp = buildAcpBlock(input.acp);

  // 多 Provider 输入分支
  if (input.providers && input.providers.length > 0) {
    const providersMap: RawWastelandSettings['providers'] = {};
    for (const p of input.providers) {
      providersMap[p.name] = {
        type: p.type,
        baseUrl: p.baseUrl,
        apiKey: { $auth: deriveAuthKey(p.name) },
      };
    }

    const mainBinding = input.mainAgent ?? {
      providerName: input.providers[0].name,
      modelId: input.providers[0].defaultModel,
    };

    const createModelEntry = (binding: WizardRoleBinding) => {
      const cw = binding.contextWindow ?? resolveModelContextWindow(binding.modelId);
      return {
        provider: binding.providerName,
        model: binding.modelId,
        ...(cw && cw > 0 ? { contextWindow: cw } : {}),
      };
    };

    const modelsMap: Record<string, { provider: string; model: string; contextWindow?: number }> = {
      [INITIAL_MODEL_KEY]: createModelEntry(mainBinding),
    };

    let devModelKey = INITIAL_MODEL_KEY;
    let resModelKey = INITIAL_MODEL_KEY;
    let testModelKey = INITIAL_MODEL_KEY;
    let anaModelKey = INITIAL_MODEL_KEY;

    if (input.subAgentStrategy === 'unified' && input.unifiedSubAgent) {
      const workerKey = 'sub_worker';
      modelsMap[workerKey] = createModelEntry(input.unifiedSubAgent);
      devModelKey = workerKey;
      resModelKey = workerKey;
      testModelKey = workerKey;
      anaModelKey = workerKey;
    } else if (input.subAgentStrategy === 'role_by_role' && input.roleBindings) {
      if (input.roleBindings.developer) {
        devModelKey = 'dev_worker';
        modelsMap[devModelKey] = createModelEntry(input.roleBindings.developer);
      }
      if (input.roleBindings.researcher) {
        resModelKey = 'res_worker';
        modelsMap[resModelKey] = createModelEntry(input.roleBindings.researcher);
      }
      if (input.roleBindings.tester) {
        testModelKey = 'test_worker';
        modelsMap[testModelKey] = createModelEntry(input.roleBindings.tester);
      }
      if (input.roleBindings.analyst) {
        anaModelKey = 'ana_worker';
        modelsMap[anaModelKey] = createModelEntry(input.roleBindings.analyst);
      }
    }

    return {
      runtime: {
        defaultModel: INITIAL_MODEL_KEY,
        mode: isSingle ? 'single' : 'multi',
        skinId,
        language: input.language ?? 'zh',
      },
      providers: providersMap,
      models: modelsMap,
      singleAgent: {
        model: INITIAL_MODEL_KEY,
        promptTemplate: 'orchestrator',
      },
      multiAgent: {
        main: { role: 'orchestrator', model: INITIAL_MODEL_KEY, skin: skinId },
        developer: { role: 'developer', model: devModelKey },
        researcher: { role: 'researcher', model: resModelKey },
        analyst: { role: 'analyst', model: anaModelKey },
        tester: { role: 'tester', model: testModelKey },
      },
      acp,
    };
  }

  // 兼容单 Provider 回退分支
  const providerName = input.providerName ?? 'default';
  const authKey = deriveAuthKey(providerName);
  const hasCustomSubModel =
    (input.subAgentStrategy === 'custom' || input.subAgentStrategy === 'unified') &&
    !!input.subAgentModelId;
  const subModelKey = hasCustomSubModel ? 'sub_worker' : INITIAL_MODEL_KEY;

  const models: Record<string, { provider: string; model: string }> = {
    [INITIAL_MODEL_KEY]: {
      provider: providerName,
      model: input.modelId ?? 'default-model',
    },
  };

  if (hasCustomSubModel && input.subAgentModelId) {
    models[subModelKey] = {
      provider: providerName,
      model: input.subAgentModelId,
    };
  }

  return {
    runtime: {
      defaultModel: INITIAL_MODEL_KEY,
      mode: isSingle ? 'single' : 'multi',
      skinId,
      maxStepsPerTurn: 60,
      doomLoopThreshold: 3,
      language: input.language ?? 'zh',
    },
    providers: {
      [providerName]: {
        type: input.providerType ?? 'openai-compatible',
        baseUrl: input.baseUrl ?? 'https://api.openai.com/v1',
        apiKey: { $auth: authKey },
      },
    },
    models,
    singleAgent: {
      model: INITIAL_MODEL_KEY,
      promptTemplate: 'orchestrator',
    },
    multiAgent: {
      main: { role: 'orchestrator', model: INITIAL_MODEL_KEY, skin: skinId },
      researcher: { role: 'researcher', model: subModelKey },
      developer: { role: 'developer', model: subModelKey },
      analyst: { role: 'analyst', model: subModelKey },
      tester: { role: 'tester', model: subModelKey },
    },
    acp,
  };
}

/**
 * 从输入构造 skins.json 内容（精简骨架）
 *
 * 皮肤定义给示例（road-nomad），singleAgent 指向默认皮肤 road-nomad。
 * 完整皮肤仍由内置 default-skins.json 兜底；此处仅作为可编辑起点。
 */
export function buildInitialSkinsFile(): SkinsFile {
  return {
    skins: {
      'road-nomad': {
        id: 'road-nomad',
        label: '疯子麦克',
        thinking: ['荒原上只有一条法则：活着，然后把车开到终点...', '单兵引擎全速运转中...'],
        greeting: ['我一个人上路。把目标给我，别问多余的事。', '疯子麦克就位，一人一车。'],
        catchphrases: ['希望是个危险的东西。但我手里这台单兵 V8 引擎不是。', '在绝境里，最锋利的法则就是活下去并带回结果。'],
      },
    },
    singleAgent: {
      skin: 'road-nomad',
    },
  };
}

/**
 * 从输入构造 roles.json 内容（精简骨架）
 *
 * 角色定义与内置 DEFAULT_ROLES 对齐，作为文件落盘供编辑。
 * 完整角色仍由内置 default-roles.ts 兜底；此处仅作为可编辑起点。
 */
export function buildInitialRolesFile(): RolesFile {
  return {
    roles: {
      researcher: {
        promptTemplate: 'role-worker',
        description: '信息收集与研究 - 搜索、发现、检索信息和资源',
        skins: ['sand-scout', 'fury-vanguard'],
      },
      developer: {
        promptTemplate: 'role-worker',
        description: '代码开发与实现 - 编写、修改、调试代码',
        skins: ['v8-mechanic', 'fury-vanguard'],
      },
      analyst: {
        promptTemplate: 'role-worker',
        description: '系统分析与架构 - 理解现有系统和代码结构',
        skins: ['doof-analyst', 'fury-vanguard'],
      },
      tester: {
        promptTemplate: 'role-worker',
        description: '测试与验证 - 运行测试、验证功能、确保代码质量',
        skins: ['bullet-tester', 'fury-vanguard'],
      },
    },
  };
}

/**
 * 从输入构造 auth.json 内容
 */
export function buildInitialAuth(input: InitWizardInput): AuthSettings {
  const auth: AuthSettings = {};

  if (input.providers && input.providers.length > 0) {
    for (const p of input.providers) {
      if (p.apiKey && p.apiKey.trim().length > 0) {
        auth[deriveAuthKey(p.name)] = p.apiKey.trim();
      }
    }
  } else {
    const providerName = input.providerName ?? 'default';
    if (input.apiKey && input.apiKey.trim().length > 0) {
      auth[deriveAuthKey(providerName)] = input.apiKey.trim();
    }
  }

  return auth;
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
  skinsPath: string;
  rolesPath: string;
};

/**
 * 将 InitWizard 收集到的输入写入用户配置目录
 *
 * 只写用户级配置（`~/.wasteland/`），不动项目级配置。
 * 顺序：settings → auth → skins.json → roles.json。
 * 任一步失败会回滚已写入的文件，避免留下半成品配置。
 */
export async function writeInitialConfig(
  input: InitWizardInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<WriteInitialConfigResult> {
  const configDir = resolveUserConfigDir(env);
  const settingsPath = resolveUserSettingsPath(env);
  const authPath = resolveUserAuthPath(env);
  const skinsPath = join(configDir, 'skins.json');
  const rolesPath = join(configDir, 'roles.json');

  await mkdir(configDir, { recursive: true });

  const settings = buildInitialSettings(input);
  const auth = buildInitialAuth(input);
  const skins = buildInitialSkinsFile();
  const roles = buildInitialRolesFile();

  const written: string[] = [];
  try {
    await atomicWriteJson(settingsPath, settings);
    written.push(settingsPath);
    await atomicWriteJson(authPath, auth);
    written.push(authPath);
    await atomicWriteJson(skinsPath, skins);
    written.push(skinsPath);
    await atomicWriteJson(rolesPath, roles);
    written.push(rolesPath);
  } catch (error) {
    // 回滚已写入的文件，避免留下半成品配置
    for (const p of written.reverse()) {
      try {
        await unlink(p);
      } catch {
        /* best-effort */
      }
    }
    throw error;
  }

  return { settingsPath, authPath, skinsPath, rolesPath };
}

// ============================================================
// Partial Update（现有 settings 的部分字段持久化）
// ============================================================

/**
 * 读取 settings.json 的原始 JSON（已 parse）
 *
 * 用于 partial update 的"读改写循环"。返回 undefined 表示文件不存在。
 * 文件存在但 JSON 解析失败抛错（保留 load-settings 的解析错误语义）。
 */
async function readSettingsFileRaw(path: string): Promise<unknown | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * 选定"应被修改"的 settings.json 路径
 *
 * 策略：cwd 内存在 .wasteland/settings.json → 用项目级；否则用户级。
 * 用户级路径即使不存在，atomicWriteJson 也会创建。
 */
async function resolveMutableSettingsPath(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const cwd = resolve(params?.cwd ?? process.cwd());
  const env = params?.env ?? process.env;
  const projectDir = await findProjectConfigDir(cwd);
  if (projectDir) {
    return resolveProjectSettingsPath(projectDir);
  }
  return resolveUserSettingsPath(env);
}

/**
 * partial update settings.json（原子写）
 *
 * mutator 拿到当前 raw 对象（undefined 表示文件不存在），返回新 raw 对象。
 * 返回 undefined 表示"无修改"，跳过写入。
 */
export async function updateSettingsJson(
  mutator: (current: RawWastelandSettings | undefined) => RawWastelandSettings | undefined,
  params?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  const path = await resolveMutableSettingsPath(params);
  const current = await readSettingsFileRaw(path);
  const next = mutator(current as RawWastelandSettings | undefined);
  if (!next) return; // 无修改，跳过写
  await atomicWriteJson(path, next);
}

/**
 * 持久化 `runtime.skinId` 到当前生效的 settings.json
 *
 * 选择策略：cwd 内有项目级 .wasteland/settings.json → 写项目级；
 * 否则写用户级 ~/.wasteland/settings.json。
 *
 * 调用方应先通过 `validateSkinId` 校验 skinId（来自 `../../skins/index.js`）；
 * 本函数不做校验，只负责 IO。
 */
export async function updateRuntimeSkinId(
  skinId: string,
  params?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  await updateSettingsJson(
    (current) => {
      const base = current ?? {};
      return {
        ...base,
        runtime: {
          ...(base.runtime ?? {}),
          skinId,
        },
      };
    },
    params
  );
}

/**
 * 持久化 `runtime.mode` 到当前生效的 settings.json
 *
 * 选择策略与 `updateRuntimeSkinId` 一致：cwd 内有项目级 .wasteland/settings.json
 * → 写项目级；否则写用户级 ~/.wasteland/settings.json。
 *
 * 由 `/mode` 斜杠命令调用（写回配置，重启后生效）。本函数不做 mode 合法性校验，
 * 调用方应先收窄为 'single' | 'multi'（见 initialize-runtime 的 resolveAgentMode）。
 *
 * @param mode - 目标运行模式（single 单 agent / multi 多 agent）
 */
export async function updateRuntimeMode(
  mode: 'single' | 'multi',
  params?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  await updateSettingsJson(
    (current) => {
      const base = current ?? {};
      return {
        ...base,
        runtime: {
          ...(base.runtime ?? {}),
          mode,
        },
      };
    },
    params
  );
}

/**
 * 实时更新 runtime.permissionMode 并写回 settings.json
 *
 * @param permissionMode - 目标权限模式（default | accept_edits | bypass_permissions）
 */
export async function updateRuntimePermissionMode(
  permissionMode: 'default' | 'accept_edits' | 'bypass_permissions',
  params?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  await updateSettingsJson(
    (current) => {
      const base = current ?? {};
      return {
        ...base,
        runtime: {
          ...(base.runtime ?? {}),
          permissionMode,
        },
      };
    },
    params
  );
}
