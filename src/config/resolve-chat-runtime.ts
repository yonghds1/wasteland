import type { PermissionMode } from "../runtime/permission-gate.js";
import type {
  ModelSettings,
  ProviderSettings,
  ResolvedRxcSettings,
  RoleSettings,
} from "./settings-types.js";

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
};

function omitModelMetadata(model: ModelSettings): ProviderSettings {
  const {
    provider: _provider,
    capabilities: _capabilities,
    ...providerConfig
  } = model;

  return providerConfig;
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
