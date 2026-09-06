/**
 * help-skill.test.ts - /help 技能测试
 *
 * 验证 help 输出从 CommandManager 单一来源读取:
 * - topic=all / commands 时,包含 commands 段(本地命令 + skill 命令)
 * - topic=skills 时,只显示技能系统段
 * - topic=tools 时,只显示工具段
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { helpSkill } from '../help-skill.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import { initI18n } from '@locales/i18n.js';
import {
  createCommandManager,
  resetCommandManager,
  setCommandManager,
  type CommandDefinition
} from '@core/shared/command-manager.js';
import { builtinCommands } from '@core/shared/command-definitions.js';
import type { SkillArgs, SkillExecutionContext } from '../../skill-types.js';
import type { SessionMetadata } from '@core/session/session-manager.js';
import type { PermissionGate } from '@core/engine/permission-gate.js';
import type { SessionManager } from '@core/session/session-manager.js';
import type { SessionMessageRecord } from '@core/runtime/event-types.js';
import type { AgentProvider } from '@providers/provider-types.js';

function makeMockContext(): SkillExecutionContext {
  const toolRegistry = new ToolRegistry();
  const session: SessionMetadata = {
    id: 'test-session',
    path: '/tmp/test-session.jsonl',
    cwd: '/tmp',
    mode: 'standalone' as SessionMetadata['mode'],
    providerId: 'mock',
  };
  const permissionGate = {} as PermissionGate;
  const sessionManager = {} as SessionManager;
  const provider = undefined as unknown as AgentProvider;
  const history: SessionMessageRecord[] = [];
  return {
    sessionId: 'test-session',
    turn: 0,
    cwd: '/tmp',
    session,
    toolRegistry,
    permissionGate,
    sessionManager,
    provider,
    history,
    output: () => {},
  };
}

function makeArgs(named: Record<string, unknown> = {}): SkillArgs {
  return { positional: [], named, raw: '' };
}

describe('helpSkill - 命令小节（CommandManager 驱动）', () => {
  beforeAll(async () => {
    // 测试期间强制使用中文 locale,确保本地命令段的中文文案命中
    await initI18n('zh');
  });

  beforeEach(() => {
    // 每个测试用全新 CommandManager,避免 singleton 状态污染
    resetCommandManager();
    const manager = createCommandManager();
    manager.registerAll(builtinCommands);
    setCommandManager(manager);
  });

  it('topic=all 时,中文 locale 输出包含所有 commands 分类的命令', async () => {
    const result = await helpSkill.execute(
      makeArgs({ topic: 'all' }),
      makeMockContext()
    );
    expect(result.status).toBe('success');
    const output = (result as { output: string }).output;
    // 本地命令分类(注册表驱动):包含 /clear /logs
    expect(output).toContain('本地命令');
    expect(output).toContain('/clear');
    expect(output).toContain('/logs');
    // session 分类(注册表驱动):包含 /sessions
    expect(output).toContain('会话');
    expect(output).toContain('/sessions');
    // exit 分类(注册表驱动):包含 /exit /quit
    expect(output).toContain('退出');
    expect(output).toContain('/exit');
    expect(output).toContain('/quit');
    // skill 分类(注册表驱动):包含 /help /status /init /ctx
    expect(output).toContain('技能');
    expect(output).toContain('/help');
    expect(output).toContain('/status');
    expect(output).toContain('/init');
    expect(output).toContain('/ctx');
  });

  it('topic=commands 时,中文 locale 输出包含 commands 分类', async () => {
    const result = await helpSkill.execute(
      makeArgs({ topic: 'commands' }),
      makeMockContext()
    );
    expect(result.status).toBe('success');
    const output = (result as { output: string }).output;
    expect(output).toContain('可用命令');
    expect(output).toContain('本地命令');
    expect(output).toContain('/clear');
    expect(output).toContain('/sessions');
  });

  it('topic=skills 时,中文 locale 输出只包含 skills 段', async () => {
    const result = await helpSkill.execute(
      makeArgs({ topic: 'skills' }),
      makeMockContext()
    );
    expect(result.status).toBe('success');
    const output = (result as { output: string }).output;
    // topic=skills 只渲染技能系统段,不再渲染 commands 段
    expect(output).toContain('技能系统');
    expect(output).not.toContain('本地命令');
  });

  it('topic=tools 时,本地命令段不出现', async () => {
    const result = await helpSkill.execute(
      makeArgs({ topic: 'tools' }),
      makeMockContext()
    );
    expect(result.status).toBe('success');
    const output = (result as { output: string }).output;
    // topic=tools 不应包含 commands 段(本地命令 / 会话分类等)
    expect(output).not.toContain('### 本地命令');
    expect(output).not.toContain('### 会话');
  });

  it('topic=all 且无参数(默认),命令小节出现', async () => {
    const result = await helpSkill.execute(makeArgs({}), makeMockContext());
    expect(result.status).toBe('success');
    const output = (result as { output: string }).output;
    // 默认 topic 为 all,应包含 commands 段
    expect(output).toContain('本地命令');
    expect(output).toContain('/logs');
    expect(output).toContain('/exit');
  });

  it('新增 skill(测试中动态注册)→ help 自动包含', async () => {
    // 验证单一来源承诺:动态注册一个 skill 后,/help 自动包含。
    // 本测试通过给当前 CommandManager 注入一个临时 skill 实现。
    const customManager = createCommandManager();
    customManager.registerAll(builtinCommands);

    // 模拟新增一个测试 skill(直接通过 manager.register)
    const reviewCommand: CommandDefinition = {
      name: '/review',
      aliases: ['/rv'],
      category: 'skill',
      description: 'mock review skill',
      execute: async () => ({ type: 'output', output: 'Review skill' }),
    };
    customManager.register(reviewCommand);
    setCommandManager(customManager);

    const result = await helpSkill.execute(
      makeArgs({ topic: 'commands' }),
      makeMockContext()
    );
    const output = (result as { output: string }).output;
    expect(output).toContain('/review');
    expect(output).toContain('/rv'); // alias
  });

  it('新增 skill(直接注册到 CommandManager)→ help 自动包含', async () => {
    // 验证:把 skill 直接注册到 CommandManager,/help 自动包含。
    const manager = createCommandManager();
    manager.registerAll(builtinCommands);

    // 注册一个自定义 skill
    const reviewCommand: CommandDefinition = {
      name: '/review',
      aliases: ['/rv'],
      category: 'skill',
      description: 'mock review skill',
      execute: async () => ({ type: 'output', output: 'Review skill' }),
    };
    manager.register(reviewCommand);
    setCommandManager(manager);

    const result = await helpSkill.execute(
      makeArgs({ topic: 'commands' }),
      makeMockContext()
    );
    const output = (result as { output: string }).output;
    expect(output).toContain('/review');
    expect(output).toContain('/rv'); // alias
  });
});
