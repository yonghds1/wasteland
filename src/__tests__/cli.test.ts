/**
 * cli.test.ts - CLI 顶层入口与参数路由测试
 */

import { describe, it, expect } from 'vitest';
import { resolveEffectiveArgv, REGISTERED_SUBCOMMANDS } from '../cli.js';

describe('resolveEffectiveArgv', () => {
  describe('管道直通与默认模式 (cliArgs.length === 0)', () => {
    it('非 TTY（管道输入）时自动追加 chat 进入无头模式，严禁添加 tui', () => {
      const argv = ['node', 'wasteland'];
      const resolved = resolveEffectiveArgv(argv, false /* isStdinTTY */);
      expect(resolved).toEqual(['node', 'wasteland', 'chat']);
    });

    it('交互式 TTY 时无参数默认启动 tui', () => {
      const argv = ['node', 'wasteland'];
      const resolved = resolveEffectiveArgv(argv, true /* isStdinTTY */);
      expect(resolved).toEqual(['node', 'wasteland', 'tui']);
    });
  });

  describe('顶层直传 Prompt 支持', () => {
    it('用户直接传文本 prompt 时自动重定向到 chat 执行流程', () => {
      const argv = ['node', 'wasteland', '帮我写个函数'];
      const resolved = resolveEffectiveArgv(argv, true);
      expect(resolved).toEqual(['node', 'wasteland', 'chat', '帮我写个函数']);
    });

    it('用户直接传 -p / --prompt 时自动重定向到 chat 执行流程', () => {
      const argv = ['node', 'wasteland', '-p', 'hello'];
      const resolved = resolveEffectiveArgv(argv, true);
      expect(resolved).toEqual(['node', 'wasteland', 'chat', '-p', 'hello']);
    });

    it('用户直接传 -m / --message 时自动重定向到 chat 执行流程', () => {
      const argv = ['node', 'wasteland', '-m', 'hello'];
      const resolved = resolveEffectiveArgv(argv, true);
      expect(resolved).toEqual(['node', 'wasteland', 'chat', '-m', 'hello']);
    });

    it('用户带选项直传 prompt 时（如 --debug）自动重定向到 chat', () => {
      const argv = ['node', 'wasteland', '--debug', '帮我写个函数'];
      const resolved = resolveEffectiveArgv(argv, true);
      expect(resolved).toEqual(['node', 'wasteland', 'chat', '--debug', '帮我写个函数']);
    });
  });

  describe('已注册子命令与帮助/版本标志透传', () => {
    it('帮助标志 (-h, --help) 不被重定向', () => {
      expect(resolveEffectiveArgv(['node', 'wasteland', '--help'], true)).toEqual(['node', 'wasteland', '--help']);
      expect(resolveEffectiveArgv(['node', 'wasteland', '-h'], true)).toEqual(['node', 'wasteland', '-h']);
    });

    it('版本标志 (-V, --version) 不被重定向', () => {
      expect(resolveEffectiveArgv(['node', 'wasteland', '--version'], true)).toEqual(['node', 'wasteland', '--version']);
      expect(resolveEffectiveArgv(['node', 'wasteland', '-V'], true)).toEqual(['node', 'wasteland', '-V']);
    });

    it('所有已注册子命令均保持原样不被重定向', () => {
      for (const cmd of REGISTERED_SUBCOMMANDS) {
        const argv = ['node', 'wasteland', cmd, 'arg1'];
        expect(resolveEffectiveArgv(argv, true)).toEqual(argv);
      }
    });
  });
});
