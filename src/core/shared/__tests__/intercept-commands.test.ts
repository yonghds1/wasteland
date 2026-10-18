/**
 * intercept-commands.test.ts - interceptCommands RxJS 操作符单元测试
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';
import { of } from 'rxjs';
import type { ChatInputTurn } from '@core/runtime/event-types.js';
import type { SyncCommandResult } from '../command-executor-sync.js';
import { interceptCommands } from '../intercept-commands.js';
import type { CommandWriter } from '@ui/cli-command-writer.js';
import { registerBuiltinCommands, getCommandManager, resetCommandManager } from '../command-manager.js';

/** 测试用 writer：记录所有 write 调用 */
function createTestWriter(): { writer: CommandWriter; calls: SyncCommandResult[] } {
  const calls: SyncCommandResult[] = [];
  return {
    writer: { write: (r) => calls.push(r) },
    calls,
  };
}

/** 构造测试 turn */
function makeTurn(content: string): ChatInputTurn {
  return {
    turn: 1,
    content,
    source: 'stdin',
  };
}

describe('interceptCommands', () => {
  beforeEach(async () => {
    resetCommandManager();
    await registerBuiltinCommands(getCommandManager());
  });

  afterEach(() => {
    resetCommandManager();
  });

  describe('non-command input', () => {
    it('should pass through plain text', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('hello world')).pipe(interceptCommands(writer));
      const result = await firstValueFrom(source);
      expect(result.content).toBe('hello world');
      expect(calls).toHaveLength(0);
    });

    it('should pass through empty string', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('')).pipe(interceptCommands(writer));
      const result = await firstValueFrom(source);
      expect(result.content).toBe('');
      expect(calls).toHaveLength(0);
    });

    it('should pass through whitespace-only', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('   ')).pipe(interceptCommands(writer));
      const result = await firstValueFrom(source);
      expect(result.content).toBe('   ');
      expect(calls).toHaveLength(0);
    });
  });

  describe('registered /-commands', () => {
    it('should intercept /help and consume', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/help')).pipe(interceptCommands(writer));
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0); // consumed
      expect(calls).toHaveLength(1);
      expect(calls[0]?.type).toBe('action');
    });

    it('should intercept /clear and consume', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/clear')).pipe(interceptCommands(writer));
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0);
      expect(calls).toHaveLength(1);
    });
  });

  describe('unregistered /-commands (default)', () => {
    it('should intercept /unknown and write error (NOT pass to agent)', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/unknown')).pipe(interceptCommands(writer));
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0); // consumed
      expect(calls).toHaveLength(1);
      expect(calls[0]?.type).toBe('error');
      if (calls[0]?.type === 'error') {
        expect(calls[0].error).toContain('Unknown command');
      }
    });

    it('should intercept typo /halp', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/halp')).pipe(interceptCommands(writer));
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.type).toBe('error');
    });
  });

  describe('unregistered /-commands with passthroughUnknown: true', () => {
    it('should pass through /unknown to agent without writing error', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/unknown')).pipe(
        interceptCommands(writer, { passthroughUnknown: true }),
      );
      const result = await firstValueFrom(source);
      expect(result.content).toBe('/unknown');
      expect(calls).toHaveLength(0);
    });

    it('should pass through file path prompt like /src/app.ts 语法错误 to agent', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/src/app.ts 语法错误')).pipe(
        interceptCommands(writer, { passthroughUnknown: true }),
      );
      const result = await firstValueFrom(source);
      expect(result.content).toBe('/src/app.ts 语法错误');
      expect(calls).toHaveLength(0);
    });

    it('should still intercept registered system commands like /help', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/help')).pipe(
        interceptCommands(writer, { passthroughUnknown: true }),
      );
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.type).toBe('action');
    });

    it('should still intercept registered system commands like /clear', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/clear')).pipe(
        interceptCommands(writer, { passthroughUnknown: true }),
      );
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0);
      expect(calls).toHaveLength(1);
    });
  });

  describe('provider tool syntax', () => {
    it('should pass through /spawn to the provider (not consume)', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/spawn analyst do research')).pipe(interceptCommands(writer));
      const result = await firstValueFrom(source);
      expect(result.content).toBe('/spawn analyst do research');
      expect(calls).toHaveLength(0);
    });

    it('should pass through /read to the provider', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('/read package.json')).pipe(interceptCommands(writer));
      const result = await firstValueFrom(source);
      expect(result.content).toBe('/read package.json');
      expect(calls).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle / in middle of text (not intercept)', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('hello /help world')).pipe(interceptCommands(writer));
      const result = await firstValueFrom(source);
      expect(result.content).toBe('hello /help world');
      expect(calls).toHaveLength(0);
    });

    it('should trim whitespace before checking', async () => {
      const { writer, calls } = createTestWriter();
      const source = of(makeTurn('  /help  ')).pipe(interceptCommands(writer));
      const results = await firstValueFrom(source.pipe(toArray()));
      expect(results).toHaveLength(0);
      expect(calls).toHaveLength(1);
    });
  });
});
