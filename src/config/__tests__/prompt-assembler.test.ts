import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assemblePrompt, PromptAssembler } from '../prompts/prompt-assembler.js';
import type { PromptAssemblyContext, PromptTemplate } from '../prompts/prompt-types.js';
import { ROLE_WORKER, ROLE_ORCHESTRATOR } from '../prompts/role-templates.js';
import { initI18n } from '@locales/i18n.js';

// ============================================================
// 内置角色模板：按 order 组装 + 段落标题格式化
// ============================================================

describe('PromptAssembler 内置角色模板', () => {
  const cwd = process.cwd();
  const baseContext = (): PromptAssemblyContext => ({ cwd, variables: {} });

  beforeAll(async () => {
    await initI18n('zh');
  });

  it('role-worker 按模板段落原顺序组装，includedSections 与模板一致', () => {
    const assembler = new PromptAssembler({ cwd });
    const result = assembler.assemble('role-worker', baseContext());

    const expectedIds = ROLE_WORKER.sections.map((s) => s.id);
    expect(result.includedSections).toEqual(expectedIds);
    expect(result.content).toContain('## Identity');
    expect(result.content).toContain('## Goal');
    expect(result.content).toContain('## Workflow');
    expect(result.content).toContain('## Result Reporting');
    expect(result.content).toContain('You are a Senior Software Developer.');
    expect(result.content).toContain('Write clean, efficient, and maintainable code.');
  });

  it('role-orchestrator 组装顺序遵循各段落 order', () => {
    const assembler = new PromptAssembler({ cwd });
    const result = assembler.assemble('role-orchestrator', baseContext());

    expect(result.includedSections).toEqual(['identity', 'goal', 'delegation', 'aggregation', 'error-handling', 'constraints']);
    // order 排序后的顺序与模板声明顺序一致（模板本身已按 order 排列）
    expect(result.includedSections).toEqual(ROLE_ORCHESTRATOR.sections.map((s) => s.id));
    expect(result.content).toContain('## Error Handling');
    expect(result.content).toContain('## Constraints');
  });

  it('标题格式化：连字符转空格、词首字母大写', () => {
    const assembler = new PromptAssembler({ cwd });
    const result = assembler.assemble('role-worker', baseContext());

    expect(result.content).toContain('## Result Reporting');
    expect(result.content).not.toContain('## result-reporting');
  });

  it('段落按顺序出现（order 升序）', () => {
    const assembler = new PromptAssembler({ cwd });
    const result = assembler.assemble('role-orchestrator', baseContext());

    const pos = ['identity', 'goal', 'delegation', 'aggregation', 'error-handling', 'constraints'].map(
      (id) => result.content.indexOf(`## ${id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`)
    );
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i]).toBeGreaterThan(pos[i - 1]);
    }
  });
});

// ============================================================
// 简单字符串：包装成 simple-prompt，单段落
// ============================================================

describe('PromptAssembler 简单字符串引用', () => {
  const cwd = process.cwd();
  const context = (): PromptAssemblyContext => ({ cwd, variables: {} });

  it('非内置、非文件后缀的字符串作为简单提示词', () => {
    const result = new PromptAssembler({ cwd }).assemble('Just do it', context());

    expect(result.includedSections).toEqual(['main']);
    expect(result.content).toBe('## Main\nJust do it');
  });

  it('简单提示词不因"看起来像角色名"抛错（走 simple-prompt 分支）', () => {
    const result = new PromptAssembler({ cwd }).assemble('role-nothing-here', context());

    expect(result.includedSections).toEqual(['main']);
    expect(result.content).toBe('## Main\nrole-nothing-here');
  });
});

// ============================================================
// 内联模板：order 排序、缺省 order、空段落跳过
// ============================================================

