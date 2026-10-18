import { describe, it, expect } from 'vitest';
import { fuzzyMatchFiles, scoreFileMatch } from '../fuzzy-match.js';

describe('fuzzy-match', () => {
  const fileList = [
    'src/tui/components/ChatInputBar.tsx',
    'src/tui/components/ChatMessageList.tsx',
    'src/tui/App.tsx',
    'package.json',
    'src/cli.ts',
    'src/core/engine/agent-loop.ts',
    'src/core/engine/turn-executor.ts',
  ];

  it('空查询词返回按长度排序的候选项', () => {
    const matched = fuzzyMatchFiles('', fileList, 3);
    expect(matched.length).toBe(3);
    expect(matched).toContain('src/cli.ts');
  });

  it('文件名前缀匹配得分最高', () => {
    const matched = fuzzyMatchFiles('ChatIn', fileList);
    expect(matched[0]).toBe('src/tui/components/ChatInputBar.tsx');
  });

  it('直接计算单文件匹配得分', () => {
    const score = scoreFileMatch('ChatIn', 'src/tui/components/ChatInputBar.tsx');
    expect(score).toBeGreaterThan(0);
  });

  it('首字母/驼峰缩写匹配', () => {
    const matched = fuzzyMatchFiles('cib', fileList);
    expect(matched).toContain('src/tui/components/ChatInputBar.tsx');
  });

  it('路径包含匹配', () => {
    const matched = fuzzyMatchFiles('engine', fileList);
    expect(matched).toContain('src/core/engine/agent-loop.ts');
    expect(matched).toContain('src/core/engine/turn-executor.ts');
  });

  it('完全不匹配返回空数组', () => {
    const matched = fuzzyMatchFiles('xyz123nonexistent', fileList);
    expect(matched).toEqual([]);
  });
});
