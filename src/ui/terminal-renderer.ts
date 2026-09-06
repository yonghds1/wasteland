import type { Writable } from 'node:stream';

import type { Observable } from 'rxjs';

import { t } from '@locales/index.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';
import type { PermissionDecisionKind } from '@core/engine/permission-gate.js';
import {
  ANSI,
  hexToFgBold,
  PANEL_GUTTER,
  createDisplayTimestamp,
  getDepthColor,
  getDepthPrefix,
  indentBlock,
  paint,
  resolvePanelWidth,
  wrapText,
} from './terminal-theme.js';
import { wastelandTheme } from '../theme/wasteland/index.js';
import { splitThinkTags } from './think-tags.js';

// ============================================================
// 配置常量
// ============================================================

/** 工具输出在终端显示的最大行数 */
const MAX_TOOL_OUTPUT_LINES = 40;

/** 头部和尾部各显示的行数（用于智能截断） */
const SMART_TRUNCATE_HEAD_LINES = 15;
const SMART_TRUNCATE_TAIL_LINES = 15;

/** 折叠输出阈值（字符数） */
const COLLAPSE_THRESHOLD = 500;

// ============================================================
// 工具显示常量
// ============================================================

/** 工具图标映射 */
const TOOL_DISPLAY_ICONS: Record<string, string> = {
  'read-file': '📖',
  read_file: '📖',
  'write-file': '✍️',
  write_file: '✍️',
  'edit-file': '✏️',
  edit_file: '✏️',
  bash: '💻',
  terminal: '💻',
  'search-files': '🔎',
  search_files: '🔎',
  'web-search': '🔍',
  web_search: '🔍',
  default: '⚡',
};

/** 工具动词映射 */
const TOOL_DISPLAY_VERBS: Record<string, string> = {
  'read-file': 'read',
  read_file: 'read',
  'write-file': 'write',
  write_file: 'write',
  'edit-file': 'edit',
  edit_file: 'edit',
  bash: 'exec',
  terminal: 'exec',
  'search-files': 'find',
  search_files: 'find',
  'web-search': 'search',
  web_search: 'search',
};

// ============================================================
// Theme-based ANSI colors
// ============================================================

/** Secondary color (bold) */
const SECONDARY_COLOR = hexToFgBold(wastelandTheme.colors.secondary);

/** Success color (bold) */
const SUCCESS_COLOR = hexToFgBold(wastelandTheme.colors.success);

/** Error color (bold) */
const ERROR_COLOR = hexToFgBold(wastelandTheme.colors.error);

// ============================================================
// Agent 上下文追踪
// ============================================================

/** 从 sessionId 推断 Agent 深度 */
function inferDepthFromSessionId(sessionId: string): number {
  // sessionId 格式: "xxx-child-analyzer" 或 "xxx"
  const childCount = (sessionId.match(/-child-/g) || []).length;
  return childCount;
}

