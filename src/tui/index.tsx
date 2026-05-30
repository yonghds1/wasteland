/**
 * TUI 入口
 *
 * 启动 ink 应用，提供交互式 Dashboard
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { TuiRuntimeContext } from './types.js';

export async function runTUI(runtime: TuiRuntimeContext): Promise<void> {
  // ink 配置：使用原始 stdout，禁用内置 Ctrl+C 处理（由 App.tsx 处理）
  const options = {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: false,
    // 强制全屏模式
    patchConsole: false,
  };

  const { waitUntilExit } = render(<App runtime={runtime} />, options);

  await waitUntilExit();
}
