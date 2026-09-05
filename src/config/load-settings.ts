import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type AuthSettings,
  DEFAULT_WASTELAND_SETTINGS,
  type LoadedWastelandSettings,
  type RawWastelandSettings,
} from './settings-types.js';
import {
  findProjectConfigDir,
  resolveProjectAuthPath,
  resolveProjectSettingsPath,
  resolveUserConfigDir,
  resolveUserAuthPath,
  resolveUserSettingsPath,
} from './paths.js';
import { loadRolesWithPriority, mergeRoles } from './roles/index.js';
import { loadMemoryWithPriority } from './memory/loader.js';
import { DEFAULT_LANGUAGE } from '@locales/index.js';
import {
  isRecord,
  validateA2ASettings,
  validateMCPServers,
  validateModelSettings,
  validatePermissionMode,
  validateProviderSettings,
  validateRoleSettings,
  validateSingleAgentSettings,
} from './validate-settings.js';
import { expandRoleReferences, mergeSettings } from './settings-merge.js';
import {
  applyEnvironmentOverrides,
  resolveSettingsAuthRefs,
} from './settings-env-auth.js';

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
    return [DEFAULT_LANGUAGE];
  }
}

export async function parseSettings(raw: unknown, sourcePath: string): Promise<RawWastelandSettings> {
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

  if ('multiAgent' in raw && raw.multiAgent !== undefined) {
    settings.multiAgent = validateRoleSettings(raw.multiAgent, sourcePath);
  }

  // 解析 singleAgent 配置（带基本字段校验）
  if ('singleAgent' in raw && raw.singleAgent !== undefined) {
    settings.singleAgent = validateSingleAgentSettings(raw.singleAgent, sourcePath);
  }

  // 解析 roles 配置（角色级 prompt 覆盖）
  if ('roles' in raw && raw.roles !== undefined) {
    if (!isRecord(raw.roles)) {
      throw new Error(`配置文件 ${sourcePath} 中 roles 必须是对象。`);
    }
    settings.roles = raw.roles as RawWastelandSettings['roles'];
  }

  if ('runtime' in raw && raw.runtime !== undefined) {
    if (!isRecord(raw.runtime)) {
      throw new Error(`配置文件 ${sourcePath} 中 runtime 必须是对象。`);
    }

    const runtime: RawWastelandSettings['runtime'] = {};

    if ('mode' in raw.runtime && raw.runtime.mode !== undefined) {
      if (raw.runtime.mode !== 'single' && raw.runtime.mode !== 'multi') {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.mode 必须是 'single' 或 'multi'。`
        );
      }

      runtime.mode = raw.runtime.mode;
    }

    if ('defaultRole' in raw.runtime && raw.runtime.defaultRole !== undefined) {
      if (
        typeof raw.runtime.defaultRole !== 'string' ||
        raw.runtime.defaultRole.trim().length === 0
      ) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.defaultRole 必须是非空字符串。`);
      }

      runtime.defaultRole = raw.runtime.defaultRole.trim();
    }

    if ('skinId' in raw.runtime && raw.runtime.skinId !== undefined) {
      if (typeof raw.runtime.skinId !== 'string' || raw.runtime.skinId.trim().length === 0) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.skinId 必须是非空字符串。`);
      }

      runtime.skinId = raw.runtime.skinId.trim();
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

    if (
      'compactionBudgetRatio' in raw.runtime &&
      raw.runtime.compactionBudgetRatio !== undefined
    ) {
      if (
        typeof raw.runtime.compactionBudgetRatio !== 'number' ||
        raw.runtime.compactionBudgetRatio <= 0 ||
        raw.runtime.compactionBudgetRatio > 1
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.compactionBudgetRatio 必须大于 0 且不超过 1。`
        );
      }

      runtime.compactionBudgetRatio = raw.runtime.compactionBudgetRatio;
    }

    if ('compactionThreshold' in raw.runtime && raw.runtime.compactionThreshold !== undefined) {
      if (
        typeof raw.runtime.compactionThreshold !== 'number' ||
        raw.runtime.compactionThreshold <= 0 ||
        raw.runtime.compactionThreshold > 1
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.compactionThreshold 必须是 (0, 1] 区间的数字。`
        );
      }

      runtime.compactionThreshold = raw.runtime.compactionThreshold;
    }

    if (
      'summarizationThreshold' in raw.runtime &&
      raw.runtime.summarizationThreshold !== undefined
    ) {
      if (
        typeof raw.runtime.summarizationThreshold !== 'number' ||
        raw.runtime.summarizationThreshold <= 0 ||
        raw.runtime.summarizationThreshold > 1
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.summarizationThreshold 必须是 (0, 1] 区间的数字。`
        );
      }

      if (
        typeof raw.runtime.compactionThreshold === 'number' &&
        raw.runtime.summarizationThreshold < raw.runtime.compactionThreshold
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.summarizationThreshold 不能小于 compactionThreshold（${
            raw.runtime.compactionThreshold
          }）。高水位应高于低水位，否则摘要路径会抢在同步切割前触发。`
        );
      }

      runtime.summarizationThreshold = raw.runtime.summarizationThreshold;
    }

    if ('projectMemory' in raw.runtime && raw.runtime.projectMemory !== undefined) {
      if (typeof raw.runtime.projectMemory !== 'boolean') {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.projectMemory 必须是布尔值。`);
      }

      runtime.projectMemory = raw.runtime.projectMemory;
    }

    if ('contextSummarization' in raw.runtime && raw.runtime.contextSummarization !== undefined) {
      if (typeof raw.runtime.contextSummarization !== 'boolean') {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.contextSummarization 必须是布尔值。`);
      }

      runtime.contextSummarization = raw.runtime.contextSummarization;
    }

    if ('promptFormat' in raw.runtime && raw.runtime.promptFormat !== undefined) {
      if (raw.runtime.promptFormat !== 'markdown' && raw.runtime.promptFormat !== 'xml') {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.promptFormat 必须是 'markdown' 或 'xml'。`
        );
      }

      runtime.promptFormat = raw.runtime.promptFormat;
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

    if ('showThinking' in raw.runtime && raw.runtime.showThinking !== undefined) {
      if (typeof raw.runtime.showThinking !== 'boolean') {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.showThinking 必须是布尔值。`);
      }

      runtime.showThinking = raw.runtime.showThinking;
    }

    if ('spinnerIntervalMs' in raw.runtime && raw.runtime.spinnerIntervalMs !== undefined) {
      if (
        typeof raw.runtime.spinnerIntervalMs !== 'number' ||
        !Number.isInteger(raw.runtime.spinnerIntervalMs) ||
        raw.runtime.spinnerIntervalMs < 16 ||
        raw.runtime.spinnerIntervalMs > 1000
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.spinnerIntervalMs 必须是 16-1000 之间的整数（毫秒）。`
        );
      }

      runtime.spinnerIntervalMs = raw.runtime.spinnerIntervalMs;
    }

    if ('typewriterRateMs' in raw.runtime && raw.runtime.typewriterRateMs !== undefined) {
      if (
        typeof raw.runtime.typewriterRateMs !== 'number' ||
        !Number.isInteger(raw.runtime.typewriterRateMs) ||
        raw.runtime.typewriterRateMs < 5 ||
        raw.runtime.typewriterRateMs > 200
      ) {
        throw new Error(
          `配置文件 ${sourcePath} 中 runtime.typewriterRateMs 必须是 5-200 之间的整数（毫秒）。`
        );
      }

      runtime.typewriterRateMs = raw.runtime.typewriterRateMs;
    }

    if ('log' in raw.runtime && raw.runtime.log !== undefined) {
      if (!isRecord(raw.runtime.log)) {
        throw new Error(`配置文件 ${sourcePath} 中 runtime.log 必须是对象。`);
      }

      runtime.log = { ...runtime.log };

      const logLevelRaw = raw.runtime.log.level;
      if (logLevelRaw !== undefined) {
        if (
          logLevelRaw !== 'debug' &&
          logLevelRaw !== 'info' &&
          logLevelRaw !== 'warn' &&
          logLevelRaw !== 'error'
        ) {
          throw new Error(
            `配置文件 ${sourcePath} 中 runtime.log.level 必须是 debug/info/warn/error 之一。`
          );
        }
        runtime.log.level = logLevelRaw;
      }

      const logDirRaw = raw.runtime.log.dir;
      if (logDirRaw !== undefined) {
        if (typeof logDirRaw !== 'string' || logDirRaw.trim().length === 0) {
          throw new Error(`配置文件 ${sourcePath} 中 runtime.log.dir 必须是非空字符串。`);
        }
        runtime.log.dir = logDirRaw.trim();
      }

      const logRedactRaw = raw.runtime.log.redact;
      if (logRedactRaw !== undefined) {
        if (typeof logRedactRaw !== 'boolean') {
          throw new Error(`配置文件 ${sourcePath} 中 runtime.log.redact 必须是 boolean。`);
        }
        runtime.log.redact = logRedactRaw;
      }

      const logTailRaw = raw.runtime.log.tailLines;
      if (logTailRaw !== undefined) {
        if (typeof logTailRaw !== 'number' || !Number.isInteger(logTailRaw) || logTailRaw < 1) {
          throw new Error(
            `配置文件 ${sourcePath} 中 runtime.log.tailLines 必须是正整数。`
          );
        }
        runtime.log.tailLines = logTailRaw;
      }
    }

    settings.runtime = runtime;
  }

  // 解析 mcpServers 配置（此前缺失，导致 MCP 配置被静默丢弃）
  if ('mcpServers' in raw && raw.mcpServers !== undefined) {
    settings.mcpServers = validateMCPServers(raw.mcpServers, sourcePath);
  }

  // 解析 a2a 配置块（agents 出站调用 + servers 本机托管）
  if ('a2a' in raw && raw.a2a !== undefined) {
    settings.a2a = validateA2ASettings(raw.a2a, sourcePath);
  }

  if ('parallel' in raw && raw.parallel !== undefined) {
    if (!isRecord(raw.parallel)) {
      throw new Error(`配置文件 ${sourcePath} 中 parallel 必须是对象。`);
    }

    const parallel: NonNullable<RawWastelandSettings['parallel']> = {};

    if ('maxConcurrency' in raw.parallel && raw.parallel.maxConcurrency !== undefined) {
      if (
        typeof raw.parallel.maxConcurrency !== 'number' ||
        !Number.isInteger(raw.parallel.maxConcurrency)
      ) {
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

  const supportedLanguages = await getSupportedLanguages();
  const merged = applyEnvironmentOverrides(
    resolveSettingsAuthRefs(
      mergeSettings(mergeSettings(DEFAULT_WASTELAND_SETTINGS, userSettings), projectSettings),
      mergedAuth,
      processEnv
    ),
    processEnv,
    supportedLanguages
  );

  // 角色定义：加载 roles.json（内置默认 + 用户级 + 项目级），
  // 与 settings.json 内联 roles 合并，并把 multiAgent[name].role 引用展开进条目。
  const { roles } = await loadRolesWithPriority(userConfigDir, projectConfigDir ?? undefined);
  const mergedRoles = mergeRoles(roles, merged.roles ?? {});
  const expandedSettings = expandRoleReferences(merged, mergedRoles);

  // 项目记忆：开关开启时加载 memory.md（用户级 + 项目级），关闭时为 ''
  const projectMemoryEnabled = merged.runtime.projectMemory !== false;
  const { memory } = projectMemoryEnabled
    ? await loadMemoryWithPriority(userConfigDir, projectConfigDir ?? undefined)
    : { memory: '' };

  return {
    settings: expandedSettings,
    sources: {
      user: userSettings ? userSettingsPath : undefined,
      project: projectSettings ? (projectSettingsPath ?? undefined) : undefined,
      userAuth: userAuth ? userAuthPath : undefined,
      projectAuth: projectAuth ? (projectAuthPath ?? undefined) : undefined,
    },
    projectConfigDir,
    userConfigDir,
    memory,
  };
}
