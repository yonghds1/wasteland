import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PermissionMode } from '../core/runtime/permission-gate.js';
import {
  type AuthSettings,
  type AuthRef,
  DEFAULT_WASTELAND_SETTINGS,
  type LoadedWastelandSettings,
  type MCPServerConfig,
  type MCPServersConfig,
  type A2AAgentsConfig,
  type A2AAgentConfig,
  type ModelSettings,
  type ProviderSettings,
  type RawWastelandSettings,
  type ResolvedWastelandSettings,
  type RoleSettings,
} from './settings-types.js';
import {
  findProjectConfigDir,
  resolveProjectAuthPath,
  resolveProjectSettingsPath,
  resolveUserConfigDir,
  resolveUserAuthPath,
  resolveUserSettingsPath,
} from './paths.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const localesDir = join(__dirname, '..', 'locales');

/**
 * 扫描翻译文件目录，获取支持的语言列表
 */
async function getSupportedLanguages(): Promise<string[]> {
  try {
    const files = await readdir(localesDir);
    return files
      .filter((file) => file.endsWith('.json') && file !== 'package.json')
      .map((file) => file.replace('.json', ''));
  } catch {
    return ['en'];
  }
}

function validatePermissionMode(value: unknown, sourcePath: string): PermissionMode {
  if (value === 'default' || value === 'accept_edits' || value === 'bypass_permissions') {
    return value;
  }

  throw new Error(`配置文件 ${sourcePath} 中 runtime.permissionMode 无效。`);
}

