import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'ink';
import { CodeBlockView } from '../CodeBlockView.js';
import { UnifiedDiffView } from '../UnifiedDiffView.js';
import { StreamingTerminalBox } from '../StreamingTerminalBox.js';

describe('Render Components', () => {
  it('CodeBlockView 渲染带行号和边框的代码块', () => {
    const output = renderToString(
      <CodeBlockView
        code="const x = 42;"
        lang="ts"
        filename="test.ts"
        width={40}
        showLineNumbers={true}
      />
    );
    expect(output).toContain('[ts] test.ts');
    expect(output).toContain('1 │');
    expect(output).toContain('const');
  });

  it('UnifiedDiffView 渲染统计和红绿差异', () => {
    const diff = '--- a.ts\n+++ b.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;';
    const output = renderToString(<UnifiedDiffView diffText={diff} filename="a.ts" width={50} />);
    expect(output).toContain('+1 / -1 lines');
    expect(output).toContain('-const a = 1;');
    expect(output).toContain('+const a = 2;');
  });

  it('StreamingTerminalBox 渲染紧凑完成徽章和运行中终端盒', () => {
    // 完成态
    const doneOutput = renderToString(
      <StreamingTerminalBox
        command="git status"
        status="success"
        durationMs={45}
        width={40}
        expanded={false}
      />
    );
    expect(doneOutput).toContain('✓ $ git status · 45ms');

    // 运行态
    const runOutput = renderToString(
      <StreamingTerminalBox
        command="npm test"
        status="running"
        tailLines={['line 1', 'line 2']}
        width={40}
        expanded={false}
      />
    );
    expect(runOutput).toContain('⟳ $ npm test');
    expect(runOutput).toContain('line 1');
    expect(runOutput).toContain('line 2');
  });
});
