import { describe, it, expect } from 'vitest';
import { renderCodeBlockLines, renderDiffLines } from '../render-code-diff-lines.js';

describe('renderCodeBlockLines', () => {
  it('正确逐行展平代码块，包含顶部标题、行号代码与底部边框', () => {
    const code = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);';
    const lines = renderCodeBlockLines(code, 'typescript', 'test.ts', 80, 'pfx-1', true);

    // 1 行头 + 3 行代码 + 1 行尾 = 5 行
    expect(lines.length).toBe(5);
    expect(lines[0]?.key).toBe('pfx-1-cbt');
    expect(lines[1]?.key).toBe('pfx-1-cb-0');
    expect(lines[2]?.key).toBe('pfx-1-cb-1');
    expect(lines[3]?.key).toBe('pfx-1-cb-2');
    expect(lines[4]?.key).toBe('pfx-1-cbb');
  });

  it('单行代码时能正确输出 3 行虚拟行', () => {
    const code = 'echo hello';
    const lines = renderCodeBlockLines(code, 'bash', undefined, 60, 'pfx-2', false);
    expect(lines.length).toBe(3);
  });
});

describe('renderDiffLines', () => {
  it('正确逐行展平 Unified Diff 块并统计加减行数', () => {
    const diff = '--- a.ts\n+++ b.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line';
    const lines = renderDiffLines(diff, 'app.ts', 80, 'pfx-diff');

    // 1 行头 + 5 行 diff + 1 行尾 = 7 行
    expect(lines.length).toBe(7);
    expect(lines[0]?.key).toBe('pfx-diff-dft');
    expect(lines[lines.length - 1]?.key).toBe('pfx-diff-dfb');
  });
});
