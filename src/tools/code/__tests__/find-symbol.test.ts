/**
 * find-symbol.test.ts - 多语言符号精准定位工具单元测试
 */

import { describe, it, expect } from 'vitest';
import type { ToolExecutionContext } from '../../core/tool-types.js';
import {
  buildSymbolRegex,
  escapeRegex,
} from '../symbol-patterns.js';
import {
  createFindSymbolTool,
  formatFindSymbolOutput,
} from '../find-symbol.js';

describe('symbol-patterns 正则构建器', () => {
  it('正确转义特殊正则元字符', () => {
    expect(escapeRegex('$state')).toBe('\\$state');
    expect(escapeRegex('foo.bar')).toBe('foo\\.bar');
    expect(escapeRegex('item[0]')).toBe('item\\[0\\]');
    expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
  });

  describe('function 模式', () => {
    const regex = new RegExp(buildSymbolRegex('processData', 'function'), 'm');

    it('匹配 TypeScript / JavaScript 函数定义', () => {
      expect(regex.test('function processData() {')).toBe(true);
      expect(regex.test('export function processData(x: number) {')).toBe(true);
      expect(regex.test('export default async function processData() {')).toBe(true);
      expect(regex.test('const processData = () => {')).toBe(true);
      expect(regex.test('export const processData = async (a: string) => {')).toBe(true);
      expect(regex.test('  async processData(opts: Options) {')).toBe(true);
    });

    it('匹配 Python 函数定义', () => {
      expect(regex.test('def processData(x):')).toBe(true);
      expect(regex.test('async def processData(a, b):')).toBe(true);
    });

    it('匹配 Go 函数与接收者方法定义', () => {
      expect(regex.test('func processData() error {')).toBe(true);
      expect(regex.test('func (s *Server) processData(ctx context.Context) error {')).toBe(true);
    });

    it('匹配 Rust 函数定义', () => {
      expect(regex.test('fn processData() {')).toBe(true);
      expect(regex.test('pub fn processData() -> Result<()> {')).toBe(true);
      expect(regex.test('pub(crate) async fn processData<T>() {')).toBe(true);
    });

    it('不误判调用或普通变量', () => {
      expect(regex.test('const result = processData();')).toBe(false);
      expect(regex.test('let x = processData;')).toBe(false);
      expect(regex.test('return this.processData;')).toBe(false);
    });
  });

  describe('class 模式', () => {
    const regex = new RegExp(buildSymbolRegex('UserRegistry', 'class'), 'm');

    it('匹配 TS/JS 与 Python 类定义', () => {
      expect(regex.test('class UserRegistry {')).toBe(true);
      expect(regex.test('export class UserRegistry extends Base {')).toBe(true);
      expect(regex.test('export abstract class UserRegistry {')).toBe(true);
      expect(regex.test('class UserRegistry:')).toBe(true);
      expect(regex.test('class UserRegistry(BaseRegistry):')).toBe(true);
    });

    it('不误判非类定义', () => {
      expect(regex.test('const reg = new UserRegistry();')).toBe(false);
      expect(regex.test('function UserRegistry() {}')).toBe(false);
    });
  });

  describe('interface 模式', () => {
    const regex = new RegExp(buildSymbolRegex('PluginContext', 'interface'), 'm');

    it('匹配 TS 接口、Go 接口与 Rust Trait', () => {
      expect(regex.test('interface PluginContext {')).toBe(true);
      expect(regex.test('export interface PluginContext extends Base {')).toBe(true);
      expect(regex.test('type PluginContext interface {')).toBe(true);
      expect(regex.test('pub trait PluginContext {')).toBe(true);
    });

    it('不误判其他类型', () => {
      expect(regex.test('class PluginContext {}')).toBe(false);
      expect(regex.test('const x: PluginContext = {};')).toBe(false);
    });
  });

  describe('type 模式', () => {
    const regex = new RegExp(buildSymbolRegex('ConfigType', 'type'), 'm');

    it('匹配 TS 类型别名、Go 结构体与 Rust 结构体/枚举', () => {
      expect(regex.test('type ConfigType = { key: string };')).toBe(true);
      expect(regex.test('export type ConfigType = string | number;')).toBe(true);
      expect(regex.test('type ConfigType struct {')).toBe(true);
      expect(regex.test('pub struct ConfigType {')).toBe(true);
      expect(regex.test('pub enum ConfigType {')).toBe(true);
    });

    it('不误判函数调用', () => {
      expect(regex.test('const c: ConfigType = parse();')).toBe(false);
    });
  });

  describe('all 模式与安全边界', () => {
    it('all 模式匹配各种语言的定义形式', () => {
      const regex = new RegExp(buildSymbolRegex('SharedSymbol', 'all'), 'm');
      expect(regex.test('export function SharedSymbol() {}')).toBe(true);
      expect(regex.test('export class SharedSymbol {}')).toBe(true);
      expect(regex.test('export interface SharedSymbol {}')).toBe(true);
      expect(regex.test('export type SharedSymbol = number;')).toBe(true);
    });

    it('带特殊元字符的符号名能安全转义并匹配', () => {
      const regex = new RegExp(buildSymbolRegex('$state', 'function'), 'm');
      expect(regex.test('function $state() {}')).toBe(true);
      expect(regex.test('const $state = () => {}')).toBe(true);
    });
  });
});

