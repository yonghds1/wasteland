/**
 * validate-settings.ts - settings.json schema 校验簇
 *
 * 从 `load-settings.ts` 拆出：7 个 `validate*` 纯函数 + `isRecord` 守卫。
 * 无 IO，可独立单测；解析装配仍由 `load-settings.ts` 负责。
 */

import type { PermissionMode } from '@core/runtime/permission-gate.js';
import type {
  A2AAgentConfig,
  A2AAgentsConfig,
  A2AServerConfig,
  A2AServersConfig,
  A2ASettings,
  MCPServersConfig,
  MCPServerConfig,
  ModelSettings,
  ProviderSettings,
  RawWastelandSettings,
  SubAgentSettings,
} from './settings-types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validatePermissionMode(value: unknown, sourcePath: string): PermissionMode {
  if (value === 'default' || value === 'accept_edits' || value === 'bypass_permissions') {
    return value;
  }

  throw new Error(`配置文件 ${sourcePath} 中 runtime.permissionMode 无效。`);
}

export function validateProviderSettings(
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

export function validateModelSettings(value: unknown, sourcePath: string): Record<string, ModelSettings> {
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

export function validateRoleSettings(
  value: unknown,
  sourcePath: string
): Record<string, SubAgentSettings> {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 multiAgent 必须是对象。`);
  }

  const roles: Record<string, SubAgentSettings> = {};

  for (const [roleId, roleSettings] of Object.entries(value)) {
    if (!isRecord(roleSettings)) {
      throw new Error(`配置文件 ${sourcePath} 中 multiAgent.${roleId} 必须是对象。`);
    }

    // model 现为可选：A2A 已改为直接工具（a2a_<name>），子角色不再区分 llm/a2a 模式，
    // 旧的 mode/a2aServer 字段不再校验（如仍存在于旧配置中会被静默忽略）。
    const model = typeof roleSettings.model === 'string' ? roleSettings.model.trim() : undefined;

    if (
      'skin' in roleSettings &&
      roleSettings.skin !== undefined &&
      (typeof roleSettings.skin !== 'string' || roleSettings.skin.trim().length === 0)
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 multiAgent.${roleId}.skin 必须是非空字符串。`);
    }

    if ('permissionMode' in roleSettings && roleSettings.permissionMode !== undefined) {
      validatePermissionMode(
        roleSettings.permissionMode,
        `${sourcePath}:multiAgent.${roleId}.permissionMode`
      );
    }

    if (
      'prompt' in roleSettings &&
      roleSettings.prompt !== undefined &&
      (typeof roleSettings.prompt !== 'string' || roleSettings.prompt.trim().length === 0)
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 multiAgent.${roleId}.prompt 必须是非空字符串。`);
    }

    // 显式剔除已废弃的 mode / a2aServer 字段，避免旧配置残留进入解析结果
    const { mode: _legacyMode, a2aServer: _legacyA2AServer, ...restRoleSettings } = roleSettings;

    roles[roleId] = {
      ...restRoleSettings,
      model,
      skin: typeof roleSettings.skin === 'string' ? roleSettings.skin.trim() : undefined,
      permissionMode:
        typeof roleSettings.permissionMode === 'string'
          ? validatePermissionMode(
              roleSettings.permissionMode,
              `${sourcePath}:multiAgent.${roleId}.permissionMode`
            )
          : undefined,
      prompt: typeof roleSettings.prompt === 'string' ? roleSettings.prompt.trim() : undefined,
    };
  }

  return roles;
}

/**
 * 校验 singleAgent 配置
 *
 * singleAgent 必须是对象；model / skin / promptTemplate 若存在必须是非空字符串。
 * 此前 parse 分支直接 `as` 透传无任何校验，这里补基本字段校验。
 */
export function validateSingleAgentSettings(
  value: unknown,
  sourcePath: string
): RawWastelandSettings['singleAgent'] {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 singleAgent 必须是对象。`);
  }

  const readStringField = (field: 'model' | 'skin' | 'promptTemplate'): string | undefined => {
    const raw = value[field];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`配置文件 ${sourcePath} 中 singleAgent.${field} 必须是非空字符串。`);
    }
    return raw.trim();
  };

  const singleAgent: RawWastelandSettings['singleAgent'] = {};
  const model = readStringField('model');
  const skin = readStringField('skin');
  const promptTemplate = readStringField('promptTemplate');
  if (model !== undefined) singleAgent.model = model;
  if (skin !== undefined) singleAgent.skin = skin;
  if (promptTemplate !== undefined) singleAgent.promptTemplate = promptTemplate;

  return singleAgent;
}

/**
 * 校验 mcpServers 配置
 *
 * 每个 server 必须是对象，且 command 为非空字符串；其余字段做基本类型校验。
 */