/** 从 sessionId 提取子 Agent 名称 */
function extractAgentName(sessionId: string): string | undefined {
  const match = sessionId.match(/-child-([^-]+)/);
  return match ? match[1] : undefined;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 智能截断文件输出
 *
 * 对于文件输出（以 📄 开头），保留头部和尾部，中间用省略符连接。
 * 这样用户可以看到文件开头和结尾的内容。
 *
 * @param output - 原始输出内容
 * @param maxLines - 最大显示行数
 * @returns 处理后的输出
 */
function smartTruncateFileOutput(output: string, maxLines: number = MAX_TOOL_OUTPUT_LINES): string {
  const lines = output.split('\n');

  if (lines.length <= maxLines) {
    return output;
  }

  // 检查是否是文件输出（以 📄 开头）
  const isFileOutput = output.startsWith('📄');

  // 如果是文件输出且已经有 "... lines hidden"，说明工具层已截断
  // 我们需要保留尾部可见，避免双重截断
  if (isFileOutput && output.includes('lines hidden')) {
    // 找到 "lines hidden" 行的位置
    const hiddenLineIndex = lines.findIndex((line) => line.includes('lines hidden'));

    if (hiddenLineIndex > 0 && hiddenLineIndex < lines.length - 1) {
      // 工具已截断，显示：头部 + 省略 + 尾部
      const headerLines = lines.slice(0, Math.min(SMART_TRUNCATE_HEAD_LINES, hiddenLineIndex + 1));
      const tailLines = lines.slice(-SMART_TRUNCATE_TAIL_LINES);
      const middleHiddenCount = lines.length - headerLines.length - tailLines.length;

      if (middleHiddenCount > 0) {
        return [
          ...headerLines,
          `... ${middleHiddenCount} lines hidden in terminal display`,
          ...tailLines,
        ].join('\n');
      }
    }
  }

  // 普通截断：只显示头部
  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = lines.length - maxLines;

  if (isFileOutput) {
    return [...visibleLines, `... ${hiddenCount} more lines (output truncated)`].join('\n');
  }

  return [...visibleLines, `... (${hiddenCount} more lines)`].join('\n');
}

/**
 * 截断长输出以适应终端显示
 *
 * @param output - 原始输出内容
 * @param maxLines - 最大显示行数
 * @returns 处理后的输出（可能包含截断提示）
 */
function truncateOutputForDisplay(
  output: string,
  maxLines: number = MAX_TOOL_OUTPUT_LINES
): string {
  const lines = output.split('\n');

  if (lines.length <= maxLines) {
    return output;
  }

  // 使用智能截断
  return smartTruncateFileOutput(output, maxLines);
}

function writeInteractiveLabel(
  stdout: Writable,
  params: {
    label: string;
    depth: number;
    name?: string;
  }
): void {
  const color = getDepthColor(params.depth);
  const timestamp = createDisplayTimestamp();

  stdout.write(
    `${paint(params.label, ANSI.bold, color)} ${paint(timestamp, ANSI.dim, ANSI.gray)}\n`
  );
}

function writeInteractiveBlock(
  stdout: Writable,
  params: {
    label: string;
    content: string;
    depth: number;
    name?: string;
    collapsed?: boolean;
    width: number;
  }
): void {
  writeInteractiveLabel(stdout, {
    label: params.label,
    depth: params.depth,
    name: params.name,
  });

  // 处理折叠
  let displayContent = params.content;
  if (params.collapsed && params.content.length > COLLAPSE_THRESHOLD) {
    const lines = params.content.split('\n');
    const firstLines = lines.slice(0, 10).join('\n');
    const hiddenCount = lines.length - 10;
    displayContent = `${firstLines}\n${paint(`... ${hiddenCount} lines hidden (press Enter to expand)`, ANSI.dim)}`;
  }

  stdout.write(`${indentBlock(wrapText(displayContent, params.width), PANEL_GUTTER)}\n`);
}

function writeInteractiveStatusLine(
  stdout: Writable,
  params: {
    label: string;
    depth: number;
    name?: string;
    segments: Array<{
      text: string;
      styles?: string[];
    }>;
  }
): void {
  const color = getDepthColor(params.depth);
  const content = params.segments
    .map((segment) => paint(segment.text, ...(segment.styles ?? [])))
    .join('');

  stdout.write(`${paint(params.label, ANSI.bold, color)} ${content}\n`);
}

function createChunkWriter(
  stdout: Writable,
  width: number
): {
  write: (turn: number, chunk: string) => void;
  close: (turn: number) => void;
} {
  const lineLengths = new Map<number, number>();

  function write(turn: number, chunk: string): void {
    let lineLength = lineLengths.get(turn) ?? 0;

    for (const character of Array.from(chunk)) {
      if (character === '\n') {
        stdout.write(`\n${PANEL_GUTTER}`);
        lineLength = 0;
        continue;
      }

      if (lineLength >= width) {
        stdout.write(`\n${PANEL_GUTTER}`);
        lineLength = 0;
      }

      stdout.write(character);
      lineLength += 1;
    }

    lineLengths.set(turn, lineLength);
  }

  function close(turn: number): void {
    lineLengths.delete(turn);
  }

  return {
    write,
    close,
  };
}

function resolveDecisionStyles(decision: PermissionDecisionKind): string[] {
  if (decision === 'allow') {
    return [ANSI.green];
  }

  if (decision === 'ask') {
    return [ANSI.yellow];
  }

  return [ANSI.red];
}

export async function renderRuntimeEvents(
  events$: Observable<RuntimeEvent>,
  params?: {
    stdout?: Writable;
    stderr?: Writable;
    onTurnComplete?: () => void;
    style?: 'classic' | 'interactive';
    /** 是否展示思考块（minimax/DeepSeek R1 等把 <think> 拼到 content 时） */
    showThinking?: boolean;
  }
): Promise<void> {
  const stdout = params?.stdout ?? process.stdout;
  const stderr = params?.stderr ?? process.stderr;
  const style = params?.style ?? 'classic';
  const showThinking = params?.showThinking ?? true;
  const panelWidth = resolvePanelWidth('columns' in stdout ? stdout.columns : undefined);
  const chunkedTurns = new Set<number>();
  const pendingTurnSpacing = new Set<number>();
  const chunkWriter = createChunkWriter(stdout, panelWidth);

  // 追踪当前 Agent 上下文
  let currentDepth = 0;
  let currentName: string | undefined;
  // 追踪是否正在显示思考状态
  let isShowingThinking = false;

  function updateAgentContext(sessionId: string): void {
    currentDepth = inferDepthFromSessionId(sessionId);
    currentName = extractAgentName(sessionId);
  }

  function flushTurnSpacing(turn: number): void {
    if (!pendingTurnSpacing.has(turn)) {
      return;
    }

    stdout.write('\n');
    pendingTurnSpacing.delete(turn);
  }

  function completeInteractiveTurn(): void {
    stdout.write('\n');
    params?.onTurnComplete?.();
  }

  await new Promise<void>((resolve, reject) => {
    events$.subscribe({
      next: (event) => {
        // 更新 Agent 上下文
        if ('sessionId' in event) {
          updateAgentContext(event.sessionId);
        }

        switch (event.type) {
          case 'assistant_chunk': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);

              // 第一个 chunk 到达时，清除思考状态
              if (isShowingThinking) {
                // 上移一行并清除该行，然后回到行首
                stdout.write('\x1b[1A\x1b[2K\r');
                isShowingThinking = false;
              }

              if (!chunkedTurns.has(event.turn)) {
                writeInteractiveLabel(stdout, {
                  label: 'wasteland',
                  depth: currentDepth,
                  name: currentName,
                });
                stdout.write(PANEL_GUTTER);
                chunkedTurns.add(event.turn);
              }

              chunkWriter.write(event.turn, event.chunk);
              break;
            }

            if (!chunkedTurns.has(event.turn)) {
              stdout.write(`assistant[${event.turn}]> `);
              chunkedTurns.add(event.turn);
            }

            stdout.write(event.chunk);
            break;
          }
          case 'assistant_message': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);

              // 清除思考状态（如果没有通过 chunk 清除）
              if (isShowingThinking) {
                stdout.write('\x1b[1A\x1b[2K\r');
                isShowingThinking = false;
              }

              if (chunkedTurns.has(event.turn)) {
                stdout.write('\n');
                chunkedTurns.delete(event.turn);
                chunkWriter.close(event.turn);
                // 流式 chunk 阶段保留原始内容保证实时体验；message 收尾时
                // 清洗出 thinking 单独展示（💭 + dim 样式，参考 OpenCode）。
                if (showThinking) {
                  const split = splitThinkTags(event.content);
                  if (split.thinking) {
                    stdout.write(
                      `\n${paint('💭 Thinking', ANSI.dim)}\n${paint(split.thinking, ANSI.dim)}\n`
                    );
                  }
                }
              } else {
                const split = splitThinkTags(event.content);
                let displayContent = split.content;
                if (showThinking && split.thinking) {
                  displayContent = `${paint('💭 Thinking', ANSI.dim)}\n${paint(split.thinking, ANSI.dim)}\n\n${split.content}`;
                }
                writeInteractiveBlock(stdout, {
                  label: 'wasteland',
                  content: displayContent,
                  depth: currentDepth,
                  name: currentName,
                  width: panelWidth,
                });
              }

              completeInteractiveTurn();
              break;
            }

            if (chunkedTurns.has(event.turn)) {
              stdout.write('\n');
              chunkedTurns.delete(event.turn);
              if (showThinking) {
                const split = splitThinkTags(event.content);
                if (split.thinking) {
                  stdout.write(`💭 Thinking: ${split.thinking}\n`);
                }
              }
            } else {
              const split = splitThinkTags(event.content);
              if (showThinking && split.thinking) {
                stdout.write(`💭 Thinking: ${split.thinking}\n`);
              }
              stdout.write(`assistant[${event.turn}]> ${split.content}\n`);
            }

            params?.onTurnComplete?.();
            break;
          }
          case 'tool_call_requested': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);
              // 工具请求行
              const icon = TOOL_DISPLAY_ICONS[event.toolName] || TOOL_DISPLAY_ICONS.default;
              const verb = (TOOL_DISPLAY_VERBS[event.toolName] || event.toolName).padEnd(9);
              stdout.write(
                `${paint('┊', ANSI.dim)} ${icon} ${paint(verb, ANSI.brightWhite)} ${paint('requesting...', ANSI.dim)}\n`
              );
              break;
            }

            stdout.write(`tool[${event.turn}]> request ${event.toolName}\n`);
            break;
          }
          case 'permission_decision': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);
              writeInteractiveStatusLine(stdout, {
                label: 'perm',
                depth: currentDepth,
                name: currentName,
                segments: [
                  {
                    text: `${event.toolName} → `,
                    styles: [ANSI.brightWhite],
                  },
                  {
                    text: event.decision,
                    styles: [ANSI.bold, ...resolveDecisionStyles(event.decision)],
                  },
                  {
                    text: ` (${event.mode})`,
                    styles: [ANSI.dim, ANSI.gray],
                  },
                ],
              });
              break;
            }

            stdout.write(
              `permission[${event.turn}]> ${event.toolName}: ${event.decision} (${event.mode})\n`
            );
            break;
          }
          case 'tool_started': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);
              // 工具开始行
              const icon = TOOL_DISPLAY_ICONS[event.toolName] || TOOL_DISPLAY_ICONS.default;
              const verb = (TOOL_DISPLAY_VERBS[event.toolName] || event.toolName).padEnd(9);
              stdout.write(
                `${paint('┊', ANSI.dim)} ${icon} ${paint(verb, ANSI.cyan)} ${paint('running...', SECONDARY_COLOR)}\n`
              );
              break;
            }

            stdout.write(`tool[${event.turn}]> start ${event.toolName}\n`);
            break;
          }
          case 'tool_result': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);
              // 工具结果行
              const icon = TOOL_DISPLAY_ICONS[event.toolName] || TOOL_DISPLAY_ICONS.default;
              const verb = (TOOL_DISPLAY_VERBS[event.toolName] || event.toolName).padEnd(9);

              // 截断长输出以适应终端显示
              const displayOutput = truncateOutputForDisplay(event.output);
              const detail =
                displayOutput.length > 42 ? displayOutput.slice(0, 42) + '...' : displayOutput;

              stdout.write(
                `${paint('┊', ANSI.dim)} ${icon} ${paint(verb, SUCCESS_COLOR)} ${paint(detail, ANSI.dim)}\n`
              );
              break;
            }

            // Classic 模式也截断
            const classicOutput = truncateOutputForDisplay(event.output);
            stdout.write(`tool[${event.turn}]> result ${event.toolName}: ${classicOutput}\n`);
            break;
          }
          case 'tool_failed': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);
              // 工具失败行
              const icon = TOOL_DISPLAY_ICONS[event.toolName] || TOOL_DISPLAY_ICONS.default;
              const verb = (TOOL_DISPLAY_VERBS[event.toolName] || event.toolName).padEnd(9);

              stdout.write(
                `${paint('┊', ANSI.dim)} ${icon} ${paint(verb, ERROR_COLOR)} ${paint(event.error?.slice(0, 42) || 'error', ANSI.dim)} ${paint('[failed]', ERROR_COLOR)}\n`
              );
              break;
            }

            stdout.write(`tool[${event.turn}]> failed ${event.toolName}: ${event.error}\n`);
            break;
          }
          case 'session_ended': {
            if (style === 'interactive') {
              stdout.write(`\n${paint('━'.repeat(40), ANSI.dim, ANSI.gray)}\n`);
              stdout.write(`${paint('Session ended', ANSI.dim, ANSI.gray)}\n`);
            }
            break;
          }
          case 'session_started': {
            if (style === 'interactive') {
              stdout.write(
                `${paint('●', ANSI.bold, ANSI.yellow)} ${paint(t('ui.terminal.thinking'), ANSI.yellow)}\n`
              );
              isShowingThinking = true;
            }
            break;
          }
          case 'agent_spawned': {
            if (style === 'interactive') {
              const childDepth = inferDepthFromSessionId(event.childId);
              const childName = extractAgentName(event.childId);
              const color = getDepthColor(childDepth);
              const prefix = getDepthPrefix(childDepth, childName);

              stdout.write(
                `${paint(prefix, ANSI.bold, color)} ${paint('spawned', ANSI.green)} ${paint(`"${event.task.slice(0, 50)}${event.task.length > 50 ? '...' : ''}"`, ANSI.dim)}\n`
              );
            }
            break;
          }
          case 'agent_completed': {
            if (style === 'interactive') {
              const childDepth = inferDepthFromSessionId(event.childId);
              const childName = extractAgentName(event.childId);
              const color = getDepthColor(childDepth);
              const prefix = getDepthPrefix(childDepth, childName);

              const statusText =
                event.status === 'success'
                  ? paint('completed ✓', ANSI.green)
                  : event.status === 'timeout'
                    ? paint('timeout ⏱', ANSI.yellow)
                    : paint('failed ✗', ANSI.red);

              stdout.write(`${paint(prefix, ANSI.bold, color)} ${statusText}\n`);

              if (event.result) {
                const truncatedResult =
                  event.result.length > 200 ? `${event.result.slice(0, 200)}...` : event.result;
                stdout.write(`${indentBlock(paint(truncatedResult, ANSI.dim), PANEL_GUTTER)}\n`);
              }

              if (event.error) {
                stdout.write(`${indentBlock(paint(event.error, ANSI.red), PANEL_GUTTER)}\n`);
              }
            }
            break;
          }
          case 'user_turn': {
            if (style === 'interactive') {
              stdout.write(ANSI.reset);
              pendingTurnSpacing.add(event.turn);
            }

            break;
          }
          case 'user_input_requested': {
            if (style === 'interactive') {
              flushTurnSpacing(event.turn);
              stdout.write('\n');
              stdout.write(
                `${paint('?', ANSI.bold, ANSI.cyan)} ${paint(event.question, ANSI.bold, ANSI.white)}\n`
              );
              if (event.options && event.options.length > 0) {
                stdout.write(`${paint('Options:', ANSI.dim)} ${event.options.join(', ')}\n`);
              }
              stdout.write(`${paint('> ', ANSI.bold, ANSI.cyan)}`);
            } else {
              stdout.write(`\n[ask-user] ${event.question}\n`);
              if (event.options && event.options.length > 0) {
                stdout.write(`Options: ${event.options.join(', ')}\n`);
              }
              stdout.write('Your answer: ');
            }
            break;
          }
          case 'user_input_received': {
            if (style === 'interactive') {
              stdout.write(`${paint(event.answer, ANSI.green)}\n\n`);
            } else {
              stdout.write(`${event.answer}\n`);
            }
            break;
          }
          default: {
            stderr.write(`${t('ui.terminal.unhandledEvent')}${JSON.stringify(event)}\n`);
          }
        }
      },
      error: reject,
      complete: resolve,
    });
  });
}
