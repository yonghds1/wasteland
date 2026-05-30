/**
 * local-commands.test.ts - executeLocalCommand 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import {
  executeLocalCommand,
  isLocalCommand,
  isExitCommand,
} from './local-commands.js';

describe('executeLocalCommand', () => {
  describe('/help 命令', () => {
    it('应该处理 /help 命令', () => {
      const result = executeLocalCommand({ command: '/help' });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('help');
      expect(result.output).toContain('/help');
      expect(result.output).toContain('/tools');
      expect(result.output).toContain('/skills');
    });

    it('应该处理大写 /HELP', () => {
      const result = executeLocalCommand({ command: '/HELP' });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('help');
    });
  });

  describe('/tools 命令', () => {
    it('应该处理 /tools 命令', () => {
      const result = executeLocalCommand({ command: '/tools' });

      expect(result.handled).toBe(true);
      expect(result.output).toContain('/read');
      expect(result.output).toContain('/write');
      expect(result.output).toContain('/bash');
    });
  });

  describe('/skills 命令', () => {
    it('应该处理 /skills 命令（有 skillExecutor）', () => {
      const mockSkillExecutor = {
        createSkillsHelp: vi.fn().mockReturnValue('skill1, skill2'),
      } as any;

      const result = executeLocalCommand({
        command: '/skills',
        skillExecutor: mockSkillExecutor,
      });

      expect(result.handled).toBe(true);
      expect(result.output).toContain('skill1, skill2');
      expect(mockSkillExecutor.createSkillsHelp).toHaveBeenCalled();
    });

    it('应该处理 /skills 命令（无 skillExecutor）', () => {
      const result = executeLocalCommand({ command: '/skills' });

      expect(result.handled).toBe(true);
      expect(result.output).toContain('not available');
    });
  });

  describe('/clear 命令', () => {
    it('应该处理 /clear 命令', () => {
      const result = executeLocalCommand({ command: '/clear' });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('clear');
    });
  });

  describe('/exit 和 /quit 命令', () => {
    it('应该处理 /exit 命令', () => {
      const result = executeLocalCommand({ command: '/exit' });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('exit');
    });

    it('应该处理 /quit 命令', () => {
      const result = executeLocalCommand({ command: '/quit' });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('exit');
    });
  });

  describe('未处理的命令', () => {
    it('应该返回 handled: false 对于普通文本', () => {
      const result = executeLocalCommand({ command: 'hello world' });

      expect(result.handled).toBe(false);
      expect(result.output).toBeUndefined();
      expect(result.action).toBeUndefined();
    });

    it('应该返回 handled: false 对于空字符串', () => {
      const result = executeLocalCommand({ command: '' });

      expect(result.handled).toBe(false);
    });
  });
});

describe('isLocalCommand', () => {
  it('应该识别 /help 为本地命令', () => {
    expect(isLocalCommand('/help')).toBe(true);
  });

  it('应该识别 /tools 为本地命令', () => {
    expect(isLocalCommand('/tools')).toBe(true);
  });

  it('应该识别 /skills 为本地命令', () => {
    expect(isLocalCommand('/skills')).toBe(true);
  });

  it('应该识别 /clear 为本地命令', () => {
    expect(isLocalCommand('/clear')).toBe(true);
  });

  it('应该识别 /exit 为本地命令', () => {
    expect(isLocalCommand('/exit')).toBe(true);
  });

  it('应该识别 /quit 为本地命令', () => {
    expect(isLocalCommand('/quit')).toBe(true);
  });

  it('应该不识别普通文本为本地命令', () => {
    expect(isLocalCommand('hello')).toBe(false);
  });

  it('应该不识别 /unknown 为本地命令', () => {
    expect(isLocalCommand('/unknown')).toBe(false);
  });
});

describe('isExitCommand', () => {
  it('应该识别 /exit 为退出命令', () => {
    expect(isExitCommand('/exit')).toBe(true);
  });

  it('应该识别 /quit 为退出命令', () => {
    expect(isExitCommand('/quit')).toBe(true);
  });

  it('应该不识别 /help 为退出命令', () => {
    expect(isExitCommand('/help')).toBe(false);
  });

  it('应该不识别普通文本为退出命令', () => {
    expect(isExitCommand('exit')).toBe(false);
  });
});
