/**
 * TUI 入口
 *
 * 启动 ink 应用，提供交互式 Dashboard
 */

import React from "react";
import { render } from "ink";
import { App } from "./App.js";

export async function runTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />);

  await waitUntilExit();
}