export function validateMCPServers(value: unknown, sourcePath: string): MCPServersConfig {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 mcpServers 必须是对象。`);
  }

  const servers: MCPServersConfig = {};

  for (const [serverName, serverConfig] of Object.entries(value)) {
    if (!isRecord(serverConfig)) {
      throw new Error(`配置文件 ${sourcePath} 中 mcpServers.${serverName} 必须是对象。`);
    }

    if (typeof serverConfig.command !== 'string' || serverConfig.command.trim().length === 0) {
      throw new Error(
        `配置文件 ${sourcePath} 中 mcpServers.${serverName}.command 必须是非空字符串。`
      );
    }

    if (
      'args' in serverConfig &&
      serverConfig.args !== undefined &&
      (!Array.isArray(serverConfig.args) ||
        serverConfig.args.some((arg) => typeof arg !== 'string'))
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 mcpServers.${serverName}.args 必须是字符串数组。`);
    }

    if ('env' in serverConfig && serverConfig.env !== undefined) {
      if (!isRecord(serverConfig.env)) {
        throw new Error(`配置文件 ${sourcePath} 中 mcpServers.${serverName}.env 必须是对象。`);
      }
      for (const [envKey, envValue] of Object.entries(serverConfig.env)) {
        if (typeof envValue !== 'string' && !isRecord(envValue)) {
          throw new Error(
            `配置文件 ${sourcePath} 中 mcpServers.${serverName}.env.${envKey} 必须是字符串或 $auth 引用对象。`
          );
        }
      }
    }

    if (
      'cwd' in serverConfig &&
      serverConfig.cwd !== undefined &&
      (typeof serverConfig.cwd !== 'string' || serverConfig.cwd.trim().length === 0)
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 mcpServers.${serverName}.cwd 必须是非空字符串。`);
    }

    for (const timeoutKey of ['startupTimeout', 'requestTimeout'] as const) {
      const timeoutValue = serverConfig[timeoutKey];
      if (
        timeoutValue !== undefined &&
        (typeof timeoutValue !== 'number' || !Number.isInteger(timeoutValue) || timeoutValue <= 0)
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 mcpServers.${serverName}.${timeoutKey} 必须是正整数（毫秒）。`
        );
      }
    }

    servers[serverName] = {
      ...serverConfig,
      command: serverConfig.command.trim(),
    } as MCPServerConfig;
  }

  return servers;
}

/**
 * 校验 a2a 配置块
 *
 * - agents：数组，每项需有非空 name 与 url；description/token 可选。
 * - servers：对象，每项需有 boolean enabled、正整数 port、非空 command；description 可选。
 */
export function validateA2ASettings(value: unknown, sourcePath: string): A2ASettings {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 a2a 必须是对象。`);
  }

  // agents
  const agents: A2AAgentsConfig = [];
  if ('agents' in value && value.agents !== undefined) {
    if (!Array.isArray(value.agents)) {
      throw new Error(`配置文件 ${sourcePath} 中 a2a.agents 必须是数组。`);
    }

    for (let i = 0; i < value.agents.length; i += 1) {
      const agent = value.agents[i];
      if (!isRecord(agent)) {
        throw new Error(`配置文件 ${sourcePath} 中 a2a.agents[${i}] 必须是对象。`);
      }

      if (typeof agent.name !== 'string' || agent.name.trim().length === 0) {
        throw new Error(`配置文件 ${sourcePath} 中 a2a.agents[${i}].name 必须是非空字符串。`);
      }

      if (typeof agent.url !== 'string' || agent.url.trim().length === 0) {
        throw new Error(`配置文件 ${sourcePath} 中 a2a.agents[${i}].url 必须是非空字符串。`);
      }

      if (
        'description' in agent &&
        agent.description !== undefined &&
        typeof agent.description !== 'string'
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 a2a.agents[${i}].description 必须是字符串。`);
      }

      if (
        'token' in agent &&
        agent.token !== undefined &&
        typeof agent.token !== 'string' &&
        !isRecord(agent.token)
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 a2a.agents[${i}].token 必须是字符串或 $auth 引用对象。`
        );
      }

      const parsedAgent: A2AAgentConfig = {
        name: agent.name.trim(),
        url: agent.url.trim(),
      };
      if (typeof agent.description === 'string') {
        parsedAgent.description = agent.description;
      }
      if (typeof agent.token === 'string' || isRecord(agent.token)) {
        // token 可为明文字符串或 { $auth: KEY } 引用对象；引用对象在此暂存，
        // 由 resolveSettingsAuthRefs 统一解析为明文字符串（与 providers.apiKey 同机制）。
        parsedAgent.token = agent.token as A2AAgentConfig['token'];
      }
      agents.push(parsedAgent);
    }
  }

  // servers
  const servers: A2AServersConfig = {};
  if ('servers' in value && value.servers !== undefined) {
    if (!isRecord(value.servers)) {
      throw new Error(`配置文件 ${sourcePath} 中 a2a.servers 必须是对象。`);
    }

    for (const [serverName, serverConfig] of Object.entries(value.servers)) {
      if (!isRecord(serverConfig)) {
        throw new Error(`配置文件 ${sourcePath} 中 a2a.servers.${serverName} 必须是对象。`);
      }

      if (typeof serverConfig.enabled !== 'boolean') {
        throw new Error(
          `配置文件 ${sourcePath} 中 a2a.servers.${serverName}.enabled 必须是布尔值。`
        );
      }

      if (
        typeof serverConfig.port !== 'number' ||
        !Number.isInteger(serverConfig.port) ||
        serverConfig.port <= 0
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 a2a.servers.${serverName}.port 必须是正整数。`
        );
      }

      if (typeof serverConfig.command !== 'string' || serverConfig.command.trim().length === 0) {
        throw new Error(
          `配置文件 ${sourcePath} 中 a2a.servers.${serverName}.command 必须是非空字符串。`
        );
      }

      if (
        'description' in serverConfig &&
        serverConfig.description !== undefined &&
        typeof serverConfig.description !== 'string'
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 a2a.servers.${serverName}.description 必须是字符串。`
        );
      }

      const parsedServer: A2AServerConfig = {
        enabled: serverConfig.enabled,
        port: serverConfig.port,
        command: serverConfig.command.trim(),
      };
      if (typeof serverConfig.description === 'string') {
        parsedServer.description = serverConfig.description;
      }
      servers[serverName] = parsedServer;
    }
  }

  return { agents, servers };
}
