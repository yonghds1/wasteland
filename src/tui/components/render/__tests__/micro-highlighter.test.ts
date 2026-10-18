import { describe, it, expect } from 'vitest';
import { highlightLine, highlightCode } from '../micro-highlighter.js';

describe('MicroHighlighter', () => {
  it('支持 JavaScript / TypeScript 关键字与字符串高亮', () => {
    const tokens = highlightLine('const msg = "hello";', 'typescript');
    const constToken = tokens.find((t) => t.text === 'const');
    expect(constToken?.color).toBe('cyan');
    expect(constToken?.bold).toBe(true);

    const strToken = tokens.find((t) => t.text === '"hello"');
    expect(strToken?.color).toBe('green');
  });

  it('支持 Python 关键词与注释高亮', () => {
    const tokens = highlightLine('def foo(): # my comment', 'python');
    const defToken = tokens.find((t) => t.text === 'def');
    expect(defToken?.color).toBe('cyan');

    const commentToken = tokens.find((t) => t.text.includes('# my comment'));
    expect(commentToken?.color).toBe('gray');
    expect(commentToken?.italic).toBe(true);
  });

  it('支持 Bash / Shell 关键词与数字高亮', () => {
    const tokens = highlightLine('if [ $count -gt 42 ]; then', 'bash');
    const ifToken = tokens.find((t) => t.text === 'if');
    expect(ifToken?.color).toBe('cyan');

    const numToken = tokens.find((t) => t.text === '42');
    expect(numToken?.color).toBe('yellow');
  });

  it('支持 Diff / Patch 行色彩判定', () => {
    const addTokens = highlightLine('+const x = 1;', 'diff');
    expect(addTokens[0]?.color).toBe('green');

    const delTokens = highlightLine('-const x = 0;', 'diff');
    expect(delTokens[0]?.color).toBe('red');

    const chunkTokens = highlightLine('@@ -1,3 +1,4 @@', 'diff');
    expect(chunkTokens[0]?.color).toBe('cyan');
  });

  it('支持整段代码按行批量高亮', () => {
    const code = 'const a = 1;\nconst b = 2;';
    const lines = highlightCode(code, 'ts');
    expect(lines.length).toBe(2);
    expect(lines[0]?.some((t) => t.text === 'const')).toBe(true);
    expect(lines[1]?.some((t) => t.text === 'const')).toBe(true);
  });
});
