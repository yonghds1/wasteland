/**
 * doctor.ts - 系统健康诊断命令
 *
 * 检查 Node.js、Git、ripgrep、终端能力、配置与供应商连通性、皮肤系统。
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import { Command } from 'commander';

import { loadWastelandSettings } from '@config/load-settings.js';
import { resolveUserConfigDir } from '@config/paths.js';
import { isConfigEmpty } from '@config/config-writer.js';
import { defaultSkin, initSkinRegistry, listSkins } from '@skins/index.js';
import { t } from '@locales/index.js';
import { ANSI } from '@ui/terminal-theme.js';
import { detectTTY } from '@ui/tty-detect.js';

const execFileAsync = promisify(execFile);

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO';

export interface DoctorCheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  critical?: boolean;
  remedy?: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  status: 'ok' | 'warn' | 'error';
  summary: string;
  checks: DoctorCheckResult[];
}

const DEFAULT_PROBE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
  deepseek: 'https://api.deepseek.com',
  anthropic: 'https://api.anthropic.com',
  local: 'http://localhost:11434',
};

export function checkNodeVersion(version = process.version): DoctorCheckResult {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;
  if (major >= 20) {
    return {
      name: 'Node.js',
      status: 'PASS',
      message: `${version} (supported)`,
      critical: true,
      details: { version, major },
    };
  }
  return {
    name: 'Node.js',
    status: 'FAIL',
    message: `${version} (unsupported, Node.js >= 20.0.0 required)`,
    critical: true,
    remedy: 'Please upgrade Node.js to v20.0.0 or higher (https://nodejs.org).',
    details: { version, major },
  };
}

export async function checkGit(
  execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string }>
): Promise<DoctorCheckResult> {
  const runExec =
    execFn ??
    (async (cmd: string, args: string[]) =>
      execFileAsync(cmd, args, { encoding: 'utf8' }));
  try {
    const { stdout } = await runExec('git', ['--version']);
    const versionStr = stdout.trim();
    return {
      name: 'Git',
      status: 'PASS',
      message: `${versionStr} (checkpoint engine ready)`,
      critical: true,
      details: { version: versionStr },
    };
  } catch {
    return {
      name: 'Git',
      status: 'FAIL',
      message: 'git not found or execution failed (checkpoint engine required)',
      critical: true,
      remedy: 'Please install Git and make sure it is in your PATH (https://git-scm.com).',
    };
  }
}

export async function checkSearchEngine(
  execFn?: (cmd: string, args: string[]) => Promise<{ stdout: string }>
): Promise<DoctorCheckResult> {
  const runExec =
    execFn ??
    (async (cmd: string, args: string[]) =>
      execFileAsync(cmd, args, { encoding: 'utf8' }));
  try {
    const { stdout } = await runExec('rg', ['--version']);
    const firstLine = stdout.trim().split('\n')[0].trim();
    return {
      name: 'Search',
      status: 'PASS',
      message: `${firstLine} (fast-grep acceleration enabled)`,
      critical: false,
      details: { version: firstLine },
    };
  } catch {
    return {
      name: 'Search',
      status: 'INFO',
      message: 'ripgrep not found (falling back to git-grep/node stream)',
      critical: false,
      details: { fallback: 'git-grep/node-stream' },
    };
  }
}

export function checkTerminal(params?: {
  env?: NodeJS.ProcessEnv;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}): DoctorCheckResult {
  const env = params?.env ?? process.env;
  const stdinIsTTY = params?.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutIsTTY = params?.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  const isInteractive = stdinIsTTY && stdoutIsTTY;
  const isTrueColor =
    env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
  const is256Color = (env.TERM ?? '').includes('256');

  const colorDesc = isTrueColor
    ? '24-bit TrueColor supported'
    : is256Color
      ? '256-color supported'
      : stdoutIsTTY || env.FORCE_COLOR
        ? 'basic ANSI color supported'
        : 'plain text mode';

  return {
    name: 'Terminal',
    status: 'PASS',
    message: `${isInteractive ? 'TTY interactive' : 'non-interactive'}, ${colorDesc}`,
    critical: false,
    details: {
      isInteractive,
      isTrueColor,
      is256Color,
      term: env.TERM ?? 'unknown',
    },
  };
}

export async function checkConfigAndProviders(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
  skipProbe?: boolean;
  fetchFn?: typeof fetch;
}): Promise<DoctorCheckResult> {
  const cwd = params?.cwd ?? process.cwd();
  const env = params?.env ?? process.env;
  const timeoutMs = params?.probeTimeoutMs ?? 2500;
  const fetchImpl = params?.fetchFn ?? globalThis.fetch;

  let configDirExists = false;
  try {
    await access(resolveUserConfigDir(env));
    configDirExists = true;
  } catch {
    // 目录未创建或不可访问
  }

  let loaded;
  try {
    loaded = await loadWastelandSettings({ cwd, env });
  } catch (error) {
    return {
      name: 'Configuration',
      status: 'WARN',
      message: `Failed to load settings: ${error instanceof Error ? error.message : String(error)}`,
      critical: false,
      remedy: 'Run "wasteland setup" to generate configuration.',
    };
  }

  const settings = loaded.settings;
  const providers = settings.providers ?? {};
  const providerKeys = Object.keys(providers);

  if (isConfigEmpty(settings) || providerKeys.length === 0) {
    return {
      name: 'Configuration',
      status: 'WARN',
      message: 'No providers configured (run "wasteland setup")',
      critical: false,
      remedy: 'Run "wasteland setup" to configure your first model provider.',
      details: { configDirExists, providers: [] },
    };
  }

  const defaultProvider =
    settings.defaultProvider in providers
      ? settings.defaultProvider
      : providerKeys[0];
  const provider = providers[defaultProvider];
  const apiKey =
    typeof provider?.apiKey === 'string' ? provider.apiKey.trim() : '';
  const hasApiKey = apiKey.length > 0 || provider?.type === 'local';

  if (!hasApiKey) {
    return {
      name: 'Configuration',
      status: 'WARN',
      message: `default provider "${defaultProvider}" configured, but API key is missing`,
      critical: false,
      remedy: `Run "wasteland setup" or configure auth.json / environment variable for "${defaultProvider}".`,
      details: { defaultProvider, hasApiKey: false },
    };
  }

  if (!params?.skipProbe && typeof fetchImpl === 'function') {
    const probeUrl =
      provider?.baseUrl ??
      DEFAULT_PROBE_URLS[defaultProvider] ??
      (provider?.type ? DEFAULT_PROBE_URLS[provider.type] : undefined);

    if (probeUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          await fetchImpl(probeUrl, {
            method: 'HEAD',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        return {
          name: 'Configuration',
          status: 'WARN',
          message: `default provider "${defaultProvider}" configured (endpoint connection failed)`,
          critical: false,
          remedy: `Check network connection or endpoint configuration for "${probeUrl}".`,
          details: { defaultProvider, probeUrl, error: String(err) },
        };
      }
    }
  }

  return {
    name: 'Configuration',
    status: 'PASS',
    message: `default provider "${defaultProvider}" configured`,
    critical: false,
    details: { defaultProvider, type: provider?.type, configDirExists },
  };
}

export async function checkSkinSystem(params?: {
  userDir?: string;
  projectDir?: string;
  skinId?: string;
}): Promise<DoctorCheckResult> {
  try {
    const userDir = params?.userDir ?? resolveUserConfigDir();
    const registry = await initSkinRegistry(userDir, params?.projectDir);
    const targetSkinId = params?.skinId ?? defaultSkin;
    const skins = listSkins();
    const count = skins.length;

    if (!registry.hasSkin(targetSkinId) && count === 0) {
      return {
        name: 'Skin System',
        status: 'FAIL',
        message: 'No skins available in registry',
        critical: false,
      };
    }

    return {
      name: 'Skin System',
      status: 'PASS',
      message: `${targetSkinId} (${count} built-in personas available)`,
      critical: false,
      details: {
        activeSkin: targetSkinId,
        availableCount: count,
        skins: skins.map((s) => s.id),
      },
    };
  } catch (error) {
    return {
      name: 'Skin System',
      status: 'FAIL',
      message: `Skin initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      critical: false,
    };
  }
}

export async function runDoctorDiagnostics(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  skipNetworkProbe?: boolean;
  execGit?: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
  execRg?: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
}): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [
    checkNodeVersion(),
    await checkGit(options?.execGit),
    await checkSearchEngine(options?.execRg),
    checkTerminal({ env: options?.env }),
    await checkConfigAndProviders({
      cwd: options?.cwd,
      env: options?.env,
      skipProbe: options?.skipNetworkProbe,
    }),
    await checkSkinSystem(),
  ];

  const hasCriticalFailure = checks.some(
    (c) => c.critical && c.status === 'FAIL'
  );
  const hasWarningOrFail = checks.some(
    (c) => c.status === 'WARN' || c.status === 'FAIL'
  );

  let status: 'ok' | 'warn' | 'error' = 'ok';
  let summary = 'All critical checks passed! Wasteland is ready for action.';

  if (hasCriticalFailure) {
    status = 'error';
    summary = 'Critical checks failed! Wasteland cannot run properly.';
  } else if (hasWarningOrFail) {
    status = 'warn';
    summary = 'Wasteland is functional, but some recommended features are missing.';
  }

  return { status, summary, checks };
}

function formatBadge(status: CheckStatus, color: boolean): string {
  const glyphs: Record<CheckStatus, string> = {
    PASS: '[✓]',
    INFO: '[✓]',
    WARN: '[!]',
    FAIL: '[✗]',
  };
  if (!color) return glyphs[status];
  const colors: Record<CheckStatus, string> = {
    PASS: ANSI.green,
    INFO: ANSI.cyan,
    WARN: ANSI.yellow,
    FAIL: ANSI.red,
  };
  return `${colors[status]}${glyphs[status]}${ANSI.reset}`;
}

export function renderDoctorReport(
  report: DoctorReport,
  supportsColor = true
): string {
  const lines: string[] = [
    '',
    ' Wasteland Doctor - System Health & Diagnostics',
    '',
  ];

  for (const check of report.checks) {
    const badge = formatBadge(check.status, supportsColor);
    lines.push(`${badge} ${check.name}: ${check.message}`);
  }

  lines.push('', `Status: ${report.summary}`);

  const remedies = report.checks
    .filter((c) => c.remedy && (c.status === 'FAIL' || c.status === 'WARN'))
    .map((c) => `  • ${c.remedy}`);

  if (remedies.length > 0 && report.status === 'error') {
    lines.push('', 'Remedies:', ...remedies);
  }

  return lines.join('\n');
}

export function createDoctorCommand(): Command {
  const doctorCommand = new Command('doctor')
    .description(t('commands.doctor.description'))
    .option('--json', t('commands.doctor.options.json'))
    .action(async (options: { json?: boolean }) => {
      const report = await runDoctorDiagnostics();
      const hasCriticalFailure = report.checks.some(
        (c) => c.critical && c.status === 'FAIL'
      );

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const tty = detectTTY();
        console.log(renderDoctorReport(report, tty.supportsColor));
      }

      if (hasCriticalFailure) {
        process.exitCode = 1;
      }
    });

  return doctorCommand;
}