describe('PromptAssembler 内联模板', () => {
  const cwd = process.cwd();
  const context = (): PromptAssemblyContext => ({ cwd, variables: {} });

  it('按 order 升序重新排列乱序段落', () => {
    const template: PromptTemplate = {
      name: 'jumbled',
      sections: [
        { id: 'zzz', content: 'last', order: 30 },
        { id: 'aaa', content: 'first', order: 10 },
        { id: 'mmm', content: 'middle', order: 20 },
      ],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, context());

    expect(result.includedSections).toEqual(['aaa', 'mmm', 'zzz']);
    expect(result.content).toBe('## Aaa\nfirst\n\n## Mmm\nmiddle\n\n## Zzz\nlast');
  });

  it('缺省 order 时按 50 处理（排在 10/20 之后、100 之前）', () => {
    const template: PromptTemplate = {
      name: 'default-order',
      sections: [
        { id: 'after', content: 'later', order: 60 },
        { id: 'default-order', content: 'no explicit order' },
        { id: 'before', content: 'earlier', order: 40 },
      ],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, context());

    expect(result.includedSections).toEqual(['before', 'default-order', 'after']);
  });

  it('空白内容段落被跳过且不计入 includedSections', () => {
    const template: PromptTemplate = {
      name: 'blank',
      sections: [
        { id: 'keep', content: 'kept' },
        { id: 'blank', content: '   ' },
        { id: 'empty', content: '' },
      ],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, context());

    expect(result.includedSections).toEqual(['keep']);
    expect(result.content).toBe('## Keep\nkept');
  });
});

// ============================================================
// 输出格式：markdown 与 xml
// ============================================================

describe('PromptAssembler 输出格式', () => {
  const cwd = process.cwd();
  const context = (): PromptAssemblyContext => ({ cwd, variables: {} });

  it('markdown 用 ## 标题包裹', () => {
    const template: PromptTemplate = {
      name: 'fmt',
      sections: [
        { id: 'main', content: 'hello' },
        { id: 'extra', content: 'world', order: 5 },
      ],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, context(), 'markdown');

    expect(result.content).toBe('## Extra\nworld\n\n## Main\nhello');
  });

  it('xml 用 <section> 标签包裹', () => {
    const template: PromptTemplate = {
      name: 'fmt',
      sections: [
        { id: 'main', content: 'hello' },
        { id: 'extra', content: 'world', order: 5 },
      ],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, context(), 'xml');

    expect(result.content).toBe('<extra>\nworld\n</extra>\n\n<main>\nhello\n</main>');
    expect(result.includedSections).toEqual(['extra', 'main']);
  });
});

// ============================================================
// 文件加载：JSON 模板 / Markdown 文本模板 / $ref 段落
// ============================================================

describe('PromptAssembler 文件模板加载', () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'wasteland-prompt-files-'));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('从 .json 文件加载模板', async () => {
    const template: PromptTemplate = {
      name: 'file-template',
      sections: [
        { id: 'identity', content: 'from file', order: 10 },
        { id: 'goal', content: 'file goal', order: 20 },
      ],
    };
    await writeFile(join(cwd, 'tpl.json'), JSON.stringify(template), 'utf8');

    const result = new PromptAssembler({ cwd }).assemble('tpl.json', { cwd, variables: {} });

    expect(result.includedSections).toEqual(['identity', 'goal']);
    expect(result.content).toBe('## Identity\nfrom file\n\n## Goal\nfile goal');
  });

  it('从 .md 文件加载为简单模板（内容 trim）', async () => {
    await writeFile(join(cwd, 'notes.md'), '  line one\nline two\n  ', 'utf8');

    const result = new PromptAssembler({ cwd }).assemble('notes.md', { cwd, variables: {} });

    expect(result.includedSections).toEqual(['main']);
    expect(result.content).toBe('## Main\nline one\nline two');
  });

  it('从 .txt 文件加载为简单模板', async () => {
    await writeFile(join(cwd, 'plain.txt'), 'raw text content', 'utf8');

    const result = new PromptAssembler({ cwd }).assemble('plain.txt', { cwd, variables: {} });

    expect(result.content).toBe('## Main\nraw text content');
  });

  it('段落内容支持 $ref 文件引用', async () => {
    await writeFile(join(cwd, 'section-content.md'), '  referenced content  ', 'utf8');
    const template: PromptTemplate = {
      name: 'ref-template',
      sections: [
        { id: 'main', content: { $ref: 'section-content.md' } },
      ],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, { cwd, variables: {} });

    expect(result.content).toBe('## Main\nreferenced content'); // trim 后加载
  });
});

