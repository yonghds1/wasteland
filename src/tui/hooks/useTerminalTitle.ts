import { useEffect, useMemo } from 'react';
import { useStdout } from 'ink';
import type { AppState } from '../context/AppContext.js';
import type { TuiRuntimeContext } from '../types.js';

export function useTerminalTitle(state: AppState, runtime: TuiRuntimeContext): void {
  const { stdout } = useStdout();

  const isSubAgentRunning = useMemo(
    () => state.session.agents.some((a) => a.depth >= 1 && a.status === 'running'),
    [state.session.agents]
  );

  useEffect(() => {
    const isPendingPermission = Boolean(runtime.userInputBridge?.isPending());
    const runningTool = state.session.tools.find((t) => t.status === 'running');
    const isThinking = state.session.isThinking && !isPendingPermission;
    const isStreaming = state.session.isStreaming && !isPendingPermission;

    let statusText = 'wasteland';
    if (isPendingPermission) {
      const toolName = runningTool?.name ?? 'bash';
      statusText = `? Permission (${toolName}) · wasteland`;
    } else if (runningTool) {
      statusText = `Run ${runningTool.name} · wasteland`;
    } else if (isSubAgentRunning) {
      statusText = `SubAgent · wasteland`;
    } else if (isThinking) {
      statusText = `Thinking · wasteland`;
    } else if (isStreaming) {
      statusText = `Generating... · wasteland`;
    }

    // 事件驱动写入：仅在状态真正变更时写入 1 次，彻底告别 100ms 高频定时器对宿主机任务栏造成的剧烈抖动与闪烁
    stdout?.write(`\x1b]0;${statusText}\x07`);
  }, [
    state.session.isThinking,
    state.session.isStreaming,
    state.session.tools,
    isSubAgentRunning,
    runtime.userInputBridge,
    stdout,
  ]);
}
