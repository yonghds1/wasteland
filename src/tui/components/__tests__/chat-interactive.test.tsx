import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';
import { ChatInputBar } from '../ChatInputBar.js';
import { AppContext, type AppState } from '../../context/AppContext.js';

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

function setupInteractiveBar() {
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
    permission: { pending: null, queue: [], history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending: null, queue: [], history: [] },
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

  const contextValue = {
    state: baseState,
    setState: vi.fn(),
    setCurrentPage: vi.fn(),
    setFocusArea: vi.fn(),
    setInputMode: vi.fn(),
    setExitConfirmPending: vi.fn(),
    setShowHelp: vi.fn(),
    setFilterMode: vi.fn(),
    setEditMode: vi.fn(),
    updateConfig: vi.fn(),
    clearTraces: vi.fn(),
    setLogPageFilter: vi.fn(),
    setViewFilter: vi.fn(),
  };

  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const instance = render(
    <AppContext.Provider value={contextValue}>
      <ChatInputBar width={80} sendMessage={sendMessage} />
    </AppContext.Provider>,
    { stdin: stdin as never, stdout: stdout as never, patchConsole: false }
  );

  return { instance, stdin, stdout, sendMessage };
}

describe('TUI 交互与操作测试 (Interactive Testing)', () => {
  it('输入普通文本并按 Enter 发送', async () => {
    const { instance, stdin, sendMessage } = setupInteractiveBar();
    try {
      await settle();
      for (const ch of 'hello') {
        stdin.writeData(ch);
        await settle(20);
      }
      stdin.writeData('\r');
      await settle();
      expect(sendMessage).toHaveBeenCalledWith('hello');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('输入 @ 触发文件补全面板并渲染指示', async () => {
    const { instance, stdin, stdout } = setupInteractiveBar();
    try {
      await settle();
      stdin.writeData('@');
      await settle();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    expect(stdout.output).toContain('@');
  });

  it('输入 / 唤起斜杠命令补全面板', async () => {
    const { instance, stdin, stdout } = setupInteractiveBar();
    try {
      await settle();
      stdin.writeData('/');
      await settle();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    expect(stdout.output).toContain('/');
  });
});
