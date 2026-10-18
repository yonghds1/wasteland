import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';
import { useGlobalKeymapDispatcher } from '../useGlobalKeymapDispatcher.js';
import type { AppState } from '../../context/AppContext.js';
import type { TuiRuntimeContext } from '../../types.js';

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
    command: (input?.command as string) ?? undefined,
    ...(input ? { input } : {}),
  };
}

function createMockAppState(pending: ReturnType<typeof makePending>): AppState {
  return {
    currentPage: 'session',
    focusArea: 'agentTabs',
    inputMode: false,
    exitConfirmPending: false,
    showHelp: null,
    filterMode: false,
    editMode: false,
    permissionSelection: 0,
    permission: { pending, queue: [], history: [] },
    logPageFilter: {},
    session: {
      agents: [],
      messages: [],
      tools: [],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending, queue: [], history: [] },
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
}

describe('useGlobalKeymapDispatcher 权限单键最高优先级拦截与死锁根除', () => {
  it('当 focusArea 为 agentTabs 且处于非输入模式时，按 1 仍能秒级响应允许（根除焦点死锁）', async () => {
    const provideInput = vi.fn();
    const bridge = { isPending: () => true, provideInput };
    const gate = { addSessionRule: vi.fn() };
    const runtime = { userInputBridge: bridge, permissionGate: gate } as unknown as TuiRuntimeContext;

    const pending = makePending('bash', { command: 'npm test' });

    const DispatcherHost = () => {
      const [state, setState] = useState<AppState>(createMockAppState(pending));

      useGlobalKeymapDispatcher({
        state,
        setState,
        runtime,
        cyclePermissionMode: vi.fn(),
        setCurrentPage: vi.fn(),
        setFocusArea: vi.fn(),
        setInputMode: vi.fn(),
        setExitConfirmPending: vi.fn(),
        setShowHelp: vi.fn(),
      });

      return null;
    };

    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const instance = render(<DispatcherHost />, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    try {
      await settle();
      stdin.writeData('1');
      await settle();
      expect(provideInput).toHaveBeenCalledWith('yes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('当 focusArea 为 agentTabs 时，按 2 记住本会话并注册规则', async () => {
    const provideInput = vi.fn();
    const bridge = { isPending: () => true, provideInput };
    const gate = { addSessionRule: vi.fn() };
    const runtime = { userInputBridge: bridge, permissionGate: gate } as unknown as TuiRuntimeContext;

    const pending = makePending('bash', { command: 'git pull' });

    const DispatcherHost = () => {
      const [state, setState] = useState<AppState>(createMockAppState(pending));

      useGlobalKeymapDispatcher({
        state,
        setState,
        runtime,
        cyclePermissionMode: vi.fn(),
        setCurrentPage: vi.fn(),
        setFocusArea: vi.fn(),
        setInputMode: vi.fn(),
        setExitConfirmPending: vi.fn(),
        setShowHelp: vi.fn(),
      });

      return null;
    };

    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const instance = render(<DispatcherHost />, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    try {
      await settle();
      stdin.writeData('2');
      await settle();
      expect(gate.addSessionRule).toHaveBeenCalledWith({
        toolName: 'bash',
        decision: 'allow',
        inputPrefix: { key: 'command', prefix: 'git pull' },
        reason: 'ask-user always: bash git pull*',
      });
      expect(provideInput).toHaveBeenCalledWith('always');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('按 Esc 拒绝权限请求', async () => {
    const provideInput = vi.fn();
    const bridge = { isPending: () => true, provideInput };
    const gate = { addSessionRule: vi.fn() };
    const runtime = { userInputBridge: bridge, permissionGate: gate } as unknown as TuiRuntimeContext;

    const pending = makePending('bash', { command: 'rm -rf /' });

    const DispatcherHost = () => {
      const [state, setState] = useState<AppState>(createMockAppState(pending));

      useGlobalKeymapDispatcher({
        state,
        setState,
        runtime,
        cyclePermissionMode: vi.fn(),
        setCurrentPage: vi.fn(),
        setFocusArea: vi.fn(),
        setInputMode: vi.fn(),
        setExitConfirmPending: vi.fn(),
        setShowHelp: vi.fn(),
      });

      return null;
    };

    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const instance = render(<DispatcherHost />, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    try {
      await settle();
      stdin.writeData('\x1b'); // Esc
      await settle();
      expect(provideInput).toHaveBeenCalledWith('no');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
