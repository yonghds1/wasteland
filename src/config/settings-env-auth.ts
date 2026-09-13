/**
 * settings-env-auth.ts - 环境变量覆盖 + auth-ref 解析
 *
 * 从 `load-settings.ts` 拆出：`WASTELAND_*` env 覆盖与 `{ $auth: KEY }`
 * 引用解析（auth.json / 进程 env 双源）。
 * 纯函数（读传入的 env 对象），可独立单测。
 */

import { isRecord, validatePermissionMode } from './validate-settings.js';
import type {
  A2AAgentsConfig,
  AuthRef,
  AuthSettings,
  MCPServerConfig,
  ModelSettings,
  ProviderSettings,
  ResolvedWastelandSettings,
  SubAgentSettings,
} from './settings-types.js';

export function parseBooleanOverride(value: string, envKey: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  throw new Error(`环境变量 ${envKey} 不是合法布尔值。`);
}

export function readNonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

export function isAuthRef(value: unknown): value is AuthRef {
  return isRecord(value) && typeof value.$auth === 'string' && value.$auth.trim().length > 0;
}

export function resolveAuthValue(params: {
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

export function resolveAuthRefsInValue(params: {
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

export function resolveSettingsAuthRefs(
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
    multiAgent: resolveAuthRefsInValue({
      value: settings.multiAgent,
      auth,
      env,
    }) as Record<string, SubAgentSettings>,
    // singleAgent 无敏感字段，原样透传（此前 return 漏掉 singleAgent，会被丢弃）
    singleAgent: settings.singleAgent ? { ...settings.singleAgent } : undefined,
    runtime: {
      ...settings.runtime,
    },
    mcpServers: resolvedMCPServers,
    // a2a.agents 的 token 支持 $auth ref；servers 无敏感字段，原样透传
    a2a: {
      agents: resolveAuthRefsInValue({
        value: settings.a2a.agents,
        auth,
        env,
      }) as A2AAgentsConfig,
      servers: { ...settings.a2a.servers },
    },
    // acp.agents[].env 支持 $auth ref（如远程 agent 的 API key），与 mcpServers.env 同语义
    acp: {
      ...settings.acp,
      agents: (settings.acp.agents ?? []).map((agent) => ({
        ...agent,
        ...(agent.env
          ? {
              env: resolveAuthRefsInValue({
                value: agent.env,
                auth,
                env,
              }) as Record<string, string>,
            }
          : {}),
      })),
    },
    parallel: {
      ...settings.parallel,
    },
  };
}

export function applyEnvironmentOverrides(
  settings: ResolvedWastelandSettings,
  env: NodeJS.ProcessEnv,
  supportedLanguages: readonly string[]
): ResolvedWastelandSettings {
  const resolved = {
    defaultProvider: settings.defaultProvider,
    providers: { ...settings.providers },
    models: { ...settings.models },
    multiAgent: { ...settings.multiAgent },
    // singleAgent 原样透传（此前 return 漏掉 singleAgent，会被丢弃）
    singleAgent: settings.singleAgent ? { ...settings.singleAgent } : undefined,
    runtime: {
      defaultRole: settings.runtime.defaultRole,
      skinId: settings.runtime.skinId,
      mode: settings.runtime.mode,
      defaultModel: settings.runtime.defaultModel,
      permissionMode: settings.runtime.permissionMode,
      maxStepsPerTurn: settings.runtime.maxStepsPerTurn,
      childAgentTimeout: settings.runtime.childAgentTimeout,
      compactionBudgetRatio: settings.runtime.compactionBudgetRatio,
      compactionThreshold: settings.runtime.compactionThreshold,
      summarizationThreshold: settings.runtime.summarizationThreshold,
      projectMemory: settings.runtime.projectMemory,
      contextSummarization: settings.runtime.contextSummarization,
      promptFormat: settings.runtime.promptFormat,
      debug: settings.runtime.debug,
      language: settings.runtime.language,
      showThinking: settings.runtime.showThinking,
      spinnerIntervalMs: settings.runtime.spinnerIntervalMs,
      typewriterRateMs: settings.runtime.typewriterRateMs,
      log: {
        level: settings.runtime.log.level,
        dir: settings.runtime.log.dir,
        redact: settings.runtime.log.redact,
        tailLines: settings.runtime.log.tailLines,
      },
    },
    mcpServers: { ...settings.mcpServers },
    a2a: {
      agents: [...settings.a2a.agents],
      servers: { ...settings.a2a.servers },
    },
    acp: {
      agents: settings.acp.agents.map((agent) => ({ ...agent })),
      ...(settings.acp.defaults ? { defaults: { ...settings.acp.defaults } } : {}),
    },
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

  const showThinkingEnv = env.WASTELAND_SHOW_THINKING ?? env.JOE_SHOW_THINKING;
  if (typeof showThinkingEnv === 'string' && showThinkingEnv.trim().length > 0) {
    resolved.runtime.showThinking = parseBooleanOverride(
      showThinkingEnv,
      'WASTELAND_SHOW_THINKING'
    );
  }

  const spinnerEnv = env.WASTELAND_SPINNER_INTERVAL_MS ?? env.JOE_SPINNER_INTERVAL_MS;
  if (typeof spinnerEnv === 'string' && spinnerEnv.trim().length > 0) {
    const parsed = Number.parseInt(spinnerEnv, 10);
    if (!Number.isInteger(parsed) || parsed < 16 || parsed > 1000) {
      throw new Error('环境变量 WASTELAND_SPINNER_INTERVAL_MS 必须是 16-1000 之间的整数（毫秒）。');
    }
    resolved.runtime.spinnerIntervalMs = parsed;
  }

  const typewriterEnv = env.WASTELAND_TYPEWRITER_RATE_MS ?? env.JOE_TYPEWRITER_RATE_MS;
  if (typeof typewriterEnv === 'string' && typewriterEnv.trim().length > 0) {
    const parsed = Number.parseInt(typewriterEnv, 10);
    if (!Number.isInteger(parsed) || parsed < 5 || parsed > 200) {
      throw new Error('环境变量 WASTELAND_TYPEWRITER_RATE_MS 必须是 5-200 之间的整数（毫秒）。');
    }
    resolved.runtime.typewriterRateMs = parsed;
  }

  const langEnv = env.WASTELAND_LANGUAGE ?? env.JOE_LANGUAGE;
  if (typeof langEnv === 'string' && langEnv.trim().length > 0) {
    const lang = langEnv.trim();
    if (!supportedLanguages.includes(lang)) {
      throw new Error(
        `环境变量 WASTELAND_LANGUAGE 必须是以下之一: ${supportedLanguages.join(', ')}`
      );
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

  // WASTELAND_LOG_* env: 与 WASTELAND_DEBUG 共存（debug=1 等价 level=debug）
  const logLevelEnv = env.WASTELAND_LOG_LEVEL;
  if (typeof logLevelEnv === 'string' && logLevelEnv.trim().length > 0) {
    const lower = logLevelEnv.trim().toLowerCase();
    if (lower !== 'debug' && lower !== 'info' && lower !== 'warn' && lower !== 'error') {
      throw new Error('环境变量 WASTELAND_LOG_LEVEL 必须是 debug/info/warn/error 之一。');
    }
    resolved.runtime.log.level = lower;
  } else if (resolved.runtime.debug) {
    // WASTELAND_DEBUG=1 → 隐式提升 log level 到 debug（保持旧行为兼容）
    resolved.runtime.log.level = 'debug';
  }

  const logDirEnv = env.WASTELAND_LOG_DIR;
  if (typeof logDirEnv === 'string' && logDirEnv.trim().length > 0) {
    resolved.runtime.log.dir = logDirEnv.trim();
  }

  const logRedactEnv = env.WASTELAND_LOG_REDACT;
  if (typeof logRedactEnv === 'string' && logRedactEnv.trim().length > 0) {
    resolved.runtime.log.redact = parseBooleanOverride(logRedactEnv, 'WASTELAND_LOG_REDACT');
  }

  const logTailEnv = env.WASTELAND_LOG_TAIL_LINES;
  if (typeof logTailEnv === 'string' && logTailEnv.trim().length > 0) {
    const parsed = Number.parseInt(logTailEnv, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error('环境变量 WASTELAND_LOG_TAIL_LINES 必须是正整数。');
    }
    resolved.runtime.log.tailLines = parsed;
  }

  return resolved;
}