describe('formatFindSymbolOutput 格式化', () => {
  it('无结果时返回友好提示与 0 统计', () => {
    const output = formatFindSymbolOutput('NonExistentSymbol', []);
    expect(output).toContain('未找到符号 "NonExistentSymbol" 的定义');
    expect(output).toContain('Found 0 symbol definition(s)');
  });

  it('有结果时输出文件名、行号、上下文及统计信息', () => {
    const output = formatFindSymbolOutput('MySymbol', [
      {
        filePath: 'src/example.ts',
        lines: [
          { lineNum: 9, isMatch: false, content: '// comment' },
          { lineNum: 10, isMatch: true, content: 'export function MySymbol() {' },
          { lineNum: 11, isMatch: false, content: '  return 1;' },
        ],
      },
    ]);

    expect(output).toContain('src/example.ts:');
    expect(output).toContain('9- // comment');
    expect(output).toContain('10: export function MySymbol() {');
    expect(output).toContain('11-   return 1;');
    expect(output).toContain('Found 1 symbol definition(s)');
  });
});

describe('find-symbol 工具集成测试', () => {
  const tool = createFindSymbolTool();
  const context: ToolExecutionContext = {
    cwd: process.cwd(),
    sessionId: 'test-find-symbol',
    turn: 1,
  };

  it('准确定位已有函数符号 createGrepTool', async () => {
    const res = await tool.execute(
      {
        name: 'createGrepTool',
        kind: 'function',
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toContain('src/tools/sys/grep.ts:');
      expect(res.output).toContain('export function createGrepTool(): AgentTool {');
      expect(res.output).toMatch(/Found \d+ symbol definition\(s\)/);
    }
  });

  it('准确定位已有函数符号 detectProjectRules', async () => {
    const res = await tool.execute(
      {
        name: 'detectProjectRules',
        kind: 'function',
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toContain('src/config/prompts/project-rules-loader.ts:');
      expect(res.output).toMatch(/Found \d+ symbol definition\(s\)/);
    }
  });

  it('准确定位组件/函数符号 AgentTreeView', async () => {
    const res = await tool.execute(
      {
        name: 'AgentTreeView',
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toContain('AgentTreeView.tsx:');
      expect(res.output).toContain('export function AgentTreeView(');
      expect(res.output).toMatch(/Found \d+ symbol definition\(s\)/);
    }
  });

  it('准确定位接口符号 AgentTool 并支持 kind 过滤', async () => {
    const res = await tool.execute(
      {
        name: 'AgentTool',
        kind: 'interface',
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toContain('src/tools/core/tool-types.ts:');
      expect(res.output).toContain('export interface AgentTool {');
    }
  });

  it('准确定位类符号 ToolRegistry 并排除不匹配的 kind', async () => {
    const classRes = await tool.execute(
      {
        name: 'ToolRegistry',
        kind: 'class',
      },
      context,
    );
    expect(classRes.status).toBe('success');
    if (classRes.status === 'success') {
      expect(classRes.output).toContain('src/tools/core/tool-registry.ts:');
      expect(classRes.output).toContain('export class ToolRegistry {');
    }

    // 当类型指定为 function 时不应匹配 class ToolRegistry
    const funcRes = await tool.execute(
      {
        name: 'ToolRegistry',
        kind: 'function',
      },
      context,
    );
    expect(funcRes.status).toBe('success');
    if (funcRes.status === 'success') {
      expect(funcRes.output).toContain('Found 0 symbol definition(s)');
    }
  });

  it('支持限定子路径 path 与文件包含过滤 include', async () => {
    // 在 sys 目录下搜索 createGrepTool
    const matchRes = await tool.execute(
      {
        name: 'createGrepTool',
        path: 'src/tools/sys',
        include: '*.ts',
      },
      context,
    );
    expect(matchRes.status).toBe('success');
    if (matchRes.status === 'success') {
      expect(matchRes.output).toContain('grep.ts:');
    }

    // 在 config 目录下搜索 createGrepTool 应无结果
    const noMatchRes = await tool.execute(
      {
        name: 'createGrepTool',
        path: 'src/config',
      },
      context,
    );
    expect(noMatchRes.status).toBe('success');
    if (noMatchRes.status === 'success') {
      expect(noMatchRes.output).toContain('Found 0 symbol definition(s)');
    }
  });

  it('不存在的符号返回友好提示并统计 0', async () => {
    const res = await tool.execute(
      {
        name: 'NonExistentSymbol_X9Y8Z7_NotFound',
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toContain('未找到符号 "NonExistentSymbol_X9Y8Z7_NotFound" 的定义');
      expect(res.output).toContain('Found 0 symbol definition(s)');
    }
  });

  it('输入非法参数时返回相应错误', async () => {
    const emptyRes = await tool.execute({ name: '' }, context);
    expect(emptyRes.status).toBe('error');

    const invalidPathRes = await tool.execute(
      { name: 'test', path: 'nonexistent/path/dir/123' },
      context,
    );
    expect(invalidPathRes.status).toBe('error');
    if (invalidPathRes.status === 'error') {
      expect(invalidPathRes.error).toContain('不存在或无法访问');
    }
  });
});
