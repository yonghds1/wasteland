/**
 * TUI 入口
 *
 * 启动 ink 应用，提供交互式 Dashboard
 */

import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import type { TuiRuntimeContext } from "./types.js";

export async function runTUI(runtime: TuiRuntimeContext): Promise<void> {
  const { waitUntilExit } = render(<App runtime={runtime} />);

  await waitUntilExit();
}
