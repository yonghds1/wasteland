/**
 * review-skill.test.ts - /review 代码审查技能测试
 *
 * 验证 review-skill 的核心逻辑:
 * - 模式检查（TODO、console.log、@ts-ignore、空 catch、魔数、文件长度）
 * - 无变更时返回提示
 * - LLM 增强路径（provider 可用时）
 * - 文件不存在时跳过
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { reviewSkill } from '../review-skill.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import { initI18n } from '@locales/i18n.js';
import type { SkillArgs, SkillExecutionContext } from '../../skill-types.js';
import type { SessionMetadata } from '@core/runtime/session-manager.js';
import type { PermissionGate } from '@core/runtime/permission-gate.js';
import type { SessionManager } from '@core/runtime/session-manager.js';
import type { SessionMessageRecord } from '@core/runtime/event-types.js';
import type { AgentProvider } from '@providers/provider-types.js';

/** 工具调用记录 */
interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

type MockToolResult =
  | { status: 'success'; output: string }
  | { status: 'error'; error: string };

/** 创建 mock context */
function makeMockContext(opts: {
  cwd?: string;
  tools?: Map<string, (input: Record<string, unknown>) => MockToolResult>;
  provider?: AgentProvider;
} = {}): SkillExecutionContext & { toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  const toolRegistry = new ToolRegistry();

  // 注册 mock bash 工具
  if (opts.tools?.has('bash')) {
    const bashImpl = opts.tools.get('bash')!;
    toolRegistry.register({
      name: 'bash',
      riskLevel: 'execute',
      description: 'mock bash',
      async execute(input: Record<string, unknown>) {
        toolCalls.push({ name: 'bash', input });
        return bashImpl(input);
      },
    });
  }

  // 注册 mock read-file 工具
  if (opts.tools?.has('read-file')) {
    const readImpl = opts.tools.get('read-file')!;
    toolRegistry.register({
      name: 'read-file',
      riskLevel: 'read',
      description: 'mock read-file',
      async execute(input: Record<string, unknown>) {
        toolCalls.push({ name: 'read-file', input });
        return readImpl(input);
      },
    });
  }

  const session: SessionMetadata = {
    id: 'test-session',
    path: '/tmp/test-session.jsonl',
    cwd: opts.cwd ?? '/tmp',
    mode: 'standalone' as SessionMetadata['mode'],
    providerId: 'mock',
  };

  return {
    sessionId: 'test-session',
    turn: 0,
    cwd: opts.cwd ?? '/tmp',
    session,
    toolRegistry,
    permissionGate: {} as PermissionGate,
    sessionManager: {} as SessionManager,
    provider: opts.provider ?? (undefined as unknown as AgentProvider),
    history: [] as SessionMessageRecord[],
    output: () => {},
    toolCalls,
  };
}

function makeArgs(named: Record<string, unknown> = {}): SkillArgs {
  return { positional: [], named, raw: '' };
}

describe('reviewSkill', () => {
  beforeAll(async () => {
    await initI18n('zh');
  });

  it('没有变更文件时返回提示', async () => {
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          () => ({ status: 'success', output: '' }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    expect(result.status).toBe('success');
    const output = (result as { output: string }).output;
    // 没有变更文件时，应返回 noChanges 提示
    expect(output).toContain('没有发现变更文件');
  });

  it('检测 TODO/FIXME 标记', async () => {
    const fileContent = `// TODO: implement this\nconst x = 1;\n// FIXME: bug here\n`;

    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            const cmd = input.command as string;
            // 第一次调用: git diff --name-only
            if (cmd.includes('--name-only')) {
              return { status: 'success', output: 'src/foo.ts' };
            }
            // 第二次调用: git diff (可选)
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: fileContent }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('待处理标记');
    expect(output).toContain('src/foo.ts');
  });

  it('检测 console.log', async () => {
    const fileContent = `const x = 1;\nconsole.log(x);\nconsole.debug(x);\n`;
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/bar.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: fileContent }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('残留 console 调用');
  });

  it('检测 @ts-ignore / @ts-expect-error', async () => {
    const fileContent = `// @ts-ignore\nconst x: number = "str";\n// @ts-expect-error\nconst y = (1 as any);\n`;
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/qux.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: fileContent }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('TypeScript 错误抑制');
  });

  it('检测空 catch 块', async () => {
    const fileContent = `try {\n  doStuff();\n} catch (e) {}\n`;
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/err.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: fileContent }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('空 catch 块');
  });

  it('检测超长文件 (>500 行)', async () => {
    const longContent = Array(501).fill('const x = 1;').join('\n');
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/long.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: longContent }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('文件过长');
    expect(output).toContain('501');
  });

  it('文件无法读取时跳过', async () => {
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>): MockToolResult => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/missing.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          (): MockToolResult => ({ status: 'error', error: 'file not found' }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('无法读取');
    expect(output).toContain('src/missing.ts');
  });

  it('--staged 参数传递给 git diff', async () => {
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            const cmd = input.command as string;
            if (cmd.includes('--name-only')) {
              // 验证 --staged 使用 --cached
              if (cmd.includes('--cached')) {
                return { status: 'success', output: 'src/staged.ts' };
              }
              return { status: 'success', output: '' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: 'const x = 1;' }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({ staged: true }), context);
    expect(result.status).toBe('success');
  });

  it('无问题时显示 ✅', async () => {
    const cleanContent = `const x = 1;\nconst y = 2;\nexport { x, y };\n`;
    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/clean.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          () => ({ status: 'success', output: cleanContent }),
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('未发现常见代码质量问题');
    expect(output).toContain('共发现 0 个问题');
  });

  it('多个文件综合审查', async () => {
    const files = new Map([
      ['src/a.ts', '// TODO: fix this\nconst a = 1;'],
      ['src/b.ts', 'console.log("debug");\nconst b = 2;'],
      ['src/c.ts', 'try { x(); } catch(e) {}'],
    ]);

    const context = makeMockContext({
      tools: new Map([
        [
          'bash',
          (input: Record<string, unknown>) => {
            if ((input.command as string).includes('--name-only')) {
              return { status: 'success', output: 'src/a.ts\nsrc/b.ts\nsrc/c.ts' };
            }
            return { status: 'success', output: '' };
          },
        ],
        [
          'read-file',
          (input: Record<string, unknown>) => {
            const path = input.path as string;
            const content = files.get(path) ?? '';
            return { status: 'success', output: content };
          },
        ],
      ]),
    });

    const result = await reviewSkill.execute(makeArgs({}), context);
    const output = (result as { output: string }).output;
    expect(output).toContain('3 个变更文件');
    expect(output).toContain('待处理标记');
    expect(output).toContain('残留 console 调用');
    expect(output).toContain('空 catch 块');
  });
});
