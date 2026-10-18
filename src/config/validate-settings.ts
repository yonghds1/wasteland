
/**
 * validate-settings.ts - settings.json schema 校验簇
 *
 * 从 `load-settings.ts` 拆出：7 个 `validate*` 纯函数 + `isRecord` 守卫。
 * 无 IO，可独立单测；解析装配仍由 `load-settings.ts` 负责。
 */

import type { PermissionMode } from '@core/engine/permission-gate.js';
import type {
  ACPSettings,
  AcpAgentConfig,
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

    // model 为可选：远程 agent 统一为 acp_<name> 直接工具，子角色不再区分模式，
    // 旧的 mode/a2aServer 字段不再校验（如仍存在于旧配置中会被静默剔除）。
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
 * singleAgent 必须是对象；model / promptTemplate 若存在必须是非空字符串。
 * 皮肤不在此处声明：single 模式皮肤的真源是 `skins.json` 的 `singleAgent.skin`，
 * 此块不再接受 `skin` 字段（旧配置残留的 `skin` 会被静默忽略，不报错）。
 */
export function validateSingleAgentSettings(
  value: unknown,
  sourcePath: string
): RawWastelandSettings['singleAgent'] {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 singleAgent 必须是对象。`);
  }

  const readStringField = (field: 'model' | 'promptTemplate'): string | undefined => {
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
  const promptTemplate = readStringField('promptTemplate');
  if (model !== undefined) singleAgent.model = model;
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

    const hasCommand = typeof serverConfig.command === 'string' && serverConfig.command.trim().length > 0;
    const hasUrl = typeof serverConfig.url === 'string' && serverConfig.url.trim().length > 0;

    if (!hasCommand && !hasUrl) {
      throw new Error(
        `配置文件 ${sourcePath} 中 mcpServers.${serverName} 必须包含非空的 command (stdio) 或 url (sse)。`
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

    if ('headers' in serverConfig && serverConfig.headers !== undefined) {
      if (!isRecord(serverConfig.headers)) {
        throw new Error(`配置文件 ${sourcePath} 中 mcpServers.${serverName}.headers 必须是对象。`);
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
      command: typeof serverConfig.command === 'string' ? serverConfig.command.trim() : undefined,
      url: typeof serverConfig.url === 'string' ? serverConfig.url.trim() : undefined,
    } as MCPServerConfig;
  }

  return servers;
}

/**
 * 校验 acp 配置块（stdio JSON-RPC 子进程 agent）
 *
 * - agents：数组，每项需有合法 name（^[A-Za-z0-9_-]+$）与非空 command；
 *   args 为字符串数组，env 为字符串值对象，cwd/description 为字符串，timeoutMs 为正整数；
 *   name 全表唯一。
 * - defaults.timeoutMs：可选正整数。
 */
export function validateACPSettings(value: unknown, sourcePath: string): ACPSettings {
  if (!isRecord(value)) {
    throw new Error(`配置文件 ${sourcePath} 中 acp 必须是对象。`);
  }

  const NAME_RE = /^[A-Za-z0-9_-]+$/;
  const agents: AcpAgentConfig[] = [];
  const seenNames = new Set<string>();

  if ('agents' in value && value.agents !== undefined) {
    if (!Array.isArray(value.agents)) {
      throw new Error(`配置文件 ${sourcePath} 中 acp.agents 必须是数组。`);
    }

    for (let i = 0; i < value.agents.length; i += 1) {
      const agent = value.agents[i];
      const at = `${sourcePath} 中 acp.agents[${i}]`;
      if (!isRecord(agent)) {
        throw new Error(`${at} 必须是对象。`);
      }

      if (typeof agent.name !== 'string' || !NAME_RE.test(agent.name.trim())) {
        throw new Error(`${at}.name 必须是非空字符串，且仅含字母、数字、下划线或连字符。`);
      }
      const name = agent.name.trim();
      if (seenNames.has(name)) {
        throw new Error(`${at}.name "${name}" 与已配置的 acp agent 重名。`);
      }
      seenNames.add(name);

      if (typeof agent.command !== 'string' || agent.command.trim().length === 0) {
        throw new Error(`${at}.command 必须是非空字符串。`);
      }

      const parsed: AcpAgentConfig = { name, command: agent.command.trim() };

      if ('args' in agent && agent.args !== undefined) {
        if (!Array.isArray(agent.args) || agent.args.some((a) => typeof a !== 'string')) {
          throw new Error(`${at}.args 必须是字符串数组。`);
        }
        parsed.args = agent.args as string[];
      }

      if ('env' in agent && agent.env !== undefined) {
        if (!isRecord(agent.env)) {
          throw new Error(`${at}.env 必须是对象。`);
        }
        for (const [envKey, envValue] of Object.entries(agent.env)) {
          // 值可为明文字符串或 { $auth: KEY } 引用（由 resolveSettingsAuthRefs 解析），与 mcpServers.env 同语义
          if (typeof envValue !== 'string' && !isRecord(envValue)) {
            throw new Error(`${at}.env.${envKey} 必须是字符串或 $auth 引用对象。`);
          }
        }
        parsed.env = agent.env as Record<string, string>;
      }

      if ('cwd' in agent && agent.cwd !== undefined) {
        if (typeof agent.cwd !== 'string') {
          throw new Error(`${at}.cwd 必须是字符串。`);
        }
        parsed.cwd = agent.cwd;
      }

      if ('description' in agent && agent.description !== undefined) {
        if (typeof agent.description !== 'string') {
          throw new Error(`${at}.description 必须是字符串。`);
        }
        parsed.description = agent.description;
      }

      if ('timeoutMs' in agent && agent.timeoutMs !== undefined) {
        if (typeof agent.timeoutMs !== 'number' || !Number.isInteger(agent.timeoutMs) || agent.timeoutMs <= 0) {
          throw new Error(`${at}.timeoutMs 必须是正整数。`);
        }
        parsed.timeoutMs = agent.timeoutMs;
      }

      agents.push(parsed);
    }
  }

  const settings: ACPSettings = { agents };
  if ('defaults' in value && value.defaults !== undefined) {
    if (!isRecord(value.defaults)) {
      throw new Error(`配置文件 ${sourcePath} 中 acp.defaults 必须是对象。`);
    }
    const d = value.defaults;
    if (
      'timeoutMs' in d &&
      d.timeoutMs !== undefined &&
      (typeof d.timeoutMs !== 'number' || !Number.isInteger(d.timeoutMs) || d.timeoutMs <= 0)
    ) {
      throw new Error(`配置文件 ${sourcePath} 中 acp.defaults.timeoutMs 必须是正整数。`);
    }
    if (typeof d.timeoutMs === 'number') {
      settings.defaults = { timeoutMs: d.timeoutMs };
    }
  }

  return settings;
}
