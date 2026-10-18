import { describe, it, expect } from 'vitest';
import { splitMarkdownBlocks } from '../markdown-splitter.js';

describe('markdown-splitter', () => {
  it('正确切分普通文本与代码块', () => {
    const raw = '这是前置文本\n```typescript\nconst x = 10;\n```\n这是后续说明';
    const blocks = splitMarkdownBlocks(raw);

    expect(blocks.length).toBe(3);
    expect(blocks[0]?.type).toBe('text');
    expect(blocks[0]?.content).toBe('这是前置文本');

    expect(blocks[1]?.type).toBe('code');
    expect(blocks[1]?.codeData?.lang).toBe('typescript');
    expect(blocks[1]?.codeData?.code).toBe('const x = 10;');

    expect(blocks[2]?.type).toBe('text');
    expect(blocks[2]?.content).toBe('这是后续说明');
  });

  it('支持带有文件名元数据的代码块', () => {
    const raw = '```ts:src/main.ts\nconsole.log("hello");\n```';
    const blocks = splitMarkdownBlocks(raw);

    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe('code');
    expect(blocks[0]?.codeData?.lang).toBe('ts');
    expect(blocks[0]?.codeData?.filename).toBe('src/main.ts');
  });

  it('将 diff 代码块识别为 diff 类型', () => {
    const raw = '```diff\n-old line\n+new line\n```';
    const blocks = splitMarkdownBlocks(raw);

    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe('diff');
  });

  it('容错未闭合的代码块', () => {
    const raw = '前言\n```python\nprint(123)';
    const blocks = splitMarkdownBlocks(raw);

    expect(blocks.length).toBe(2);
    expect(blocks[0]?.type).toBe('text');
    expect(blocks[1]?.type).toBe('code');
    expect(blocks[1]?.codeData?.lang).toBe('python');
    expect(blocks[1]?.codeData?.code).toBe('print(123)');
  });
});