function validateProviderSettings(
  value: unknown,
  sourcePath: string
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

function validateModelSettings(value: unknown, sourcePath: string): Record<string, ModelSettings> {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 models 必须是对象。`);
  }

  const models: Record<string, ModelSettings> = {};

  for (const [modelId, modelSettings] of Object.entries(value)) {
    if (!isRecord(modelSettings)) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId} 必须是对象。`);
    }

    if (typeof modelSettings.provider !== 'string' || modelSettings.provider.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId}.provider 必须是非空字符串。`);
    }

    if (typeof modelSettings.model !== 'string' || modelSettings.model.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 models.${modelId}.model 必须是非空字符串。`);
    }

    if (
      'capabilities' in modelSettings &&
      modelSettings.capabilities !== undefined &&
      (!Array.isArray(modelSettings.capabilities) ||
        modelSettings.capabilities.some((capability) => typeof capability !== 'string'))
    ) {
      throw new Error(
        `配置文件 ${sourcePath} 中 models.${modelId}.capabilities 必须是字符串数组。`
      );
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

function validateRoleSettings(value: unknown, sourcePath: string): Record<string, RoleSettings> {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 subAgents 必须是对象。`);
  }

  const roles: Record<string, RoleSettings> = {};

  for (const [roleId, roleSettings] of Object.entries(value)) {
    if (!isRecord(roleSettings)) {
      throw new Error(`配置文件 ${sourcePath} 中 subAgents.${roleId} 必须是对象。`);
    }

    if (typeof roleSettings.model !== 'string' || roleSettings.model.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 subAgents.${roleId}.model 必须是非空字符串。`);
    }

    if ('permissionMode' in roleSettings && roleSettings.permissionMode !== undefined) {
      validatePermissionMode(
        roleSettings.permissionMode,
        `${sourcePath}:subAgents.${roleId}.permissionMode`
      );
    }

    if (
      'prompt' in roleSettings &&
      roleSettings.prompt !== undefined &&
      (typeof roleSettings.prompt !== 'string' || roleSettings.prompt.trim().length === 0)
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 subAgents.${roleId}.prompt 必须是非空字符串。`);
    }

    roles[roleId] = {
      ...roleSettings,
      model: roleSettings.model.trim(),
      permissionMode:
        typeof roleSettings.permissionMode === 'string'
          ? validatePermissionMode(
              roleSettings.permissionMode,
              `${sourcePath}:subAgents.${roleId}.permissionMode`
            )
          : undefined,
      prompt: typeof roleSettings.prompt === 'string' ? roleSettings.prompt.trim() : undefined,
    };
  }

  return roles;
}

async function parseSettings(raw: unknown, sourcePath: string): Promise<RawWastelandSettings> {
  if (!isRecord(raw)) {
    throw new Error(`配置文件 ${sourcePath} 的根节点必须是对象。`);
  }

  const settings: RawWastelandSettings = {};

  if ('defaultProvider' in raw) {
    if (typeof raw.defaultProvider !== 'string' || raw.defaultProvider.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 defaultProvider 必须是非空字符串。`);
    }

    settings.defaultProvider = raw.defaultProvider.trim();
  }

  if ('providers' in raw && raw.providers !== undefined) {
    settings.providers = validateProviderSettings(raw.providers, sourcePath);
  }

  if ('models' in raw && raw.models !== undefined) {
    settings.models = validateModelSettings(raw.models, sourcePath);
  }

  if ('subAgents' in raw && raw.subAgents !== undefined) {
    settings.subAgents = validateRoleSettings(raw.subAgents, sourcePath);
  }

  if ('runtime' in raw && raw.runtime !== undefined) {
    if (!isRecord(raw.runtime)) {
      throw new Error(`配置文件 ${sourcePath} 中 runtime 必须是对象。`);
    }

    const runtime: RawWastelandSettings['runtime'] = {};

    if ('defaultRole' in raw.runtime && raw.runtime.defaultRole !== undefined) {
      if (
        typeof raw.runtime.defaultRole !== 'string' ||
        raw.runtime.defaultRole.trim().length === 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.defaultRole 必须是非空字符串。`);
      }

      runtime.defaultRole = raw.runtime.defaultRole.trim();
    }

    if ('defaultModel' in raw.runtime && raw.runtime.defaultModel !== undefined) {
      if (
        typeof raw.runtime.defaultModel !== 'string' ||
        raw.runtime.defaultModel.trim().length === 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.defaultModel 必须是非空字符串。`);
      }

      runtime.defaultModel = raw.runtime.defaultModel.trim();
    }

    if ('permissionMode' in raw.runtime && raw.runtime.permissionMode !== undefined) {
      runtime.permissionMode = validatePermissionMode(raw.runtime.permissionMode, sourcePath);
    }

    if ('maxStepsPerTurn' in raw.runtime && raw.runtime.maxStepsPerTurn !== undefined) {
      if (
        typeof raw.runtime.maxStepsPerTurn !== 'number' ||
        !Number.isInteger(raw.runtime.maxStepsPerTurn) ||
        raw.runtime.maxStepsPerTurn <= 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.maxStepsPerTurn 必须是正整数。`);
      }

      runtime.maxStepsPerTurn = raw.runtime.maxStepsPerTurn;
    }

    if ('maxTurns' in raw.runtime && raw.runtime.maxTurns !== undefined) {
      if (
        typeof raw.runtime.maxTurns !== 'number' ||
        !Number.isInteger(raw.runtime.maxTurns) ||
        raw.runtime.maxTurns <= 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.maxTurns 必须是正整数。`);
      }

      runtime.maxTurns = raw.runtime.maxTurns;
    }

    if ('childAgentTimeout' in raw.runtime && raw.runtime.childAgentTimeout !== undefined) {
      if (
        typeof raw.runtime.childAgentTimeout !== 'number' ||
        !Number.isInteger(raw.runtime.childAgentTimeout) ||
        raw.runtime.childAgentTimeout <= 0
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.childAgentTimeout 必须是正整数（毫秒）。`
        );
      }

      runtime.childAgentTimeout = raw.runtime.childAgentTimeout;
    }

    if ('debug' in raw.runtime && raw.runtime.debug !== undefined) {
      if (typeof raw.runtime.debug !== 'boolean') {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.debug 必须是布尔值。`);
      }

      runtime.debug = raw.runtime.debug;
    }

    if ('language' in raw.runtime && raw.runtime.language !== undefined) {
      if (typeof raw.runtime.language !== 'string' || raw.runtime.language.trim().length === 0) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.language 必须是非空字符串。`);
      }

      const supportedLanguages = await getSupportedLanguages();
      if (!supportedLanguages.includes(raw.runtime.language)) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.language 必须是以下之一: ${supportedLanguages.join(', ')}`
        );
      }

      runtime.language = raw.runtime.language;
    }

    settings.runtime = runtime;
  }

  if ('parallel' in raw && raw.parallel !== undefined) {
    if (!isRecord(raw.parallel)) {
      throw new Error(`配置文件 ${sourcePath} 中 parallel 必须是对象。`);
    }

    const parallel: NonNullable<RawWastelandSettings['parallel']> = {};

    if ('maxConcurrency' in raw.parallel && raw.parallel.maxConcurrency !== undefined) {
      if (typeof raw.parallel.maxConcurrency !== 'number' || !Number.isInteger(raw.parallel.maxConcurrency)) {
        throw new Error(`配置文件 ${sourcePath} 中 parallel.maxConcurrency 必须是整数。`);
      }

      parallel.maxConcurrency = raw.parallel.maxConcurrency;
    }

    settings.parallel = parallel;
  }

  return settings;
}

