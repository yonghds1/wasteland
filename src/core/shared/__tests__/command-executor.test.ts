/**
 * command-executor.test.ts - 统一命令执行器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  executeCommand,
  isLocalCommand,
  type ExtendedCommandExecutionContext,
  type ActionResult,
  type OutputResult,
  type ErrorResult,
} from '../command-executor.js';
import { CommandManager, createCommandManager, setCommandManager } from '../command-manager.js';
import { builtinCommands } from '../command-definitions.js';

describe('Command Executor', () => {
  let manager: CommandManager;

  beforeEach(() => {
    manager = createCommandManager();
    manager.registerAll(builtinCommands);
    setCommandManager(manager);
  });

  describe('executeCommand', () => {
    it('should execute clear command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/clear',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/clear', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('clear');
      expect((result as ActionResult).needsClearScreen).toBe(true);
      expect((result as ActionResult).needsPromptRefresh).toBe(true);
    });

    it('should execute exit command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/exit',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/exit', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('exit');
      expect((result as ActionResult).needsExit).toBe(true);
    });

    it('should execute sessions command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/sessions',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/sessions', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('sessions');
      expect((result as ActionResult).pageTransition).toBe('sessions');
    });

    it('should execute help command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/help',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/help', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('help');
      expect((result as ActionResult).showHelpDialog).toBe('commands');
    });

    it('should execute context command in TUI mode', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/context',
        args: {},
        context: { mode: 'tui' },
      };

      const result = await executeCommand('/context', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('context');
    });

    it('should execute context command in CLI mode', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/context',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/context', context);

      expect(result.type).toBe('output');
      expect((result as OutputResult).output).toContain('Context usage');
    });

    it('should execute context command with session-id', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/context abc123',
        args: { 'session-id': 'abc123' },
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/context abc123', context);

      expect(result.type).toBe('output');
      expect((result as OutputResult).output).toContain('abc123');
    });

    it('should execute tools command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/tools',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/tools', context);

      expect(result.type).toBe('output');
      expect((result as OutputResult).output).toContain('/read');
    });

    it('should execute mode command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/mode',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/mode', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('mode');
      expect((result as ActionResult).modeSwitch).toBe('/mode');
    });

    it('should handle unknown command', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/unknown',
        args: {},
        context: { mode: 'cli' },
      };

      const result = await executeCommand('/unknown', context);

      expect(result.type).toBe('error');
      expect((result as ErrorResult).error).toContain('Unknown command');
    });

    it('should execute command with aliases', async () => {
      const context: ExtendedCommandExecutionContext = {
        input: '/ctx',
        args: {},
        context: { mode: 'tui' },
      };

      const result = await executeCommand('/ctx', context);

      expect(result.type).toBe('action');
      expect((result as ActionResult).action).toBe('context');
    });
  });

  describe('isLocalCommand', () => {
    it('should return true for registered commands', () => {
      expect(isLocalCommand('/clear')).toBe(true);
      expect(isLocalCommand('/sessions')).toBe(true);
      expect(isLocalCommand('/help')).toBe(true);
      expect(isLocalCommand('/tools')).toBe(true);
      expect(isLocalCommand('/context')).toBe(true);
      expect(isLocalCommand('/ctx')).toBe(true);
    });

    it('should return true for any slash command', () => {
      expect(isLocalCommand('/anything')).toBe(true);
    });

    it('should return false for non-commands', () => {
      expect(isLocalCommand('hello')).toBe(false);
      expect(isLocalCommand('test')).toBe(false);
    });
  });
});
