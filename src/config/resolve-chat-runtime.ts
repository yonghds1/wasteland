import { resolve } from "path";

import type { PermissionMode } from "../runtime/permission-gate.js";
import type {
  ModelSettings,
  ProviderSettings,
  ResolvedWastelandSettings,
  RoleSettings,
} from "./settings-types.js";
import { assemblePrompt, isBuiltinRoleId, ROLE_WORKER, ROLE_IMMORTAN_JOE } from "../prompts/index.js";
import type { PromptTemplateRef } from "../prompts/prompt-types.js";
import { t, getLocalizedValue, getSupportedLanguages } from "../locales/index.js";

export type ResolvedRoleRef = {
  name: string;
  config: RoleSettings;
};

export type ResolvedModelRef = {
  name: string;
  config: ModelSettings;
};

export type ResolvedChatRuntime = {
  role?: ResolvedRoleRef;
  model?: ResolvedModelRef;
  providerName: string;
  providerConfig: ProviderSettings;
  permissionMode: PermissionMode;
  prompt?: string;
};

function omitModelMetadata(model: ModelSettings): ProviderSettings {
  const {
    provider: _provider,
    capabilities: _capabilities,
    ...providerConfig
  } = model;

  return providerConfig;
}

/**
 * 本地化 promptVariables
 *
 * 将配置中的语言后缀值（如 role.zh）转换为当前语言的值。
 *
 * @param promptVariables - 原始变量配置
 * @returns 本地化后的变量对象
 */
function localizePromptVariables(
  promptVariables: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const supportedLanguages = getSupportedLanguages();

  for (const [key, value] of Object.entries(promptVariables)) {
    // 跳过已经带有语言后缀的键（如 role.zh）
    if (key.includes(".")) {
      const parts = key.split(".");
      const lastPart = parts[parts.length - 1];
      if (supportedLanguages.includes(lastPart)) {
        continue;
      }
    }

    // 使用 getLocalizedValue 获取本地化值
    result[key] = getLocalizedValue(promptVariables, key);
  }

  return result;
}

/**
 * 解析角色提示词
 *
 * 统一使用 promptTemplate 配置：
 * - 字符串：内置角色 ID 或简单提示词
 * - 对象：完整的 PromptTemplate 定义
 * - { template, variables }：引用 + 变量覆盖
 *
 * @param role - 角色配置
 * @param cwd - 工作目录
 * @returns 提示词字符串
 */
function resolveRolePrompt(
  role: RoleSettings | undefined,
  cwd: string,
): string | undefined {
  if (!role) {
    return undefined;
  }

  // 没有配置 promptTemplate，使用默认的 role-worker
  if (!role.promptTemplate) {
    return assemblePrompt(
      ROLE_WORKER,
      { cwd, variables: {} },
      {},
    );
  }

  // 字符串类型：判断是内置角色 ID 还是简单提示词
  if (typeof role.promptTemplate === "string") {
    const ref = role.promptTemplate;
    const localizedVariables = role.promptVariables
      ? localizePromptVariables(role.promptVariables)
      : {};

    // 检查是否为内置角色 ID
    if (isBuiltinRoleId(ref)) {
      return assemblePrompt(
        ref,
        { cwd, variables: localizedVariables },
        localizedVariables,
      );
    }

    // 否则作为简单提示词处理：包装成模板
    return assemblePrompt(
      {
        name: "simple-prompt",
        sections: [{ id: "main", content: ref }],
      },
      { cwd, variables: {} },
      {},
    );
  }

  // 对象类型：直接使用
  if ("sections" in role.promptTemplate) {
    const localizedVariables = role.promptVariables
      ? localizePromptVariables(role.promptVariables)
      : {};
    return assemblePrompt(
      role.promptTemplate,
      { cwd, variables: localizedVariables },
      localizedVariables,
    );
  }

  // { template, variables } 类型
  if ("template" in role.promptTemplate) {
    const { template, variables } = role.promptTemplate;
    const localizedVariables = role.promptVariables
      ? localizePromptVariables(role.promptVariables)
      : {};

    // 判断 template 是内置 ID 还是简单字符串
    if (isBuiltinRoleId(template)) {
      return assemblePrompt(
        template,
        { cwd, variables: { ...variables, ...localizedVariables } },
        { ...variables, ...localizedVariables },
      );
    }

    // 简单字符串模板
    return assemblePrompt(
      {
        name: "simple-prompt",
        sections: [{ id: "main", content: template }],
      },
      { cwd, variables: variables ?? {} },
      { ...variables, ...localizedVariables },
    );
  }

  throw new Error(t("config.cannotParsePromptTemplate", { template: JSON.stringify(role.promptTemplate) }));
}

/**
 * 内置主角色配置
 * 完全内置，不可被用户覆盖
 */
const BUILTIN_MAIN_ROLE_CONFIG: RoleSettings = {
  promptTemplate: "role-immortan-joe",
};

function resolveRole(
  settings: ResolvedWastelandSettings,
  requestedRoleName: string | undefined,
): ResolvedRoleRef | undefined {
  if (!requestedRoleName) {
    return undefined;
  }

  // 内置主角色 immortan-joe，完全内置不可覆盖
  if (requestedRoleName === "immortan-joe") {
    return {
      name: "immortan-joe",
      config: BUILTIN_MAIN_ROLE_CONFIG,
    };
  }

  // 查找子角色配置（可被用户覆盖）
  const subAgent = settings.subAgents[requestedRoleName];

  if (subAgent) {
    return {
      name: requestedRoleName,
      config: subAgent,
    };
  }

  throw new Error(t("config.roleNotDefined", { roleName: requestedRoleName, availableRoles: Object.keys(settings.subAgents).join(", ") }));
}

function resolveModel(
  settings: ResolvedWastelandSettings,
  role: ResolvedRoleRef | undefined,
): ResolvedModelRef | undefined {
  if (!role) {
    return undefined;
  }

  // 优先使用角色配置的 model，然后 fallback 到 runtime.defaultModel
  const modelName = role.config.model ?? settings.runtime.defaultModel;
  const model = modelName ? settings.models[modelName] : undefined;

  if (!model) {
    throw new Error(t("config.modelNotDefined", { roleName: role.name, modelName: modelName ?? "(未设置)", availableModels: Object.keys(settings.models).join(", ") }));
  }

  return {
    name: modelName!,
    config: model,
  };
}

export function resolveChatRuntime(params: {
  settings: ResolvedWastelandSettings;
  roleName?: string;
  providerName?: string;
  cwd?: string;
}): ResolvedChatRuntime {
  const role = resolveRole(
    params.settings,
    params.roleName ?? params.settings.runtime.defaultRole,
  );
  const model = resolveModel(params.settings, role);
  const providerName = params.providerName
    ?? model?.config.provider
    ?? params.settings.defaultProvider;
  const providerSettings = params.settings.providers[providerName] ?? {};

  // 解析提示词模板
  const cwd = params.cwd ?? process.cwd();
  const prompt = resolveRolePrompt(role?.config, cwd);

  return {
    role,
    model,
    providerName,
    providerConfig: model
      ? {
          ...providerSettings,
          ...omitModelMetadata(model.config),
        }
      : {
          ...providerSettings,
        },
    permissionMode: role?.config.permissionMode ?? params.settings.runtime.permissionMode,
    prompt,
  };
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();

  return normalized.includes("apikey")
    || normalized.includes("api_key")
    || normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("password");
}

export function redactSensitiveConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveConfig(item));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = shouldRedactKey(key)
      ? "***"
      : redactSensitiveConfig(nestedValue);
  }

  return redacted;
}
