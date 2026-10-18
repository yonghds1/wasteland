/**
 * useCheckpointCommands.ts - Checkpoint 命令分发与状态管理
 *
 * 处理 /undo, /redo, /diff, /checkpoints 命令，与 Git Checkpoint 引擎交互
 */

import { getCheckpointManager } from '@core/checkpoint/index.js';
import { createUndoRecord } from '@core/session/session-records.js';
import type { AppState, Message } from '../context/AppContext.js';
import type { TuiRuntimeContext } from '../types.js';

export interface UseCheckpointCommandsProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  runtime: TuiRuntimeContext;
  peekTurn?: () => number;
  setDraft?: (draft: string) => void;
}

export interface UseCheckpointCommandsReturn {
  handleCheckpointCommand: (content: string) => Promise<boolean>;
}

function pushSystemMessage(
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  content: string,
  prefix = 'checkpoint'
): void {
  setState((prev) => ({
    ...prev,
    session: {
      ...prev.session,
      messages: [
        ...prev.session.messages,
        {
          id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString(),
          agentId: 'system',
          type: 'system' as const,
          content,
        },
      ],
    },
  }));
}

export function pruneMessagesForUndo(messages: readonly Message[], targetTurn: number): Message[] {
  let currentTurn = 0;
  return messages.filter((m) => {
    const match = m.id.match(/^msg-(?:user|assistant|streaming|success)-(\d+)-/);
    if (match && match[1]) {
      currentTurn = parseInt(match[1], 10);
    }
    const turn = (m as { turn?: number }).turn ?? currentTurn;
    // 去除 turn >= targetTurn 的助手与工具消息
    if (
      turn >= targetTurn &&
      (m.type === 'assistant' ||
        m.type === 'tool' ||
        m.id.startsWith('msg-streaming-') ||
        m.id.startsWith('msg-success-') ||
        m.id.startsWith('msg-tool-') ||
        m.id.startsWith('msg-dispatch-') ||
        m.id.startsWith('msg-error-'))
    ) {
      return false;
    }
    return true;
  });
}

export function useCheckpointCommands({
  setState,
  runtime,
  peekTurn,
  setDraft,
}: UseCheckpointCommandsProps): UseCheckpointCommandsReturn {
  const handleCheckpointCommand = async (content: string): Promise<boolean> => {
    const trimmed = content.trim();
    if (!trimmed.startsWith('/')) return false;

    const [command, ...args] = trimmed.split(/\s+/);
    const cmd = command?.toLowerCase();

    if (cmd === '/undo') {
      let targetTurnId: number | undefined;
      let force = false;

      for (const a of args) {
        if (a === '--force' || a === '-f') {
          force = true;
        } else {
          const parsed = parseInt(a, 10);
          if (!Number.isNaN(parsed)) targetTurnId = parsed;
        }
      }

      const currentTurn = peekTurn ? peekTurn() : 0;
      const result = await getCheckpointManager().rollback({
        cwd: runtime.session.cwd,
        sessionId: runtime.session.id,
        currentTurn,
        options: { targetTurnId, force },
      });

      if (result.success) {
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            messages: pruneMessagesForUndo(prev.session.messages, result.targetTurn),
          },
          ...(result.originalPrompt ? { inputDraft: result.originalPrompt } : {}),
        }));

        if (result.originalPrompt && setDraft) {
          setDraft(result.originalPrompt);
        }

        const fileLines =
          result.restoredFiles.length > 0
            ? `恢复文件 (${result.restoredFiles.length}):\n` +
              result.restoredFiles.map((f) => `  - ${f}`).join('\n')
            : '无文件变更需恢复';
        const promptInfo = result.originalPrompt ? `\n上一轮 Prompt: "${result.originalPrompt}"` : '';
        pushSystemMessage(
          setState,
          `✓ 已成功撤销至 Turn ${result.targetTurn}！\n${fileLines}${promptInfo}`,
          'undo-success'
        );

        try {
          const record = createUndoRecord(
            runtime.session.id,
            result.rolledBackTurn,
            result.targetTurn,
            result.restoredFiles
          );
          await runtime.sessionManager.appendRecord(runtime.session, record);
        } catch {
          // transcript 追加保护
        }
      } else {
        if (result.conflicts && result.conflicts.length > 0) {
          const conflictLines = result.conflicts.map((c) => `  - ${c.path}: ${c.reason}`).join('\n');
          pushSystemMessage(
            setState,
            `⚠️ 检测到工作区外部并发修改，回滚已被安全阻断：\n${conflictLines}\n提示：可使用 /undo --force 强制覆盖。`,
            'undo-conflict'
          );
        } else {
          pushSystemMessage(
            setState,
            `⚠️ 撤销失败: ${result.error ?? '未找到对应快照'}`,
            'undo-error'
          );
        }
      }
      return true;
    }

    if (cmd === '/redo') {
      const result = await getCheckpointManager().redo({
        cwd: runtime.session.cwd,
        sessionId: runtime.session.id,
      });

      if (result.success) {
        const fileLines =
          result.restoredFiles.length > 0
            ? `恢复文件 (${result.restoredFiles.length}):\n` +
              result.restoredFiles.map((f) => `  - ${f}`).join('\n')
            : '无文件变更需恢复';
        pushSystemMessage(
          setState,
          `✓ 重做成功！已恢复至救援快照状态 (Turn ${result.targetTurn})。\n${fileLines}`,
          'redo-success'
        );
      } else {
        pushSystemMessage(
          setState,
          `⚠️ 重做失败: ${result.error ?? '没有可供重做的救援快照'}`,
          'redo-error'
        );
      }
      return true;
    }

    if (cmd === '/diff') {
      const arg = args[0];
      const turnId = arg ? parseInt(arg, 10) : undefined;
      const validTurnId = turnId !== undefined && !Number.isNaN(turnId) ? turnId : undefined;

      const diffSummary = await getCheckpointManager().getDiff({
        cwd: runtime.session.cwd,
        sessionId: runtime.session.id,
        turnId: validTurnId,
      });

      if (diffSummary.filesChanged === 0 && !diffSummary.rawDiff.trim()) {
        pushSystemMessage(setState, 'ℹ️ 当前工作区与快照之间无代码差异。', 'diff-empty');
      } else {
        const summary = `📝 变更差异: ${diffSummary.filesChanged} 个文件 (+${diffSummary.additions} / -${diffSummary.deletions} 行)`;
        const diffSnippet = diffSummary.rawDiff
          ? `\n\`\`\`diff\n${diffSummary.rawDiff.slice(0, 3000)}${diffSummary.rawDiff.length > 3000 ? '\n... (差异过长已截断)' : ''}\n\`\`\``
          : '';
        pushSystemMessage(setState, `${summary}${diffSnippet}`, 'diff-summary');
      }
      return true;
    }

    if (cmd === '/checkpoints' || cmd === '/checkpoint') {
      const list = getCheckpointManager().list(runtime.session.id);
      if (list.length === 0) {
        pushSystemMessage(setState, 'ℹ️ 当前会话暂无快照记录。', 'checkpoints-empty');
      } else {
        const rows = list
          .map(
            (c) =>
              `  - Turn ${c.turnId} [${c.id}]: ${c.promptSummary ?? '(无 Prompt)'} (${c.affectedFiles.length} files, ${c.createdAt})`
          )
          .join('\n');
        pushSystemMessage(
          setState,
          `📜 快照历史 (${list.length} 条):\n${rows}`,
          'checkpoints-list'
        );
      }
      return true;
    }

    return false;
  };

  return { handleCheckpointCommand };
}
