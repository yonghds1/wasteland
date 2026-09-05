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

function renderBar(pending: ReturnType<typeof makePending> | null) {
  const provideInput = vi.fn();
  const bridge = { isPending: () => true, provideInput };
  const gate = { addSessionRule: vi.fn() };
  const sendMessage = vi.fn();

  const baseState: AppState = {
    currentPage: 'session',
    focusArea: 'inputBar',
    inputMode: true,
    exitConfirmPending: false,
    showHelp: null,
    filterMode: false,
    editMode: false,
    permissionSelection: 0,
    permission: { pending, history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending, history: [] },
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
  return { instance, stdin, provideInput, gate, sendMessage };
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

  it('无可记模式时按 2：不注册不回答（忽略）', async () => {
    const pending = makePending('spawn_agent', { task: 'do things' });
    const { instance, stdin, provideInput, gate } = renderBar(pending);
    try {
      await settle();
      stdin.writeData('2');
      await settle();
      expect(gate.addSessionRule).not.toHaveBeenCalled();
      expect(provideInput).not.toHaveBeenCalled();
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
