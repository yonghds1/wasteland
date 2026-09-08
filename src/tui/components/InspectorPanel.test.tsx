/**
 * InspectorPanel.test.tsx - 右栏检查器渲染
 *
 * 覆盖：子 agent 状态行、工具详情行、用量行；空态不占位。
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { render } from 'ink';

import { InspectorPanel } from './InspectorPanel.js';
import { AppContext, type AppState } from '../context/AppContext.js';

class FakeStdin extends Readable {
  isTTY = true;
  _read(): void {}
  setRawMode(): void {}
  ref(): void {}
  unref(): void {}
  setEncoding(_encoding: BufferEncoding): this {
    return this;
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

function makeState(): AppState {
  return {
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
      agents: [
        {
          id: 'c1', name: 'researcher', roleName: ' researcher', depth: 1,
          status: 'running', startTime: Date.now(), currentAction: 'grep中', stepCount: 3,
        },
        {
          id: 'c2', name: 'tester', depth: 1,
          status: 'failed', startTime: Date.now() - 5000, endTime: Date.now(),
        },
      ],
      messages: [],
      tools: [
        { id: 't1', name: 'bash', status: 'success', duration: 1200 },
        { id: 't2', name: 'grep', status: 'running' },
      ],
      isThinking: false,
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      permission: { pending: null, queue: [], history: [] },
      usage: { promptTokens: 8000, completionTokens: 4400, totalTokens: 12400, cachedTokens: 0 },
      context: { isCompacting: false },
    },
    debug: { traces: [], filter: {} },
    config: {
      provider: 'test',
      model: 'qwen3-max',
      mode: 'multi',
      permissionMode: 'default',
      maxSteps: 10,
      defaultRole: 'coder',
      childAgentTimeout: 60000,
      debug: false,
    },
    fullConfig: {
      providers: {},
      models: { default: { provider: 'test', model: 'qwen3-max', contextWindow: 128000 } },
      multiAgent: {},
      sources: {},
      defaultProvider: 'test',
    },
    configEdit: { field: null, originalValue: '' },
    configHasChanges: false,
    sessionMetadata: { id: 'test-session', providerId: 'test' },
  };
}

async function renderPanel(state: AppState): Promise<string> {
  const contextValue = {
    state,
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
      <InspectorPanel width={36} height={20} />
    </AppContext.Provider>,
    { stdin: stdin as never, stdout: stdout as never, patchConsole: false }
  );
  try {
    await settle();
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
  }
  return stdout.output;
}

describe('InspectorPanel', () => {
  it('渲染子 agent 状态行（运行中动作 + 失败项）', async () => {
    const output = await renderPanel(makeState());
    expect(output).toContain('researcher');
    expect(output).toContain('grep');
    expect(output).toContain('tester');
  });

  it('工具详情跟随最新 running', async () => {
    const output = await renderPanel(makeState());
    expect(output).toContain('grep');
    expect(output).toContain('running');
  });

  it('用量行显示 token 与工具计数', async () => {
    const output = await renderPanel(makeState());
    expect(output).toContain('12.4k');
    expect(output).toContain('1✓');
  });

  it('遥测区含 mode 与快捷键（原底栏搬入）', async () => {
    const output = await renderPanel(makeState());
    expect(output).toContain('multi');
  });

  it('空态：无 agent/工具时只剩用量行，不崩', async () => {
    const state = makeState();
    state.session.agents = [];
    state.session.tools = [];
    const output = await renderPanel(state);
    expect(output).toContain('128k');
    expect(output).not.toContain('researcher');
  });
});