async function readSettingsFile(filePath: string): Promise<RawWastelandSettings | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    return await parseSettings(JSON.parse(content), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`配置文件 ${filePath} 不是合法的 JSON。`, { cause: error });
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
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`认证文件 ${sourcePath} 中 ${key} 必须是非空字符串。`);
    }

    auth[key] = value.trim();
  }

  return auth;
}

async function readAuthFile(filePath: string): Promise<AuthSettings | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    return parseAuth(JSON.parse(content), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`认证文件 ${filePath} 不是合法的 JSON。`, { cause: error });
    }

    throw error;
  }
}

function mergeSettings(
  base: ResolvedWastelandSettings,
  next: RawWastelandSettings | null
): ResolvedWastelandSettings {
  if (!next) {
    return base;
  }

  const mergedProviders = { ...base.providers };
  const mergedModels = { ...base.models };
  const mergedSubAgents = { ...base.subAgents };

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

  if (next.subAgents) {
    for (const [agentId, agentSettings] of Object.entries(next.subAgents)) {
      mergedSubAgents[agentId] = {
        ...(mergedSubAgents[agentId] ?? {}),
        ...agentSettings,
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

  // 合并 a2aAgents（按 name 去重，后者覆盖前者）
  const mergedA2AAgents: A2AAgentsConfig = [...(base.a2aAgents ?? [])];
  if (next.a2aAgents) {
    for (const agent of next.a2aAgents) {
      const existingIndex = mergedA2AAgents.findIndex(a => a.name === agent.name);
      if (existingIndex >= 0) {
        mergedA2AAgents[existingIndex] = agent;
      } else {
        mergedA2AAgents.push(agent);
      }
    }
  }

  return {
    defaultProvider: next.defaultProvider ?? base.defaultProvider,
    providers: mergedProviders,
    models: mergedModels,
    subAgents: mergedSubAgents,
    runtime: {
      defaultRole: next.runtime?.defaultRole ?? base.runtime.defaultRole,
      defaultModel: next.runtime?.defaultModel ?? base.runtime.defaultModel,
      permissionMode: next.runtime?.permissionMode ?? base.runtime.permissionMode,
      maxStepsPerTurn: next.runtime?.maxStepsPerTurn ?? base.runtime.maxStepsPerTurn,
      maxTurns: next.runtime?.maxTurns ?? base.runtime.maxTurns,
      childAgentTimeout: next.runtime?.childAgentTimeout ?? base.runtime.childAgentTimeout,
      debug: next.runtime?.debug ?? base.runtime.debug,
      language: next.runtime?.language ?? base.runtime.language,
    },
    mcpServers: mergedMCPServers,
    a2aAgents: mergedA2AAgents,
    parallel: {
      maxConcurrency: next.parallel?.maxConcurrency ?? base.parallel.maxConcurrency,
    },
  };
}

function parseBooleanOverride(value: string, envKey: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  throw new Error(`环境变量 ${envKey} 不是合法布尔值。`);
}

function readNonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function isAuthRef(value: unknown): value is AuthRef {
  return isRecord(value) && typeof value.$auth === 'string' && value.$auth.trim().length > 0;
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

  if (typeof fromAuth === 'string' && fromAuth.trim().length > 0) {
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
    return params.value.map((item) =>
      resolveAuthRefsInValue({
        value: item,
        auth: params.auth,
        env: params.env,
      })
    );
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
  settings: ResolvedWastelandSettings,
  auth: AuthSettings,
  env: NodeJS.ProcessEnv
): ResolvedWastelandSettings {
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
    subAgents: resolveAuthRefsInValue({
      value: settings.subAgents,
      auth,
      env,
    }) as Record<string, RoleSettings>,
    runtime: {
      ...settings.runtime,
    },
    mcpServers: resolvedMCPServers,
    a2aAgents: resolveAuthRefsInValue({
      value: settings.a2aAgents,
      auth,
      env,
    }) as A2AAgentsConfig,
    parallel: {
      ...settings.parallel,
    },
  };
}

function applyEnvironmentOverrides(
  settings: ResolvedWastelandSettings,
  env: NodeJS.ProcessEnv
): ResolvedWastelandSettings {
  const resolved = {
    defaultProvider: settings.defaultProvider,
    providers: { ...settings.providers },
    models: { ...settings.models },
    subAgents: { ...settings.subAgents },
    runtime: {
      defaultRole: settings.runtime.defaultRole,
      defaultModel: settings.runtime.defaultModel,
      permissionMode: settings.runtime.permissionMode,
      maxStepsPerTurn: settings.runtime.maxStepsPerTurn,
      maxTurns: settings.runtime.maxTurns,
      childAgentTimeout: settings.runtime.childAgentTimeout,
      debug: settings.runtime.debug,
      language: settings.runtime.language,
    },
    mcpServers: { ...settings.mcpServers },
    a2aAgents: [...settings.a2aAgents],
    parallel: {
      maxConcurrency: settings.parallel.maxConcurrency,
    },
  } satisfies ResolvedWastelandSettings;

  const providerEnv = env.WASTELAND_PROVIDER ?? env.JOE_PROVIDER;
  if (typeof providerEnv === 'string' && providerEnv.trim().length > 0) {
    resolved.defaultProvider = providerEnv.trim();
  }

  const permModeEnv = env.WASTELAND_PERMISSION_MODE ?? env.JOE_PERMISSION_MODE;
  if (typeof permModeEnv === 'string' && permModeEnv.trim().length > 0) {
    resolved.runtime.permissionMode = validatePermissionMode(
      permModeEnv,
      'env:WASTELAND_PERMISSION_MODE'
    );
  }

  const maxStepsEnv = env.WASTELAND_MAX_STEPS_PER_TURN ?? env.JOE_MAX_STEPS_PER_TURN;
  if (typeof maxStepsEnv === 'string' && maxStepsEnv.trim().length > 0) {
    const parsed = Number.parseInt(maxStepsEnv, 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('环境变量 WASTELAND_MAX_STEPS_PER_TURN 必须是正整数。');
    }

    resolved.runtime.maxStepsPerTurn = parsed;
  }

  const debugEnv = env.WASTELAND_DEBUG ?? env.JOE_DEBUG;
  if (typeof debugEnv === 'string' && debugEnv.trim().length > 0) {
    resolved.runtime.debug = parseBooleanOverride(debugEnv, 'WASTELAND_DEBUG');
  }

  const langEnv = env.WASTELAND_LANGUAGE ?? env.JOE_LANGUAGE;
  if (typeof langEnv === 'string' && langEnv.trim().length > 0) {
    const lang = langEnv.trim();
    if (lang !== 'en' && lang !== 'zh') {
      throw new Error('环境变量 WASTELAND_LANGUAGE 必须是 "en" 或 "zh"。');
    }
    resolved.runtime.language = lang;
  }

  const maxConcurrencyEnv = env.WASTELAND_MAX_CONCURRENCY ?? env.JOE_MAX_CONCURRENCY;
  if (typeof maxConcurrencyEnv === 'string' && maxConcurrencyEnv.trim().length > 0) {
    const parsed = Number.parseInt(maxConcurrencyEnv, 10);

    if (!Number.isInteger(parsed)) {
      throw new Error('环境变量 WASTELAND_MAX_CONCURRENCY 必须是整数（-1 表示无限制）。');
    }

    resolved.parallel.maxConcurrency = parsed;
  }

  return resolved;
}

export async function loadWastelandSettings(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LoadedWastelandSettings> {
  const cwd = resolve(params?.cwd ?? process.cwd());
  const processEnv = params?.env ?? process.env;
  const userConfigDir = resolveUserConfigDir(processEnv);
  const userSettingsPath = resolveUserSettingsPath(processEnv);
  const userAuthPath = resolveUserAuthPath(processEnv);
  const projectConfigDir = await findProjectConfigDir(cwd);
  const projectSettingsPath = projectConfigDir
    ? resolveProjectSettingsPath(projectConfigDir)
    : null;
  const projectAuthPath = projectConfigDir ? resolveProjectAuthPath(projectConfigDir) : null;

  const userSettings = await readSettingsFile(userSettingsPath);
  const userAuth = await readAuthFile(userAuthPath);
  const projectSettings = projectSettingsPath ? await readSettingsFile(projectSettingsPath) : null;
  const projectAuth = projectAuthPath ? await readAuthFile(projectAuthPath) : null;

  const mergedAuth = {
    ...(userAuth ?? {}),
    ...(projectAuth ?? {}),
  } satisfies AuthSettings;

  const merged = applyEnvironmentOverrides(
    resolveSettingsAuthRefs(
      mergeSettings(mergeSettings(DEFAULT_WASTELAND_SETTINGS, userSettings), projectSettings),
      mergedAuth,
      processEnv
    ),
    processEnv
  );

  return {
    settings: merged,
    sources: {
      user: userSettings ? userSettingsPath : undefined,
      project: projectSettings ? (projectSettingsPath ?? undefined) : undefined,
      userAuth: userAuth ? userAuthPath : undefined,
      projectAuth: projectAuth ? (projectAuthPath ?? undefined) : undefined,
    },
    projectConfigDir,
    userConfigDir,
  };
}
