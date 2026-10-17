/**
 * command-definitions.test.ts - 内置命令定义测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandManager, createCommandManager } from '../command-manager.js';
import {
  clearCommand,
  sessionsCommand,
  logsCommand,
  modeCommand,
  contextCommand,
  helpCommand,
  toolsCommand,
  skillsCommand,
  exitCommand,
  builtinCommands,
} from '../command-definitions.js';

describe('Command Definitions', () => {
  let manager: CommandManager;

  beforeEach(() => {
    manager = createCommandManager();
    manager.registerAll(builtinCommands);
  });

  describe('clearCommand', () => {
    it('should have correct metadata', () => {
      expect(clearCommand.name).toBe('/clear');
      expect(clearCommand.aliases).toEqual([]);
      expect(clearCommand.category).toBe('local');
      expect(clearCommand.description).toBe('skills.help.localCommands.clear');
    });

    it('should execute and return clear action', async () => {
      const result = await clearCommand.execute({
        input: '/clear',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({ type: 'action', action: 'clear' });
    });
  });

  describe('sessionsCommand', () => {
    it('should have correct metadata', () => {
      expect(sessionsCommand.name).toBe('/sessions');
      expect(sessionsCommand.aliases).toEqual([]);
      expect(sessionsCommand.category).toBe('session');
      expect(sessionsCommand.description).toBe('skills.help.localCommands.sessions');
    });

    it('should execute and return sessions action', async () => {
      const result = await sessionsCommand.execute({
        input: '/sessions',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({ type: 'action', action: 'sessions' });
    });
  });

  describe('logsCommand', () => {
    it('should have correct metadata', () => {
      expect(logsCommand.name).toBe('/logs');
      expect(logsCommand.aliases).toEqual([]);
      expect(logsCommand.category).toBe('local');
      expect(logsCommand.description).toBe('skills.help.localCommands.logs');
    });

    it('should return action in TUI mode', async () => {
      const result = await logsCommand.execute({
        input: '/logs',
        args: {},
        context: { mode: 'tui' },
      });
      expect(result).toEqual({ type: 'action', action: 'logs' });
    });

    it('should return output in CLI mode', async () => {
      const result = await logsCommand.execute({
        input: '/logs',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({
        type: 'output',
        output: 'Logs page is only available in TUI mode.',
      });
    });
  });

  describe('modeCommand', () => {
    it('should have correct metadata', () => {
      expect(modeCommand.name).toBe('/mode');
      expect(modeCommand.aliases).toEqual([]);
      expect(modeCommand.category).toBe('local');
      expect(modeCommand.description).toBe('skills.help.localCommands.mode');
    });

    it('should execute and return mode action', async () => {
      const result = await modeCommand.execute({
        input: '/mode',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({ type: 'action', action: 'mode' });
    });
  });

  describe('contextCommand', () => {
    it('should have correct metadata', () => {
      expect(contextCommand.name).toBe('/context');
      expect(contextCommand.aliases).toEqual(['/ctx']);
      expect(contextCommand.category).toBe('local');
      expect(contextCommand.description).toBe('skills.help.localCommands.context');
      expect(contextCommand.args).toHaveLength(1);
      expect(contextCommand.args![0].name).toBe('session-id');
    });

    it('should return action in TUI mode', async () => {
      const result = await contextCommand.execute({
        input: '/context',
        args: {},
        context: { mode: 'tui' },
      });
      expect(result).toEqual({ type: 'action', action: 'context', data: { sessionId: undefined } });
    });

    it('should return output in CLI mode', async () => {
      const result = await contextCommand.execute({
        input: '/context',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({
        type: 'output',
        output: 'Context usage: (CLI mode - limited info)',
      });
    });

    it('should handle session-id argument', async () => {
      const result = await contextCommand.execute({
        input: '/context abc123',
        args: { 'session-id': 'abc123' },
        context: { mode: 'cli' },
      });
      expect(result).toEqual({
        type: 'output',
        output: 'Context for session abc123: (CLI mode - limited info)',
      });
    });
  });

  describe('helpCommand', () => {
    it('should have correct metadata', () => {
      expect(helpCommand.name).toBe('/help');
      expect(helpCommand.aliases).toEqual(['/h']);
      expect(helpCommand.category).toBe('skill');
      expect(helpCommand.description).toBe('skills.help.description');
    });

    it('should execute and return help action', async () => {
      const result = await helpCommand.execute({
        input: '/help',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({ type: 'action', action: 'help' });
    });
  });

  describe('toolsCommand', () => {
    it('should have correct metadata', () => {
      expect(toolsCommand.name).toBe('/tools');
      expect(toolsCommand.aliases).toEqual([]);
      expect(toolsCommand.category).toBe('skill');
      expect(toolsCommand.description).toBe('skills.tools.description');
    });

    it('should execute and return tools output', async () => {
      const result = await toolsCommand.execute({
        input: '/tools',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result.type).toBe('output');
      expect((result as any).output).toContain('/read');
      expect((result as any).output).toContain('/write');
    });
  });

  describe('skillsCommand', () => {
    it('should have correct metadata', () => {
      expect(skillsCommand.name).toBe('/skills');
      expect(skillsCommand.aliases).toEqual([]);
      expect(skillsCommand.category).toBe('local');
      expect(skillsCommand.description).toBe('skills.common.availableSkills');
    });

    it('should execute and return skills output', async () => {
      const result = await skillsCommand.execute({
        input: '/skills',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result.type).toBe('output');
    });

    it('should handle missing skillExecutor', async () => {
      const result = await skillsCommand.execute({
        input: '/skills',
        args: {},
        context: { mode: 'cli' },
      });
      // 无 skillExecutor 且未注册技能时：fallback 输出
      expect(result.type).toBe('output');
      expect((result as { output: string }).output).toMatch(/^(Available skills|No skills registered)/);
    });
  });

  describe('exitCommand', () => {
    it('should have correct metadata', () => {
      expect(exitCommand.name).toBe('/exit');
      expect(exitCommand.aliases).toEqual(['/quit']);
      expect(exitCommand.category).toBe('exit');
      expect(exitCommand.description).toBe('skills.help.localCommands.exit');
    });

    it('should execute and return exit action', async () => {
      const result = await exitCommand.execute({
        input: '/exit',
        args: {},
        context: { mode: 'cli' },
      });
      expect(result).toEqual({ type: 'action', action: 'exit' });
    });
  });

  describe('builtinCommands', () => {
    it('should contain all built-in commands', () => {
      expect(builtinCommands).toHaveLength(13);
      expect(builtinCommands.map((c) => c.name)).toEqual([
        '/clear',
        '/sessions',
        '/logs',
        '/mode',
        '/context',
        '/help',
        '/tools',
        '/skills',
        '/exit',
        '/status',
        '/init',
        '/review',
        '/workflows',
      ]);
    });
  });

  describe('CommandManager integration', () => {
    it('should register all built-in commands', () => {
      expect(manager.getAll()).toHaveLength(13);
    });

    it('should recognize built-in commands', () => {
      expect(manager.isCommand('/clear')).toBe(true);
      expect(manager.isCommand('/sessions')).toBe(true);
      expect(manager.isCommand('/logs')).toBe(true);
      expect(manager.isCommand('/mode')).toBe(true);
      expect(manager.isCommand('/context')).toBe(true);
      expect(manager.isCommand('/ctx')).toBe(true);
      expect(manager.isCommand('/help')).toBe(true);
      expect(manager.isCommand('/tools')).toBe(true);
      expect(manager.isCommand('/skills')).toBe(true);
      expect(manager.isCommand('/exit')).toBe(true);
      expect(manager.isCommand('/quit')).toBe(true);
    });

    it('should parse commands with arguments', () => {
      const parsed = manager.parse('/context abc123');
      expect(parsed).not.toBeNull();
      expect(parsed!.command).toBe('/context');
      expect(parsed!.args['session-id']).toBe('abc123');
    });

    it('should execute commands', async () => {
      const result = await manager.execute('/clear', { mode: 'cli' });
      expect(result).toEqual({ type: 'action', action: 'clear' });
    });

    it('should execute commands with aliases', async () => {
      const result = await manager.execute('/ctx', { mode: 'tui' });
      expect(result).toEqual({ type: 'action', action: 'context', data: { sessionId: undefined } });
    });
  });
});
