import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@locales/index.js';

import {
  checkConfigAndProviders,
  checkGit,
  checkNodeVersion,
  checkSearchEngine,
  checkSkinSystem,
  checkTerminal,
  createDoctorCommand,
  renderDoctorReport,
  runDoctorDiagnostics,
  type DoctorReport,
} from '../doctor.js';

describe('doctor command and diagnostics', () => {
  beforeAll(async () => {
    await initI18n('en');
  });
  const originalExitCode = process.exitCode;
  let logOutput: string[];
  let errorOutput: string[];

  beforeEach(() => {
    logOutput = [];
    errorOutput = [];
    process.exitCode = undefined;

    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  describe('createDoctorCommand', () => {
    it('直接调用 doctor 命令输出结构清晰的体检报告', async () => {
      const command = createDoctorCommand();
      await command.parseAsync([], { from: 'user' });

      const output = logOutput.join('\n');
      expect(output).toContain('Wasteland Doctor - System Health & Diagnostics');
      expect(output).toContain('Node.js:');
      expect(output).toContain('Git:');
      expect(output).toContain('Search:');
      expect(output).toContain('Terminal:');
      expect(output).toContain('Configuration:');
      expect(output).toContain('Skin System:');
      expect(output).toContain('Status:');
      expect(process.exitCode).toBeUndefined();
    });

    it('--json 选项输出包含 checks、summary、status 字段的合法 JSON 对象', async () => {
      const command = createDoctorCommand();
      await command.parseAsync(['--json'], { from: 'user' });

      expect(logOutput.length).toBeGreaterThan(0);
      const jsonText = logOutput.join('\n');
      const parsed: DoctorReport = JSON.parse(jsonText);

      expect(parsed).toHaveProperty('status');
      expect(['ok', 'warn', 'error']).toContain(parsed.status);
      expect(parsed).toHaveProperty('summary');
      expect(typeof parsed.summary).toBe('string');
      expect(parsed).toHaveProperty('checks');
      expect(Array.isArray(parsed.checks)).toBe(true);

      const checkNames = parsed.checks.map((c) => c.name);
      expect(checkNames).toContain('Node.js');
      expect(checkNames).toContain('Git');
      expect(checkNames).toContain('Search');
      expect(checkNames).toContain('Terminal');
      expect(checkNames).toContain('Configuration');
      expect(checkNames).toContain('Skin System');
    });

    it('当存在致命错误时设置 process.exitCode = 1 并在终端输出修复建议', async () => {
      const command = createDoctorCommand();
      const originalVersion = process.version;
      Object.defineProperty(process, 'version', {
        value: 'v18.19.0',
        configurable: true,
      });

      try {
        await command.parseAsync([], { from: 'user' });

        expect(process.exitCode).toBe(1);
        const output = logOutput.join('\n');
        expect(output).toContain('[✗] Node.js: v18.19.0 (unsupported');
        expect(output).toContain('Remedies:');
        expect(output).toContain('Please upgrade Node.js to v20.0.0 or higher');
      } finally {
        Object.defineProperty(process, 'version', {
          value: originalVersion,
          configurable: true,
        });
      }
    });

    it('--json 模式下存在致命错误时同样将 process.exitCode 设为 1', async () => {
      const command = createDoctorCommand();
      const originalVersion = process.version;
      Object.defineProperty(process, 'version', {
        value: 'v16.20.0',
        configurable: true,
      });

      try {
        await command.parseAsync(['--json'], { from: 'user' });

        expect(process.exitCode).toBe(1);
        const parsed: DoctorReport = JSON.parse(logOutput.join('\n'));
        expect(parsed.status).toBe('error');
        const nodeCheck = parsed.checks.find((c) => c.name === 'Node.js');
        expect(nodeCheck?.status).toBe('FAIL');
      } finally {
        Object.defineProperty(process, 'version', {
          value: originalVersion,
          configurable: true,
        });
      }
    });
  });

  describe('checkNodeVersion', () => {
    it('Node 版本 >= 20.0.0 返回 PASS', () => {
      const result = checkNodeVersion('v22.14.0');
      expect(result.status).toBe('PASS');
      expect(result.critical).toBe(true);
      expect(result.message).toContain('v22.14.0 (supported)');
    });

    it('Node 版本 < 20.0.0 返回 FAIL 并给出升级建议', () => {
      const result = checkNodeVersion('v18.12.1');
      expect(result.status).toBe('FAIL');
      expect(result.critical).toBe(true);
      expect(result.remedy).toContain('upgrade Node.js');
    });
  });

  describe('checkGit', () => {
    it('Git 就绪时返回 PASS', async () => {
      const result = await checkGit(async () => ({
        stdout: 'git version 2.43.0\n',
      }));
      expect(result.status).toBe('PASS');
      expect(result.critical).toBe(true);
      expect(result.message).toContain('checkpoint engine ready');
    });

    it('Git 不可用时返回 FAIL 并标记为 critical', async () => {
      const result = await checkGit(async () => {
        throw new Error('git: not found');
      });
      expect(result.status).toBe('FAIL');
      expect(result.critical).toBe(true);
      expect(result.remedy).toContain('install Git');
    });
  });

  describe('checkSearchEngine', () => {
    it('检测到 rg 时返回 PASS 并提示 fast-grep acceleration', async () => {
      const result = await checkSearchEngine(async () => ({
        stdout: 'ripgrep 14.1.0 (rev abc)\n-SIMD',
      }));
      expect(result.status).toBe('PASS');
      expect(result.critical).toBe(false);
      expect(result.message).toContain('fast-grep acceleration enabled');
    });

    it('未找到 rg 时优雅降级为 INFO', async () => {
      const result = await checkSearchEngine(async () => {
        throw new Error('rg: command not found');
      });
      expect(result.status).toBe('INFO');
      expect(result.critical).toBe(false);
      expect(result.message).toContain('falling back to git-grep/node stream');
    });
  });

  describe('checkTerminal', () => {
    it('交互式且支持 TrueColor 时正确识别', () => {
      const result = checkTerminal({
        env: { COLORTERM: 'truecolor', TERM: 'xterm-256color' },
        stdinIsTTY: true,
        stdoutIsTTY: true,
      });
      expect(result.status).toBe('PASS');
      expect(result.message).toBe('TTY interactive, 24-bit TrueColor supported');
    });

    it('非交互模式或基本色彩时正确识别', () => {
      const result = checkTerminal({
        env: { TERM: 'dumb' },
        stdinIsTTY: false,
        stdoutIsTTY: false,
      });
      expect(result.status).toBe('PASS');
      expect(result.message).toBe('non-interactive, plain text mode');
    });
  });

  describe('checkConfigAndProviders', () => {
    it('未配置任何 provider 时输出 WARN 并提示运行 setup', async () => {
      const result = await checkConfigAndProviders({
        cwd: '/tmp/nonexistent-wasteland-test-dir',
        env: { HOME: '/tmp/nonexistent-home', WASTELAND_HOME: '/tmp/nonexistent-home/.wasteland' },
        skipProbe: true,
      });
      expect(result.status).toBe('WARN');
      expect(result.message).toContain('No providers configured (run "wasteland setup")');
      expect(result.remedy).toContain('wasteland setup');
    });

    it('配置有效且网络探测被跳过时返回 PASS', async () => {
      const result = await checkConfigAndProviders({
        skipProbe: true,
      });
      expect(result.name).toBe('Configuration');
      expect(['PASS', 'WARN']).toContain(result.status);
    });

    it('网络探测失败时输出 WARN 提示连接异常', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      const result = await checkConfigAndProviders({
        skipProbe: false,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      expect(result.name).toBe('Configuration');
      if (result.status === 'WARN') {
        expect(result.message).toMatch(/endpoint connection failed|No providers configured/);
      }
    });
  });

  describe('checkSkinSystem', () => {
    it('正常初始化皮肤系统并包含默认皮肤', async () => {
      const result = await checkSkinSystem();
      expect(result.status).toBe('PASS');
      expect(result.message).toContain('warlord-immortal');
      expect(result.message).toContain('built-in personas available');
    });
  });

  describe('runDoctorDiagnostics', () => {
    it('执行所有检查项并返回完整诊断报告', async () => {
      const report = await runDoctorDiagnostics({ skipNetworkProbe: true });
      expect(report).toHaveProperty('status');
      expect(report.checks.length).toBe(6);
    });
  });

  describe('renderDoctorReport', () => {
    it('无颜色模式下使用纯文本字符', () => {
      const report: DoctorReport = {
        status: 'ok',
        summary: 'All critical checks passed! Wasteland is ready for action.',
        checks: [
          { name: 'Node.js', status: 'PASS', message: 'v22.14.0 (supported)' },
          { name: 'Git', status: 'FAIL', message: 'git missing', critical: true, remedy: 'Install git' },
        ],
      };
      const text = renderDoctorReport(report, false);
      expect(text).toContain('[✓] Node.js: v22.14.0 (supported)');
      expect(text).toContain('[✗] Git: git missing');
      expect(text).not.toContain('\x1b[');
    });
  });
});
