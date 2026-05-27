import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PermissionMode } from "../runtime/permission-gate.js";
import {
  type AuthSettings,
  type AuthRef,
  DEFAULT_RXC_SETTINGS,
  type LoadedRxcSettings,
  type MCPServerConfig,
  type MCPServersConfig,
  type ModelSettings,
  type ProviderSettings,
  type RawRxcSettings,
  type ResolvedRxcSettings,
  type RoleSettings,
} from "./settings-types.js";
import {
  findProjectConfigDir,
  resolveProjectAuthPath,
  resolveProjectSettingsPath,
  resolveUserConfigDir,
  resolveUserAuthPath,
  resolveUserSettingsPath,
} from "./paths.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePermissionMode(value: unknown, sourcePath: string): PermissionMode {
  if (value === "default" || value === "accept_edits" || value === "bypass_permissions") {
    return value;
  }

  throw new Error(`配置文件 ${sourcePath} 中 runtime.permissionMode 无效。`);
}

function validateProviderSettings(
  value: unknown,
  sourcePath: string,
): Record<string, ProviderSettings> {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 providers 必须是对象。`);
  }

  const providers: Record<string, ProviderSettings> = {};

  for (const [providerId, providerSettings] of Object.entries(value)) {
    if (!isRecord(providerSettings)) {
      throw new Error(`配置文件 ${sourcePath} 中 providers.${providerId} 必须是对象。`);
    }

    providers[providerId] = { ...providerSettings };
  }

  return providers;
}

function validateModelSettings(
  value: unknown,
  sourcePath: string,
): Record<string, ModelSettings> {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 models 必须是对象。`);
  }

  const models: Record<string, ModelSettings> = {};

  for (const [modelId, modelSettings] of Object.entries(value)) {
    if (!isRecord(modelSettings)) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId} 必须是对象。`);
    }

    if (typeof modelSettings.provider !== "string" || modelSettings.provider.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId}.provider 必须是非空字符串。`);
    }

    if (typeof modelSettings.model !== "string" || modelSettings.model.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId}.model 必须是非空字符串。`);
    }

    if (
      "capabilities" in modelSettings
      && modelSettings.capabilities !== undefined
      && (
        !Array.isArray(modelSettings.capabilities)
        || modelSettings.capabilities.some((capability) => typeof capability !== "string")
      )
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId}.capabilities 必须是字符串数组。`);
    }

    models[modelId] = {
      ...modelSettings,
      provider: modelSettings.provider.trim(),
      model: modelSettings.model.trim(),
      capabilities: Array.isArray(modelSettings.capabilities)
        ? modelSettings.capabilities.map((capability) => capability.trim())
        : undefined,
    };
  }

  return models;
}

