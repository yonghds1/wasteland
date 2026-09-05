/**
 * route-logs-command.test.ts - 7 个 /logs 子命令的纯函数测试
 */

import { describe, it, expect, vi } from 'vitest';
import {
  routeLogsCommand,
  isLogsRootCommand,
  toPageName,
  type RoutePage,
  type LogPageFilter,
  type LogScope,
} from './route-logs-command.js';

// ============================================================
// Helpers
// ============================================================

interface DepsBundle {
  deps: {
    dispatchPage: (page: RoutePage) => void;
    applyFilter: (patch: Partial<LogPageFilter>) => void;
    resetFilter: () => void;
    echo: (msg: string) => void;
    helpText: string;
  };
  dispatchPage: ReturnType<typeof vi.fn>;
  applyFilter: ReturnType<typeof vi.fn>;
  resetFilter: ReturnType<typeof vi.fn>;
  echo: ReturnType<typeof vi.fn>;
}

function makeDeps(): DepsBundle {
  const dispatchPage = vi.fn();
  const applyFilter = vi.fn();
  const resetFilter = vi.fn();
  const echo = vi.fn();
  return {
    deps: {
      // vitest 的 vi.fn() 返回 generic Mock 类型；这里强转为函数签名便于传参。
      dispatchPage: dispatchPage as unknown as (page: RoutePage) => void,
      applyFilter: applyFilter as unknown as (patch: Partial<LogPageFilter>) => void,
      resetFilter: resetFilter as unknown as () => void,
      echo: echo as unknown as (msg: string) => void,
      helpText: 'TEST_HELP_TEXT',
    },
    dispatchPage,
    applyFilter,
    resetFilter,
    echo,
  };
}

// ============================================================
// isLogsRootCommand
// ============================================================

describe('isLogsRootCommand', () => {
  it('accepts only logs', () => {
    expect(isLogsRootCommand('logs')).toBe(true);
    expect(isLogsRootCommand('log')).toBe(false);
    expect(isLogsRootCommand('debug')).toBe(false);
  });

  it('rejects other commands', () => {
    expect(isLogsRootCommand('help')).toBe(false);
    expect(isLogsRootCommand('clear')).toBe(false);
    expect(isLogsRootCommand('')).toBe(false);
    expect(isLogsRootCommand('LOGS')).toBe(false); // case sensitive
  });
});

// ============================================================
// toPageName
// ============================================================

describe('toPageName', () => {
  it('maps chat -> session', () => {
    expect(toPageName('chat')).toBe('session');
  });
  it('passes through sessions', () => {
    expect(toPageName('sessions')).toBe('sessions');
  });
  it('passes through logs', () => {
    expect(toPageName('logs')).toBe('logs');
  });
});

// ============================================================
// routeLogsCommand: 7 个子命令
// ============================================================

describe('routeLogsCommand', () => {
  it('handles /logs (no args) → dispatchPage(logs)', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', [], b.deps);
    expect(handled).toBe(true);
    expect(b.dispatchPage).toHaveBeenCalledWith('logs');
    expect(b.applyFilter).not.toHaveBeenCalled();
  });

  it('handles /logs close → dispatchPage(chat)', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['close'], b.deps);
    expect(handled).toBe(true);
    expect(b.dispatchPage).toHaveBeenCalledWith('chat');
  });

  it('handles /logs errors → dispatchPage(logs) + applyFilter({ level: error })', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['errors'], b.deps);
    expect(handled).toBe(true);
    expect(b.dispatchPage).toHaveBeenCalledWith('logs');
    expect(b.applyFilter).toHaveBeenCalledWith({ level: 'error' });
  });

  it('handles /logs show <sid> → dispatchPage(logs) + applyFilter({ sessionId })', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['show', 'abc-123'], b.deps);
    expect(handled).toBe(true);
    expect(b.dispatchPage).toHaveBeenCalledWith('logs');
    expect(b.applyFilter).toHaveBeenCalledWith({ sessionId: 'abc-123' });
  });

  it('handles /logs show without sid → echo usage', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['show'], b.deps);
    expect(handled).toBe(true);
    expect(b.echo).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(b.dispatchPage).not.toHaveBeenCalled();
  });

  it('handles /logs level <l> → applyFilter({ level }) only', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['level', 'warn'], b.deps);
    expect(handled).toBe(true);
    expect(b.applyFilter).toHaveBeenCalledWith({ level: 'warn' });
    // 不切 page
    expect(b.dispatchPage).not.toHaveBeenCalled();
  });

  it('handles /logs level <bad> → echo usage', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['level', 'bogus'], b.deps);
    expect(handled).toBe(true);
    expect(b.echo).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    expect(b.applyFilter).not.toHaveBeenCalled();
  });

  it('handles /logs scope <s> → applyFilter({ scope }) only', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['scope', 'tool,permission'], b.deps);
    expect(handled).toBe(true);
    const arg = b.applyFilter.mock.calls[0]?.[0] as Partial<LogPageFilter>;
    expect(arg.scope).toBeInstanceOf(Set);
    expect(arg.scope?.has('tool')).toBe(true);
    expect(arg.scope?.has('permission')).toBe(true);
    expect(arg.scope?.size).toBe(2);
    // 不切 page
    expect(b.dispatchPage).not.toHaveBeenCalled();
  });

  it('handles /logs scope silently dropping invalid scope names', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['scope', 'tool,bogus,permission,foo'], b.deps);
    expect(handled).toBe(true);
    const arg = b.applyFilter.mock.calls[0]?.[0] as Partial<LogPageFilter>;
    expect(arg.scope?.has('tool')).toBe(true);
    expect(arg.scope?.has('permission')).toBe(true);
    expect(arg.scope?.has('bogus' as LogScope)).toBe(false);
    expect(arg.scope?.size).toBe(2);
  });

  it('handles /logs scope with empty input → echo usage', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['scope', '   '], b.deps);
    expect(handled).toBe(true);
    expect(b.echo).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('handles /logs help → echo helpText', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['help'], b.deps);
    expect(handled).toBe(true);
    expect(b.echo).toHaveBeenCalledWith('TEST_HELP_TEXT');
    expect(b.dispatchPage).not.toHaveBeenCalled();
  });

  it('returns false for unknown subcommand', () => {
    const b = makeDeps();
    const handled = routeLogsCommand('logs', ['bogus'], b.deps);
    expect(handled).toBe(false);
    expect(b.dispatchPage).not.toHaveBeenCalled();
    expect(b.applyFilter).not.toHaveBeenCalled();
    expect(b.echo).not.toHaveBeenCalled();
  });

  it('returns false for non-logs root command', () => {
    const b = makeDeps();
    expect(routeLogsCommand('help', [], b.deps)).toBe(false);
    expect(routeLogsCommand('clear', [], b.deps)).toBe(false);
    expect(routeLogsCommand('unknown', [], b.deps)).toBe(false);
  });

  it('dispatches to RoutePage values', () => {
    const b = makeDeps();
    routeLogsCommand('logs', ['close'], b.deps);
    const arg = b.dispatchPage.mock.calls[0]?.[0] as RoutePage;
    expect(arg).toBe('chat');
  });
});