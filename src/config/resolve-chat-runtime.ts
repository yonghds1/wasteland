import { resolve } from "path";

import type { PermissionMode } from "../runtime/permission-gate.js";
import type {
  ModelSettings,
  ProviderSettings,
  ResolvedRxcSettings,
  RoleSettings,
} from "./settings-types.js";
import { assemblePrompt, isBuiltinRoleId, ROLE_WORKER } from "../prompts/index.js";
import type { PromptTemplateRef } from "../prompts/prompt-types.js";

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

    // 检查是否为内置角色 ID
    if (isBuiltinRoleId(ref)) {
      return assemblePrompt(
        ref,
        { cwd, variables: role.promptVariables ?? {} },
        role.promptVariables,
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
    return assemblePrompt(
      role.promptTemplate,
      { cwd, variables: role.promptVariables ?? {} },
      role.promptVariables,
    );
  }

  // { template, variables } 类型
  if ("template" in role.promptTemplate) {
    const { template, variables } = role.promptTemplate;

    // 判断 template 是内置 ID 还是简单字符串
    if (isBuiltinRoleId(template)) {
      return assemblePrompt(
        template,
        { cwd, variables: { ...variables, ...role.promptVariables } },
        { ...variables, ...role.promptVariables },
      );
    }

    // 简单字符串模板
    return assemblePrompt(
      {
        name: "simple-prompt",
        sections: [{ id: "main", content: template }],
      },
      { cwd, variables: variables ?? {} },
      { ...variables, ...role.promptVariables },
    );
  }

  throw new Error(`无法解析 promptTemplate: ${JSON.stringify(role.promptTemplate)}`);
}

function resolveRole(
  settings: ResolvedRxcSettings,
  requestedRoleName: string | undefined,
): ResolvedRoleRef | undefined {
  if (!requestedRoleName) {
    return undefined;
  }

  const role = settings.roles[requestedRoleName];

  if (!role) {
    throw new Error(`当前未定义 role: ${requestedRoleName}`);
  }

  return {
    name: requestedRoleName,
    config: role,
  };
}

function resolveModel(
  settings: ResolvedRxcSettings,
  role: ResolvedRoleRef | undefined,
): ResolvedModelRef | undefined {
  if (!role) {
    return undefined;
  }

  const modelName = role.config.model;
  const model = settings.models[modelName];

  if (!model) {
    throw new Error(`role ${role.name} 引用了未定义的 model: ${modelName}`);
  }

  return {
    name: modelName,
    config: model,
  };
}

export function resolveChatRuntime(params: {
  settings: ResolvedRxcSettings;
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
