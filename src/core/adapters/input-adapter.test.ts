/**
 * input-adapter.test.ts - InputAdapter 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { TuiInputAdapter } from '../../tui/tui-input-adapter.js';
import type { SkillExecutor } from '../../skills/skill-executor.js';

describe('TuiInputAdapter', () => {
  it('应该创建适配器', () => {
    const adapter = new TuiInputAdapter();

    expect(adapter).toBeDefined();
    expect(adapter.input$).toBeDefined();

    adapter.destroy();
  });

  it('应该发送 ChatInputTurn', () => {
    const adapter = new TuiInputAdapter();
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('hello world');

    expect(emissions).toHaveLength(1);
    expect(emissions[0]).toEqual({
      turn: 1,
      content: 'hello world',
      source: 'interactive',
    });

    adapter.destroy();
  });

  it('应该递增 turn 计数', () => {
    const adapter = new TuiInputAdapter();
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('first');
    adapter.send('second');
    adapter.send('third');

    expect(emissions).toHaveLength(3);
    expect(emissions[0].turn).toBe(1);
    expect(emissions[1].turn).toBe(2);
    expect(emissions[2].turn).toBe(3);

    adapter.destroy();
  });

  it('应该过滤空输入', () => {
    const adapter = new TuiInputAdapter();
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('');
    adapter.send('   ');

    expect(emissions).toHaveLength(0);

    adapter.destroy();
  });

  it('应该处理 /help 命令', () => {
    const onCommand = vi.fn();
    const adapter = new TuiInputAdapter({ onCommand });
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('/help');

    expect(emissions).toHaveLength(0);
    expect(onCommand).toHaveBeenCalledWith({
      handled: true,
      output: expect.stringContaining('/help'),
      action: 'help',
    });

    adapter.destroy();
  });

  it('应该处理 /exit 命令', () => {
    const onCommand = vi.fn();
    const onExit = vi.fn();
    const adapter = new TuiInputAdapter({ onCommand, onExit });
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('/exit');

    expect(emissions).toHaveLength(0);
    expect(onCommand).toHaveBeenCalledWith({
      handled: true,
      action: 'exit',
    });
    expect(onExit).toHaveBeenCalled();

    adapter.destroy();
  });

  it('应该处理 /clear 命令', () => {
    const onCommand = vi.fn();
    const adapter = new TuiInputAdapter({ onCommand });
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('/clear');

    expect(emissions).toHaveLength(0);
    expect(onCommand).toHaveBeenCalledWith({
      handled: true,
      action: 'clear',
    });

    adapter.destroy();
  });

  it('应该处理 /skills 命令', () => {
    const mockSkillExecutor = {
      createSkillsHelp: vi.fn().mockReturnValue('skill1, skill2'),
    } as unknown as SkillExecutor;

    const onCommand = vi.fn();
    const adapter = new TuiInputAdapter({
      skillExecutor: mockSkillExecutor,
      onCommand,
    });
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.send('/skills');

    expect(emissions).toHaveLength(0);
    expect(onCommand).toHaveBeenCalledWith({
      handled: true,
      output: expect.stringContaining('skill1, skill2'),
    });

    adapter.destroy();
  });

  it('应该在销毁后不再发送', () => {
    const adapter = new TuiInputAdapter();
    const emissions: any[] = [];

    adapter.input$.subscribe((turn) => {
      emissions.push(turn);
    });

    adapter.destroy();

    // 尝试发送（应该被忽略）
    adapter.send('after destroy');

    expect(emissions).toHaveLength(0);
  });
});
