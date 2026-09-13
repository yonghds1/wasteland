/**
 * settings-merge.ts - 多源 settings 合并（纯函数）
 *
 * 从 `load-settings.ts` 拆出：`expandRoleReferences` + `mergeSettings`。
 * user / project / env 多源优先级合并，字段级浅合并语义不变。
 */

import type {
  A2AAgentsConfig,
  A2AServersConfig,
  A2ASettings,
  ACPSettings,
  AcpAgentConfig,
  MCPServersConfig,
  MCPServerConfig,
  RawWastelandSettings,
  ResolvedWastelandSettings,
  SubAgentSettings,
} from './settings-types.js';
import type { RoleDefinition } from './roles/types.js';

export function expandRoleReferences(
  settings: ResolvedWastelandSettings,
  roles: Record<string, RoleDefinition>
): ResolvedWastelandSettings {
  const expandedSubAgents: Record<string, SubAgentSettings> = {};

  for (const [agentId, agentSettings] of Object.entries(settings.multiAgent ?? {})) {
    const roleRef = agentSettings.role;
    const roleDef = roleRef ? roles[roleRef] : undefined;

    if (roleDef) {
      // 角色定义作为 base，条目显式字段覆盖
      expandedSubAgents[agentId] = {
        ...roleDef,
        ...agentSettings,
        role: roleRef,
      };
    } else {
      expandedSubAgents[agentId] = { ...agentSettings };
    }
  }

  return {
    ...settings,
    multiAgent: expandedSubAgents,
    roles,
  };
}

export function mergeSettings(
  base: ResolvedWastelandSettings,
  next: RawWastelandSettings | null
): ResolvedWastelandSettings {
  if (!next) {
    return base;
  }

  const mergedProviders = { ...base.providers };
  const mergedModels = { ...base.models };
  const mergedSubAgents = { ...base.multiAgent };

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

  if (next.multiAgent) {
    for (const [agentId, agentSettings] of Object.entries(next.multiAgent)) {
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

  // 合并 a2a 配置块
  // - servers：按名称浅合并（后者字段覆盖前者）
  // - agents：按 name 去重（后者整体覆盖前者）
  const mergedA2AServers: A2AServersConfig = { ...(base.a2a?.servers ?? {}) };
  if (next.a2a?.servers) {
    for (const [serverName, serverConfig] of Object.entries(next.a2a.servers)) {
      mergedA2AServers[serverName] = {
        ...(mergedA2AServers[serverName] ?? {}),
        ...serverConfig,
      };
    }
  }

  const mergedA2AAgents: A2AAgentsConfig = [...(base.a2a?.agents ?? [])];
  if (next.a2a?.agents) {
    for (const agent of next.a2a.agents) {
      const existingIndex = mergedA2AAgents.findIndex((a) => a.name === agent.name);
      if (existingIndex >= 0) {
        mergedA2AAgents[existingIndex] = agent;
      } else {
        mergedA2AAgents.push(agent);
      }
    }
  }

  const mergedA2A: A2ASettings = {
    agents: mergedA2AAgents,
    servers: mergedA2AServers,
  };

  // 合并 acp 配置块（stdio agent）
  // - agents：按 name 去重（后者整体覆盖前者）
  // - defaults：字段级浅合并
  const mergedAcpAgents: AcpAgentConfig[] = [...base.acp.agents];
  if (next.acp?.agents) {
    for (const agent of next.acp.agents) {
      const existingIndex = mergedAcpAgents.findIndex((a) => a.name === agent.name);
      if (existingIndex >= 0) {
        mergedAcpAgents[existingIndex] = agent;
      } else {
        mergedAcpAgents.push(agent);
      }
    }
  }

  const mergedAcpDefaults =
    base.acp.defaults || next.acp?.defaults
      ? { ...(base.acp.defaults ?? {}), ...(next.acp?.defaults ?? {}) }
      : undefined;

  const mergedAcp: ACPSettings = {
    agents: mergedAcpAgents,
    ...(mergedAcpDefaults ? { defaults: mergedAcpDefaults } : {}),
  };

  // 合并 singleAgent（字段级浅合并；此前 merge 出口漏掉 singleAgent，导致 single skin 永不生效）
  const mergedSingleAgent =
    base.singleAgent || next.singleAgent
      ? { ...(base.singleAgent ?? {}), ...(next.singleAgent ?? {}) }
      : undefined;

  // 合并 roles（角色级 prompt 覆盖，字段级浅合并）
  const mergedRoles =
    base.roles || next.roles
      ? { ...(base.roles ?? {}), ...(next.roles ?? {}) }
      : undefined;

  return {
    defaultProvider: next.defaultProvider ?? base.defaultProvider,
    providers: mergedProviders,
    models: mergedModels,
    multiAgent: mergedSubAgents,
    singleAgent: mergedSingleAgent,
    roles: mergedRoles,
    runtime: {
      defaultRole: next.runtime?.defaultRole ?? base.runtime.defaultRole,
      skinId: next.runtime?.skinId ?? base.runtime.skinId,
      mode: next.runtime?.mode ?? base.runtime.mode,
      defaultModel: next.runtime?.defaultModel ?? base.runtime.defaultModel,
      permissionMode: next.runtime?.permissionMode ?? base.runtime.permissionMode,
      maxStepsPerTurn: next.runtime?.maxStepsPerTurn ?? base.runtime.maxStepsPerTurn,
      childAgentTimeout: next.runtime?.childAgentTimeout ?? base.runtime.childAgentTimeout,
      compactionBudgetRatio:
        next.runtime?.compactionBudgetRatio ?? base.runtime.compactionBudgetRatio,
      compactionThreshold: next.runtime?.compactionThreshold ?? base.runtime.compactionThreshold,
      summarizationThreshold:
        next.runtime?.summarizationThreshold ?? base.runtime.summarizationThreshold,
      projectMemory: next.runtime?.projectMemory ?? base.runtime.projectMemory,
      contextSummarization: next.runtime?.contextSummarization ?? base.runtime.contextSummarization,
      promptFormat: next.runtime?.promptFormat ?? base.runtime.promptFormat,
      debug: next.runtime?.debug ?? base.runtime.debug,
      language: next.runtime?.language ?? base.runtime.language,
      showThinking: next.runtime?.showThinking ?? base.runtime.showThinking,
      spinnerIntervalMs: next.runtime?.spinnerIntervalMs ?? base.runtime.spinnerIntervalMs,
      typewriterRateMs: next.runtime?.typewriterRateMs ?? base.runtime.typewriterRateMs,
      log: {
        level: next.runtime?.log?.level ?? base.runtime.log.level,
        dir: next.runtime?.log?.dir ?? base.runtime.log.dir,
        redact: next.runtime?.log?.redact ?? base.runtime.log.redact,
        tailLines: next.runtime?.log?.tailLines ?? base.runtime.log.tailLines,
      },
    },
    mcpServers: mergedMCPServers,
    a2a: mergedA2A,
    acp: mergedAcp,
    parallel: {
      maxConcurrency: next.parallel?.maxConcurrency ?? base.parallel.maxConcurrency,
    },
  };
}
