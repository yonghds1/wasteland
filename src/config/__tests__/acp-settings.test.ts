/**
 * acp-settings.test.ts - ACP 配置面单测（校验 + 迁移提示 + 合并）
 */

import { describe, it, expect } from 'vitest';
import { validateACPSettings } from '../validate-settings.js';
import { buildA2AMigrationNotice } from '../load-settings.js';
import { mergeSettings } from '../settings-merge.js';
import { DEFAULT_WASTELAND_SETTINGS } from '../settings-types.js';

describe('validateACPSettings', () => {
  it('最小合法配置：name + command', () => {
    const out = validateACPSettings({ agents: [{ name: 'claude_code', command: 'npx' }] }, 'x.json');
    expect(out.agents).toEqual([{ name: 'claude_code', command: 'npx' }]);
  });

  it('全字段透传：args/env/cwd/description/timeoutMs', () => {
    const out = validateACPSettings(
      {
        agents: [
          {
            name: 'codex',
            command: 'npx',
            args: ['-y', '@zed-industries/codex-acp'],
            env: { FOO: 'bar' },
            cwd: '/repo',
            description: 'desc',
            timeoutMs: 60000,
          },
        ],
        defaults: { timeoutMs: 120000 },
      },
      'x.json'
    );
    expect(out.agents[0]).toEqual({
      name: 'codex',
      command: 'npx',
      args: ['-y', '@zed-industries/codex-acp'],
      env: { FOO: 'bar' },
      cwd: '/repo',
      description: 'desc',
      timeoutMs: 60000,
    });
    expect(out.defaults).toEqual({ timeoutMs: 120000 });
  });

  it('拒绝：非法 name 字符集 / 重名 / 空 command / 非数组 args / 坏 timeoutMs', () => {
    const src = 'x.json';
    expect(() => validateACPSettings({ agents: [{ name: 'bad name!', command: 'c' }] }, src)).toThrow(/name/);
    expect(() =>
      validateACPSettings(
        { agents: [{ name: 'dup', command: 'c' }, { name: 'dup', command: 'c' }] },
        src
      )
    ).toThrow(/重名/);
    expect(() => validateACPSettings({ agents: [{ name: 'a', command: '  ' }] }, src)).toThrow(/command/);
    expect(() =>
      validateACPSettings({ agents: [{ name: 'a', command: 'c', args: [1] }] }, src)
    ).toThrow(/args/);
    expect(() =>
      validateACPSettings({ agents: [{ name: 'a', command: 'c', timeoutMs: 0 }] }, src)
    ).toThrow(/timeoutMs/);
    expect(() => validateACPSettings('not-object', src)).toThrow(/acp 必须是对象/);
  });

  it('env 支持 $auth 引用对象（同 mcpServers 语义）', () => {
    const out = validateACPSettings(
      { agents: [{ name: 'a', command: 'c', env: { KEY: { $auth: 'MY_KEY' } } }] },
      'x.json'
    );
    expect(out.agents[0].env).toEqual({ KEY: { $auth: 'MY_KEY' } } as never);
  });
});

describe('buildA2AMigrationNotice', () => {
  const legacy = { a2a: { agents: [{ name: 'claude_code', url: 'http://localhost:9041' }], servers: {} } };

  it('有 a2a 块（用户级或项目级）→ 提示文本含可粘贴 acp 示例', () => {
    const notice = buildA2AMigrationNotice(legacy as never, null);
    expect(notice).toContain('a2a');
    expect(notice).toContain('acp.agents');
    expect(notice).toContain('@agentclientprotocol/claude-agent-acp');
    expect(buildA2AMigrationNotice(null, legacy as never)).toContain('警告');
  });

  it('无 a2a 块 → null（不打扰）', () => {
    expect(buildA2AMigrationNotice(null, null)).toBeNull();
    expect(buildA2AMigrationNotice({}, {})).toBeNull();
  });
});

describe('mergeSettings acp 块', () => {
  it('agents 按 name 去重覆盖，defaults 字段级合并', () => {
    const base = mergeSettings(DEFAULT_WASTELAND_SETTINGS, {
      acp: { agents: [{ name: 'a', command: 'x' }], defaults: { timeoutMs: 100 } },
    });
    const merged = mergeSettings(base, {
      acp: { agents: [{ name: 'a', command: 'y' }, { name: 'b', command: 'z' }] },
    });
    expect(merged.acp.agents).toEqual([
      { name: 'a', command: 'y' },
      { name: 'b', command: 'z' },
    ]);
    // defaults 未被 next 覆盖掉（next 未提供 defaults 时保留 base）
    expect(merged.acp.defaults).toEqual({ timeoutMs: 100 });
  });
});
