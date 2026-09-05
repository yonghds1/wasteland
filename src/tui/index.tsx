/**
 * TUI 入口
 *
 * 启动 ink 应用，提供交互式 Dashboard
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { TuiRuntimeContext } from './types.js';

import { inputPipeline } from './input/input-pipeline.js';
import { ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING } from './mouse/mouse-protocol.js';

export async function runTUI(runtime: TuiRuntimeContext): Promise<void> {
  // 1. 最前置挂载输入管道拦截器
  inputPipeline.attach(process.stdin);

  // 2. 进入终端全屏备用缓冲屏（Alternate Screen Buffer）并开启 SGR 鼠标支持
  if (process.stdout.isTTY) {
    process.stdout.write(`\x1b[?1049h\x1b[H${ENABLE_MOUSE_TRACKING}`);
  }

  const restoreScreen = () => {
    if (process.stdout.isTTY) {
      try {
        process.stdout.write(`${DISABLE_MOUSE_TRACKING}\x1b[?1049l`);
      } catch {
        // ignore errors on exit
      }
    }
    inputPipeline.detach();
  };

  process.once('exit', restoreScreen);

  try {
    // ink 配置：使用原始 stdout，禁用内置 Ctrl+C 处理（由 App.tsx 处理）
    const options = {
      stdout: process.stdout,
      stdin: process.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    };

    const { waitUntilExit } = render(<App runtime={runtime} />, options);
    await waitUntilExit();
  } finally {
    process.off('exit', restoreScreen);
    restoreScreen();
  }
}
