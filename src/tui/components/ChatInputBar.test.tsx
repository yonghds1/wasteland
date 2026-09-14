/**
 * ChatInputBar 权限确认分支测试
 *
 * 覆盖 once/always/no 三键行为，重点回归：选项 2（always）只注册
 * session 级内存规则，不再发送 `/perm bypass` 全局提权。
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';

import { ChatInputBar } from './ChatInputBar.js';
import { AppContext, type AppState } from '../context/AppContext.js';
import type { TuiRuntimeContext } from '../types.js';

class FakeStdin extends Readable {
  isTTY = true;
  _read(): void {}
  setRawMode(): void {}
  ref(): void {}
  unref(): void {}
  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }
  writeData(s: string): void {
    this.push(s);
  }
}

class FakeStdout extends Writable {
  output = '';
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.output += chunk.toString();
    cb();
  }
}

function settle(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makePending(toolName: string, input?: Record<string, unknown>) {
  return {
    callId: 'c1',
    toolName,
    question: `是否允许执行 ${toolName}?`,
    status: 'pending' as const,
    timestamp: '',
    ...(input ? { input } : {}),
  };
}

function renderBar(
  pending: ReturnType<typeof makePending> | null,
  opts: { queue?: ReturnType<typeof makePending>[]; isPending?: boolean } = {}
) {
  const provideInput = vi.fn();
  const bridge = { isPending: () => opts.isPending ?? true, provideInput };
  const gate = { addSessionRule: vi.fn() };
  const sendMessage = vi.fn();
  const queue = opts.queue ?? [];

  const baseState: AppState = {
    currentPage: 'session',
    focusArea: 'inputBar',
    inputMode: true,
    exitConfirmPending: false,
    showHelp: null,
    filterMode: false,
    editMode: false,
    permissionSelection: 0,
    permission: { pending, queue, history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending, queue, history: [] },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
      context: { isCompacting: false },
    },
    debug: { traces: [], filter: {} },
    config: {
      provider: 'test',
      model: 'test',
      permissionMode: 'default',
      maxSteps: 10,
      defaultRole: 'coder',
      childAgentTimeout: 60000,
      debug: false,
    },
    fullConfig: { providers: {}, models: {}, multiAgent: {}, sources: {}, defaultProvider: 'test' },
    configEdit: { field: null, originalValue: '' },
    configHasChanges: false,
    sessionMetadata: { id: 'test-session', providerId: 'test' },
  };

  const runtime = {
    userInputBridge: bridge,
    permissionGate: gate,
  } as unknown as TuiRuntimeContext;

  const contextValue = {
    state: baseState,
    setState: (): void => {},
    setCurrentPage: (): void => {},
    setFocusArea: (): void => {},
    setInputMode: (): void => {},
    setExitConfirmPending: (): void => {},
    setShowHelp: (): void => {},
    setFilterMode: (): void => {},
    setEditMode: (): void => {},
    updateConfig: (): void => {},
    clearTraces: (): void => {},
    setLogPageFilter: (): void => {},
    setViewFilter: (): void => {},
  };

  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const instance = render(
    <AppContext.Provider value={contextValue}>
      <ChatInputBar width={80} sendMessage={sendMessage} runtime={runtime} />
    </AppContext.Provider>,
    { stdin: stdin as never, stdout: stdout as never, patchConsole: false }
  );
  return { instance, stdin, stdout, provideInput, gate, sendMessage };
}

describe('ChatInputBar 权限确认', () => {
  it("按 2（always）：注册 session 规则 + 回答 'always'，不发 /perm bypass", async () => {
    const pending = makePending('bash', { command: 'git status' });
    const { instance, stdin, provideInput, gate, sendMessage } = renderBar(pending);
    try {
      await settle();
      stdin.writeData('2');
      await settle();
      expect(gate.addSessionRule).toHaveBeenCalledWith({
        toolName: 'bash',
        decision: 'allow',
        inputPrefix: { key: 'command', prefix: 'git status' },
        reason: 'ask-user always: bash git status*',
      });
      expect(provideInput).toHaveBeenCalledWith('always');
      expect(sendMessage).not.toHaveBeenCalledWith('/perm bypass');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('无可记模式时按 2：不注册规则，但降级为本次允许（不静默吞键）', async () => {
    // 回归 09-14-subagent-permission-hang：曾经这里直接 return，
    // 按键被吞掉且不 resolve 等待者 —— 用户没有任何反馈，
    // 若不再按其他键，该请求会一直挂到 agent/子 agent 超时。
    // 现在与 CLI 侧一致：降级为「本次允许」。
    const pending = makePending('spawn_agent', { task: 'do things' });
    const { instance, stdin, provideInput, gate } = renderBar(pending);
    try {
      await settle();
      stdin.writeData('2');
      await settle();
      expect(gate.addSessionRule).not.toHaveBeenCalled();
      expect(provideInput).toHaveBeenCalledWith('yes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it("按 1：回答 'yes'，不碰 gate", async () => {
    const pending = makePending('bash', { command: 'rm -rf /' });
    const { instance, stdin, provideInput, gate, sendMessage } = renderBar(pending);
    try {
      await settle();
      stdin.writeData('1');
      await settle();
      expect(provideInput).toHaveBeenCalledWith('yes');
      expect(gate.addSessionRule).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalledWith('/perm bypass');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('ChatInputBar 框内权限渲染', () => {
  async function renderAndCollect(
    pending: ReturnType<typeof makePending> | null,
    keys: string[] = [],
    opts: { queue?: ReturnType<typeof makePending>[]; isPending?: boolean } = {}
  ): Promise<string> {
    const { instance, stdin, stdout } = renderBar(pending, opts);
    try {
      await settle();
      for (const key of keys) {
        stdin.writeData(key);
        await settle();
      }
      await settle();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    return stdout.output;
  }

  it('pending 时框内显示标题/命令/三选项与规则', async () => {
    const pending = { ...makePending('bash', { command: 'git status' }), command: 'git status' };
    const output = await renderAndCollect(pending);
    // 注：本文件未 initI18n，t() 回退 key；断言 key 即断言渲染分支走到
    expect(output).toContain('hints.permissionTitle');
    expect(output).toContain('git status');
    expect(output).toContain('hints.always');
    expect(output).not.toMatch(/hints\.alwaysDisabled/);
    expect(output).toContain('hints.yes');
    expect(output).toContain('hints.no');
  });

  it('无可记模式时选项 2 置灰提示', async () => {
    const pending = makePending('spawn_agent', { task: 'x' });
    const output = await renderAndCollect(pending);
    expect(output).toContain('hints.alwaysDisabled');
    // 'hints.always' 是 'hints.alwaysDisabled' 的子串，用词边界精确断言启用态未出现
    expect(output).not.toMatch(/hints\.always(?!Disabled)/);
  });

  it('非 pending 时显示输入占位、无权限标题', async () => {
    // 显式 isPending:false —— bridge 无等待者、无卡片，才是真正的「无权限交互」态
    const output = await renderAndCollect(null, [], { isPending: false });
    expect(output).not.toContain('hints.permissionTitle');
    expect(output).not.toContain('hints.permissionUnknownTitle');
    expect(output).not.toContain('hints.yes');
  });

  it('队列非空时显示「还有 N 个确认排队等待回答」', async () => {
    // 09-14-subagent-permission-hang：并行子 agent 同批提问时，卡片 FIFO 逐个上位，
    // 此前用户无从知道还排着几个确认。
    const pending = makePending('bash', { command: 'git status' });
    const output = await renderAndCollect(pending, [], {
      queue: [makePending('web-fetch'), makePending('bash')],
    });
    expect(output).toContain('hints.permissionQueued');
  });

  it('队列为空时不显示排队提示', async () => {
    const pending = makePending('bash', { command: 'git status' });
    const output = await renderAndCollect(pending, [], { queue: [] });
    expect(output).not.toContain('hints.permissionQueued');
  });

  it('bridge 等待中但卡片缺失时显示兜底提示（不再静默吞输入）', async () => {
    // isPendingPermission 取自 bridge，卡片取自 state.permission.pending；两者背离时
    // 旧实现会走到普通输入区渲染 —— 输入被当权限回答吞掉，界面却毫无提示（静默死锁）。
    const output = await renderAndCollect(null, [], { isPending: true });
    expect(output).toContain('hints.permissionUnknownTitle');
    // 兜底状态仍给出可用按键
    expect(output).toContain('hints.yes');
    expect(output).toContain('hints.no');
  });
});