// ============================================================
// 错误处理：模板文件 / 段落文件缺失、非法引用
// ============================================================

describe('PromptAssembler 错误处理', () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'wasteland-prompt-errors-'));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('引用不存在的模板文件抛错（含文件路径）', () => {
    expect(() =>
      new PromptAssembler({ cwd }).assemble('missing-template.json', { cwd, variables: {} })
    ).toThrow(/missing-template\.json|templateFileNotFound/);
  });

  it('引用不存在的 .md 模板文件同样抛错', () => {
    expect(() =>
      new PromptAssembler({ cwd }).assemble('missing-notes.md', { cwd, variables: {} })
    ).toThrow(/missing-notes\.md|templateFileNotFound/);
  });

  it('段落 $ref 指向不存在的文件抛错', () => {
    const template: PromptTemplate = {
      name: 'bad-ref',
      sections: [{ id: 'main', content: { $ref: 'no-such-section.md' } }],
    };

    expect(() =>
      new PromptAssembler({ cwd }).assemble(template, { cwd, variables: {} })
    ).toThrow(/no-such-section\.md|sectionFileNotFound/);
  });

  it('非字符串且无 sections 字段的对象引用抛错', () => {
    expect(() =>
      new PromptAssembler({ cwd }).assemble({ name: 'not-a-template' } as unknown as PromptTemplate, {
        cwd,
        variables: {},
      })
    ).toThrow(/invalidTemplateRef|Invalid template reference|无效的模板引用/);
  });
});

// ============================================================
// 变量插值语义：实际实现不做插值，resolvedVariables 恒为空
// ============================================================

describe('PromptAssembler 变量插值语义', () => {
  const cwd = process.cwd();

  it('context.variables 不会注入到段落内容（保持原样）', () => {
    const template: PromptTemplate = {
      name: 'vars',
      sections: [{ id: 'main', content: 'Hello {{name}}, role={{roleName}}' }],
    };

    const result = new PromptAssembler({ cwd }).assemble(template, {
      cwd,
      variables: { name: 'World' },
      roleName: 'coder',
      model: 'sonnet',
      tools: ['bash'],
    });

    expect(result.content).toBe('## Main\nHello {{name}}, role={{roleName}}');
  });

  it('resolvedVariables 始终为空对象', () => {
    const result = new PromptAssembler({ cwd }).assemble('role-worker', { cwd, variables: { x: 1 } });

    expect(result.resolvedVariables).toEqual({});
  });
});

// ============================================================
// 便捷函数 assemblePrompt：只返回纯文本
// ============================================================

describe('assemblePrompt 便捷函数', () => {
  const cwd = process.cwd();

  it('返回组装后的纯文本 content', () => {
    const text = assemblePrompt('role-worker', { cwd, variables: {} });

    expect(typeof text).toBe('string');
    expect(text.startsWith('## Identity')).toBe(true);
    expect(text).toContain('You are a Senior Software Developer.');
  });

  it('支持 xml 格式', () => {
    const template: PromptTemplate = {
      name: 'inline',
      sections: [{ id: 'main', content: 'hi' }],
    };

    const text = assemblePrompt(template, { cwd, variables: {} }, 'xml');

    expect(text).toBe('<main>\nhi\n</main>');
  });

  it('等价于 new PromptAssembler().assemble().content', () => {
    const template: PromptTemplate = {
      name: 'inline',
      sections: [{ id: 'main', content: 'hi' }],
    };
    const assembler = new PromptAssembler({ cwd });

    expect(assemblePrompt(template, { cwd, variables: {} })).toBe(
      assembler.assemble(template, { cwd, variables: {} }).content
    );
  });
});