function validateRoleSettings(
  value: unknown,
  sourcePath: string,
): Record<string, RoleSettings> {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 roles 必须是对象。`);
  }

  const roles: Record<string, RoleSettings> = {};

  for (const [roleId, roleSettings] of Object.entries(value)) {
    if (!isRecord(roleSettings)) {
      throw new Error(`配置文件 ${sourcePath} 中 roles.${roleId} 必须是对象。`);
    }

    if (typeof roleSettings.model !== "string" || roleSettings.model.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 roles.${roleId}.model 必须是非空字符串。`);
    }

    if (
      "permissionMode" in roleSettings
      && roleSettings.permissionMode !== undefined
    ) {
      validatePermissionMode(roleSettings.permissionMode, `${sourcePath}:roles.${roleId}.permissionMode`);
    }

    if (
      "prompt" in roleSettings
      && roleSettings.prompt !== undefined
      && (typeof roleSettings.prompt !== "string" || roleSettings.prompt.trim().length === 0)
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 roles.${roleId}.prompt 必须是非空字符串。`);
    }

    roles[roleId] = {
      ...roleSettings,
      model: roleSettings.model.trim(),
      permissionMode: typeof roleSettings.permissionMode === "string"
        ? validatePermissionMode(roleSettings.permissionMode, `${sourcePath}:roles.${roleId}.permissionMode`)
        : undefined,
      prompt: typeof roleSettings.prompt === "string"
        ? roleSettings.prompt.trim()
        : undefined,
    };
  }

  return roles;
}

function parseSettings(raw: unknown, sourcePath: string): RawRxcSettings {
  if (!isRecord(raw)) {
    throw new Error(`配置文件 ${sourcePath} 的根节点必须是对象。`);
  }

  const settings: RawRxcSettings = {};

  if ("defaultProvider" in raw) {
    if (typeof raw.defaultProvider !== "string" || raw.defaultProvider.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 defaultProvider 必须是非空字符串。`);
    }

    settings.defaultProvider = raw.defaultProvider.trim();
  }

  if ("providers" in raw && raw.providers !== undefined) {
    settings.providers = validateProviderSettings(raw.providers, sourcePath);
  }

  if ("models" in raw && raw.models !== undefined) {
    settings.models = validateModelSettings(raw.models, sourcePath);
  }

  if ("roles" in raw && raw.roles !== undefined) {
    settings.roles = validateRoleSettings(raw.roles, sourcePath);
  }

  if ("runtime" in raw && raw.runtime !== undefined) {
    if (!isRecord(raw.runtime)) {
      throw new Error(`配置文件 ${sourcePath} 中 runtime 必须是对象。`);
    }

    const runtime: RawRxcSettings["runtime"] = {};

    if ("defaultRole" in raw.runtime && raw.runtime.defaultRole !== undefined) {
      if (typeof raw.runtime.defaultRole !== "string" || raw.runtime.defaultRole.trim().length === 0) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.defaultRole 必须是非空字符串。`);
      }

      runtime.defaultRole = raw.runtime.defaultRole.trim();
    }

    if ("permissionMode" in raw.runtime && raw.runtime.permissionMode !== undefined) {
      runtime.permissionMode = validatePermissionMode(raw.runtime.permissionMode, sourcePath);
    }

    if ("maxStepsPerTurn" in raw.runtime && raw.runtime.maxStepsPerTurn !== undefined) {
      if (
        typeof raw.runtime.maxStepsPerTurn !== "number"
        || !Number.isInteger(raw.runtime.maxStepsPerTurn)
        || raw.runtime.maxStepsPerTurn <= 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.maxStepsPerTurn 必须是正整数。`);
      }

      runtime.maxStepsPerTurn = raw.runtime.maxStepsPerTurn;
    }

    if ("maxTurns" in raw.runtime && raw.runtime.maxTurns !== undefined) {
      if (
        typeof raw.runtime.maxTurns !== "number"
        || !Number.isInteger(raw.runtime.maxTurns)
        || raw.runtime.maxTurns <= 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.maxTurns 必须是正整数。`);
      }

      runtime.maxTurns = raw.runtime.maxTurns;
    }

    if ("childAgentTimeout" in raw.runtime && raw.runtime.childAgentTimeout !== undefined) {
      if (
        typeof raw.runtime.childAgentTimeout !== "number"
        || !Number.isInteger(raw.runtime.childAgentTimeout)
        || raw.runtime.childAgentTimeout <= 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.childAgentTimeout 必须是正整数（毫秒）。`);
      }

      runtime.childAgentTimeout = raw.runtime.childAgentTimeout;
    }

    if ("debug" in raw.runtime && raw.runtime.debug !== undefined) {
      if (typeof raw.runtime.debug !== "boolean") {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.debug 必须是布尔值。`);
      }

      runtime.debug = raw.runtime.debug;
    }

    settings.runtime = runtime;
  }

  return settings;
}

async function readSettingsFile(filePath: string): Promise<RawRxcSettings | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return parseSettings(JSON.parse(content), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`配置文件 ${filePath} 不是合法的 JSON。`);
    }

    throw error;
  }
}

function parseAuth(raw: unknown, sourcePath: string): AuthSettings {
  if (!isRecord(raw)) {
    throw new Error(`认证文件 ${sourcePath} 的根节点必须是对象。`);
  }

  const auth: AuthSettings = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`认证文件 ${sourcePath} 中 ${key} 必须是非空字符串。`);
    }

    auth[key] = value.trim();
  }

  return auth;
}

async function readAuthFile(filePath: string): Promise<AuthSettings | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return parseAuth(JSON.parse(content), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`认证文件 ${filePath} 不是合法的 JSON。`);
    }

    throw error;
  }
}

function mergeSettings(
  base: ResolvedRxcSettings,
  next: RawRxcSettings | null,
): ResolvedRxcSettings {
  if (!next) {
    return base;
  }

  const mergedProviders = { ...base.providers };
  const mergedModels = { ...base.models };
  const mergedRoles = { ...base.roles };

  if (next.providers) {
    for (const [providerId, providerSettings] of Object.entries(next.providers)) {
      mergedProviders[providerId] = {
        ...(mergedProviders[providerId] ?? {}),
        ...providerSettings,
      };
    }
  }

  if (next.models) {
    for (const [modelId, modelSettings] of Object.entries(next.models)) {
      mergedModels[modelId] = {
        ...(mergedModels[modelId] ?? {}),
        ...modelSettings,
      };
    }
  }

  if (next.roles) {
    for (const [roleId, roleSettings] of Object.entries(next.roles)) {
      mergedRoles[roleId] = {
        ...(mergedRoles[roleId] ?? {}),
        ...roleSettings,
      };
    }
  }

  // 合并 mcpServers
  const mergedMCPServers: MCPServersConfig = { ...base.mcpServers };
  if (next.mcpServers) {
    for (const [serverName, serverConfig] of Object.entries(next.mcpServers)) {
      mergedMCPServers[serverName] = {
        ...(mergedMCPServers[serverName] ?? {}),
        ...serverConfig,
      } as MCPServerConfig;
    }
  }

  return {
    defaultProvider: next.defaultProvider ?? base.defaultProvider,
    providers: mergedProviders,
    models: mergedModels,
    roles: mergedRoles,
    runtime: {
      defaultRole: next.runtime?.defaultRole ?? base.runtime.defaultRole,
      permissionMode: next.runtime?.permissionMode ?? base.runtime.permissionMode,
      maxStepsPerTurn: next.runtime?.maxStepsPerTurn ?? base.runtime.maxStepsPerTurn,
      maxTurns: next.runtime?.maxTurns ?? base.runtime.maxTurns,
      childAgentTimeout: next.runtime?.childAgentTimeout ?? base.runtime.childAgentTimeout,
      debug: next.runtime?.debug ?? base.runtime.debug,
    },
    mcpServers: mergedMCPServers,
  };
}

function parseBooleanOverride(value: string, envKey: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new Error(`环境变量 ${envKey} 不是合法布尔值。`);
}

function readNonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (typeof env[key] !== "string") {
    return undefined;
  }

  const trimmed = env[key]!.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function isAuthRef(value: unknown): value is AuthRef {
  return isRecord(value) && typeof value.$auth === "string" && value.$auth.trim().length > 0;
}

function resolveAuthValue(params: {
  key: string;
  auth: AuthSettings;
  env: NodeJS.ProcessEnv;
}): string {
  const fromEnv = readNonEmptyEnv(params.env, params.key);

  if (fromEnv) {
    return fromEnv;
  }

  const fromAuth = params.auth[params.key];

  if (typeof fromAuth === "string" && fromAuth.trim().length > 0) {
    return fromAuth.trim();
  }

  throw new Error(`未找到 auth key: ${params.key}`);
}

function resolveAuthRefsInValue(params: {
  value: unknown;
  auth: AuthSettings;
  env: NodeJS.ProcessEnv;
}): unknown {
  if (Array.isArray(params.value)) {
    return params.value.map((item) => resolveAuthRefsInValue({
      value: item,
      auth: params.auth,
      env: params.env,
    }));
  }

  if (isAuthRef(params.value)) {
    return resolveAuthValue({
      key: params.value.$auth.trim(),
      auth: params.auth,
      env: params.env,
    });
  }

  if (!isRecord(params.value)) {
    return params.value;
  }

  const resolvedEntries = Object.entries(params.value).map(([key, value]) => [
    key,
    resolveAuthRefsInValue({
      value,
      auth: params.auth,
      env: params.env,
    }),
  ]);

  return Object.fromEntries(resolvedEntries);
}

function resolveSettingsAuthRefs(
  settings: ResolvedRxcSettings,
  auth: AuthSettings,
  env: NodeJS.ProcessEnv,
): ResolvedRxcSettings {
  // 解析 mcpServers 中的 auth refs
  const resolvedMCPServers: Record<string, MCPServerConfig> = {};
  for (const [name, config] of Object.entries(settings.mcpServers)) {
    resolvedMCPServers[name] = {
      ...config,
      env: resolveAuthRefsInValue({
        value: config.env ?? {},
        auth,
        env,
      }) as Record<string, string> | undefined,
    };
  }

  return {
    defaultProvider: settings.defaultProvider,
    providers: resolveAuthRefsInValue({
      value: settings.providers,
      auth,
      env,
    }) as Record<string, ProviderSettings>,
    models: resolveAuthRefsInValue({
      value: settings.models,
      auth,
      env,
    }) as Record<string, ModelSettings>,
    roles: resolveAuthRefsInValue({
      value: settings.roles,
      auth,
      env,
    }) as Record<string, RoleSettings>,
    runtime: {
      ...settings.runtime,
    },
    mcpServers: resolvedMCPServers,
  };
}

function applyEnvironmentOverrides(
  settings: ResolvedRxcSettings,
  env: NodeJS.ProcessEnv,
): ResolvedRxcSettings {
  const resolved = {
    defaultProvider: settings.defaultProvider,
    providers: { ...settings.providers },
    models: { ...settings.models },
    roles: { ...settings.roles },
    runtime: {
      defaultRole: settings.runtime.defaultRole,
      permissionMode: settings.runtime.permissionMode,
      maxStepsPerTurn: settings.runtime.maxStepsPerTurn,
      maxTurns: settings.runtime.maxTurns,
      childAgentTimeout: settings.runtime.childAgentTimeout,
      debug: settings.runtime.debug,
    },
    mcpServers: { ...settings.mcpServers },
  } satisfies ResolvedRxcSettings;

  if (typeof env.RXC_PROVIDER === "string" && env.RXC_PROVIDER.trim().length > 0) {
    resolved.defaultProvider = env.RXC_PROVIDER.trim();
  }

  if (typeof env.RXC_PERMISSION_MODE === "string" && env.RXC_PERMISSION_MODE.trim().length > 0) {
    resolved.runtime.permissionMode = validatePermissionMode(env.RXC_PERMISSION_MODE, "env:RXC_PERMISSION_MODE");
  }

  if (typeof env.RXC_MAX_STEPS_PER_TURN === "string" && env.RXC_MAX_STEPS_PER_TURN.trim().length > 0) {
    const parsed = Number.parseInt(env.RXC_MAX_STEPS_PER_TURN, 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("环境变量 RXC_MAX_STEPS_PER_TURN 必须是正整数。");
    }

    resolved.runtime.maxStepsPerTurn = parsed;
  }

  if (typeof env.RXC_DEBUG === "string" && env.RXC_DEBUG.trim().length > 0) {
    resolved.runtime.debug = parseBooleanOverride(env.RXC_DEBUG, "RXC_DEBUG");
  }

  return resolved;
}

export async function loadRxcSettings(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LoadedRxcSettings> {
  const cwd = resolve(params?.cwd ?? process.cwd());
  const processEnv = params?.env ?? process.env;
  const userConfigDir = resolveUserConfigDir(processEnv);
  const userSettingsPath = resolveUserSettingsPath(processEnv);
  const userAuthPath = resolveUserAuthPath(processEnv);
  const projectConfigDir = await findProjectConfigDir(cwd);
  const projectSettingsPath = projectConfigDir ? resolveProjectSettingsPath(projectConfigDir) : null;
  const projectAuthPath = projectConfigDir ? resolveProjectAuthPath(projectConfigDir) : null;

  const userSettings = await readSettingsFile(userSettingsPath);
  const userAuth = await readAuthFile(userAuthPath);
  const projectSettings = projectSettingsPath
    ? await readSettingsFile(projectSettingsPath)
    : null;
  const projectAuth = projectAuthPath
    ? await readAuthFile(projectAuthPath)
    : null;

  const mergedAuth = {
    ...(userAuth ?? {}),
    ...(projectAuth ?? {}),
  } satisfies AuthSettings;

  const merged = applyEnvironmentOverrides(
    resolveSettingsAuthRefs(
      mergeSettings(
        mergeSettings(DEFAULT_RXC_SETTINGS, userSettings),
        projectSettings,
      ),
      mergedAuth,
      processEnv,
    ),
    processEnv,
  );

  return {
    settings: merged,
    sources: {
      user: userSettings ? userSettingsPath : undefined,
      project: projectSettings ? projectSettingsPath ?? undefined : undefined,
      userAuth: userAuth ? userAuthPath : undefined,
      projectAuth: projectAuth ? projectAuthPath ?? undefined : undefined,
    },
    projectConfigDir,
    userConfigDir,
  };
}
