/**
 * command-manager.test.ts - CommandManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CommandManager,
  createCommandManager,
  getCommandManager,
  setCommandManager,
  resetCommandManager,
  parseArgs,
  type CommandDefinition
} from '../command-manager.js';

describe('CommandManager', () => {
  let manager: CommandManager;

  beforeEach(() => {
    manager = createCommandManager();
  });

  describe('register', () => {
    it('should register a command', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: ['/t'],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      expect(manager.get('/test')).toBeDefined();
      expect(manager.get('/test')?.name).toBe('/test');
    });

    it('should register command aliases', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: ['/t', '/testing'],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      expect(manager.get('/t')).toBeDefined();
      expect(manager.get('/t')?.name).toBe('/test');
      expect(manager.get('/testing')).toBeDefined();
      expect(manager.get('/testing')?.name).toBe('/test');
    });

    it('should register multiple commands', () => {
      const cmds: CommandDefinition[] = [
        {
          name: '/cmd1',
          aliases: [],
          category: 'local',
          description: 'Command 1',
          execute: async () => ({ type: 'output', output: 'cmd1' }),
        },
        {
          name: '/cmd2',
          aliases: ['/c2'],
          category: 'local',
          description: 'Command 2',
          execute: async () => ({ type: 'output', output: 'cmd2' }),
        },
      ];

      manager.registerAll(cmds);

      expect(manager.get('/cmd1')).toBeDefined();
      expect(manager.get('/cmd2')).toBeDefined();
      expect(manager.get('/c2')).toBeDefined();
    });
  });

  describe('unregister', () => {
    it('should unregister a command', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: ['/t'],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);
      expect(manager.get('/test')).toBeDefined();

      const result = manager.unregister('/test');
      expect(result).toBe(true);
      expect(manager.get('/test')).toBeUndefined();
      expect(manager.get('/t')).toBeUndefined();
    });

    it('should return false for non-existent command', () => {
      const result = manager.unregister('/nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('isCommand', () => {
    it('should return true for registered command', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      expect(manager.isCommand('/test')).toBe(true);
      expect(manager.isCommand('/test abc')).toBe(true);
    });

    it('should return true for command alias', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: ['/t'],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      expect(manager.isCommand('/t')).toBe(true);
      expect(manager.isCommand('/t abc')).toBe(true);
    });

    it('should return false for non-existent command', () => {
      expect(manager.isCommand('/nonexistent')).toBe(false);
      expect(manager.isCommand('not a command')).toBe(false);
    });

    it('should be case-insensitive', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      expect(manager.isCommand('/TEST')).toBe(true);
      expect(manager.isCommand('/Test')).toBe(true);
    });
  });

  describe('parse', () => {
    it('should parse command without args', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      const result = manager.parse('/test');
      expect(result).not.toBeNull();
      expect(result?.command).toBe('/test');
      expect(result?.args).toEqual({});
    });

    it('should parse command with positional args', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        args: [
          { name: 'id', type: 'string', optional: true },
        ],
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      const result = manager.parse('/test abc123');
      expect(result).not.toBeNull();
      expect(result?.args.id).toBe('abc123');
    });

    it('should parse command with named args', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        args: [
          { name: 'format', type: 'enum', values: ['text', 'json'], default: 'text' },
        ],
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      const result = manager.parse('/test --format json');
      expect(result).not.toBeNull();
      expect(result?.args.format).toBe('json');
    });

    it('should parse command with boolean args', () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        args: [
          { name: 'details', type: 'boolean', default: false },
        ],
        execute: async () => ({ type: 'output', output: 'test' }),
      };

      manager.register(cmd);

      const result = manager.parse('/test --details');
      expect(result).not.toBeNull();
      expect(result?.args.details).toBe(true);
    });

    it('should return null for non-existent command', () => {
      const result = manager.parse('/nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('execute', () => {
    it('should execute command and return output', async () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        execute: async () => ({ type: 'output', output: 'Hello, world!' }),
      };

      manager.register(cmd);

      const result = await manager.execute('/test', { mode: 'cli' });
      expect(result.type).toBe('output');
      if (result.type === 'output') {
        expect(result.output).toBe('Hello, world!');
      }
    });

    it('should execute command and return action', async () => {
      const cmd: CommandDefinition = {
        name: '/clear',
        aliases: [],
        category: 'local',
        description: 'Clear screen',
        execute: async () => ({ type: 'action', action: 'clear' }),
      };

      manager.register(cmd);

      const result = await manager.execute('/clear', { mode: 'tui' });
      expect(result.type).toBe('action');
      if (result.type === 'action') {
        expect(result.action).toBe('clear');
      }
    });

    it('should pass context to execute', async () => {
      let receivedMode: string | null = null;

      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        execute: async (params) => {
          receivedMode = params.context.mode;
          return { type: 'output', output: 'test' };
        },
      };

      manager.register(cmd);

      const context = { mode: 'cli' as const };
      await manager.execute('/test', context);

      expect(receivedMode).toBe(context.mode);
    });

    it('should return error for non-existent command', async () => {
      const result = await manager.execute('/nonexistent', { mode: 'cli' });
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.error).toContain('Unknown command');
      }
    });

    it('should handle execution errors', async () => {
      const cmd: CommandDefinition = {
        name: '/test',
        aliases: [],
        category: 'local',
        description: 'Test command',
        execute: async () => {
          throw new Error('Execution failed');
        },
      };

      manager.register(cmd);

      const result = await manager.execute('/test', { mode: 'cli' });
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.error).toBe('Execution failed');
      }
    });
  });

  describe('getHelpEntries', () => {
    it('should return help entries for all commands', () => {
      const cmds: CommandDefinition[] = [
        {
          name: '/test1',
          aliases: ['/t1'],
          category: 'local',
          description: 'Test command 1',
          execute: async () => ({ type: 'output', output: 'test' }),
        },
        {
          name: '/test2',
          aliases: [],
          category: 'skill',
          description: 'Test command 2',
          args: [
            { name: 'id', type: 'string', optional: true },
          ],
          execute: async () => ({ type: 'output', output: 'test' }),
        },
      ];

      manager.registerAll(cmds);

      const entries = manager.getHelpEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('/test1');
      expect(entries[0].aliases).toEqual(['/t1']);
      expect(entries[1].args).toHaveLength(1);
    });
  });

  describe('getByCategory', () => {
    it('should filter commands by category', () => {
      const cmds: CommandDefinition[] = [
        {
          name: '/local',
          aliases: [],
          category: 'local',
          description: 'Local command',
          execute: async () => ({ type: 'output', output: 'test' }),
        },
        {
          name: '/skill',
          aliases: [],
          category: 'skill',
          description: 'Skill command',
          execute: async () => ({ type: 'output', output: 'test' }),
        },
      ];

      manager.registerAll(cmds);

      const localCmds = manager.getByCategory('local');
      expect(localCmds).toHaveLength(1);
      expect(localCmds[0].name).toBe('/local');

      const skillCmds = manager.getByCategory('skill');
      expect(skillCmds).toHaveLength(1);
      expect(skillCmds[0].name).toBe('/skill');
    });
  });
});

describe('parseArgs', () => {
  it('should parse positional args', () => {
    const args = parseArgs('/test abc def', [
      { name: 'arg1', type: 'string' },
      { name: 'arg2', type: 'string' },
    ]);

    expect(args.arg1).toBe('abc');
    expect(args.arg2).toBe('def');
  });

  it('should parse named args', () => {
    const args = parseArgs('/test --name value', [
      { name: 'name', type: 'string' },
    ]);

    expect(args.name).toBe('value');
  });

  it('should parse boolean args', () => {
    const args = parseArgs('/test --verbose', [
      { name: 'verbose', type: 'boolean' },
    ]);

    expect(args.verbose).toBe(true);
  });

  it('should parse --no-xxx as false', () => {
    const args = parseArgs('/test --no-verbose', [
      { name: 'verbose', type: 'boolean', default: true },
    ]);

    expect(args.verbose).toBe(false);
  });

  it('should use default values', () => {
    const args = parseArgs('/test', [
      { name: 'format', type: 'string', default: 'text' },
    ]);

    expect(args.format).toBe('text');
  });

  it('should handle quoted strings', () => {
    const args = parseArgs('/test "hello world"', [
      { name: 'text', type: 'string' },
    ]);

    expect(args.text).toBe('hello world');
  });
});

describe('singleton functions', () => {
  beforeEach(() => {
    resetCommandManager();
  });

  it('should create and get global instance', () => {
    const manager1 = getCommandManager();
    const manager2 = getCommandManager();

    expect(manager1).toBe(manager2);
  });

  it('should set custom instance', () => {
    const custom = createCommandManager();
    setCommandManager(custom);

    const retrieved = getCommandManager();
    expect(retrieved).toBe(custom);
  });

  it('should reset instance', () => {
    const manager1 = getCommandManager();
    resetCommandManager();
    const manager2 = getCommandManager();

    expect(manager1).not.toBe(manager2);
  });
});
