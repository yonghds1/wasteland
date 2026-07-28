/**
 * ChatMessageList - 聊天消息列表
 *
 * OpenCode 风格:author 标签制,去边框,靠颜色与留白区分消息。
 *
 * ## 消息呈现
 *
 * - user / assistant:author 标签(带色) + 内容,消息间留白
 * - tool / 子 Agent:紧凑单行 `⏺ ...`
 * - system:淡色单行
 *
 * ## 思考块（minimax/DeepSeek R1 等）
 *
 * 模型把思考过程作为 `<think>...</think>` 拼到 assistant content。
 * 这里用 splitThinkTags 拆出 thinking，单独用 💭 + dim 样式渲染
 * （参考 Claude Code / OpenCode）。showThinking=false 时隐藏。
 */

import React from 'react';
import { Text, Box } from 'ink';
import { interval, scan, type Subscription } from 'rxjs';
import { useAppContext, type Message } from '../context/AppContext.js';
import { t, tArray } from '../../locales/index.js';
import { systemCommon, type RoleSkin } from '../../skins/index.js';
import { wastelandTheme } from '../../theme/wasteland/index.js';
import { splitThinkTags } from '../../ui/think-tags.js';

interface ChatMessageListProps {
  width: number;
  selectedSkin: RoleSkin;
  /** 是否展示 <think> 思考块，默认 true */
  showThinking?: boolean;
  /** Spinner 帧切换间隔（毫秒），默认 80 */
  spinnerIntervalMs?: number;
  /** 打字机逐字符揭示间隔（毫秒），默认 30 */
  typewriterRateMs?: number;
}

export function ChatMessageList({
  width,
  selectedSkin,
  showThinking = true,
  spinnerIntervalMs = wastelandTheme.animations.spinnerIntervalMs,
  typewriterRateMs = wastelandTheme.animations.typewriterRateMs,
}: ChatMessageListProps): React.ReactElement {
  const { state } = useAppContext();
  const messages = state.session.messages;

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {/* 欢迎消息 */}
      {messages.length === 0 && (
        <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
          <Text color={wastelandTheme.colors.primary} bold>
            {t(selectedSkin.roleUi.greetingKey)}
          </Text>
          <Text color={wastelandTheme.colors.secondary}>{getRoleCatchphrase(selectedSkin)}</Text>
          <Text color={wastelandTheme.colors.muted}>{t('tui.session.messages.chatStartHint')}</Text>
        </Box>
      )}

      {/* 消息列表 */}
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          width={width}
          selectedSkin={selectedSkin}
          showThinking={showThinking}
        />
      ))}

      {/* 流式输出 */}
      {state.session.isStreaming && state.session.streamingContent && (
        <StreamingBlock
          width={width}
          selectedSkin={selectedSkin}
          content={state.session.streamingContent}
          showThinking={showThinking}
          spinnerIntervalMs={spinnerIntervalMs}
          typewriterRateMs={typewriterRateMs}
          isStreaming={state.session.isStreaming}
        />
      )}

      {/* 通用活动指示器：isThinking（等首个 chunk）或 isStreaming（流式中），
          仅在还没显示 streamingContent 时（避免与 StreamingBlock 重复） */}
      {(state.session.isThinking || state.session.isStreaming) &&
        !state.session.streamingContent && (
          <Box flexDirection="row" marginTop={1}>
            <Text color={wastelandTheme.colors.warning}>{t(selectedSkin.roleUi.thinkingKey)}</Text>
          </Box>
        )}
    </Box>
  );
}

// ============================================================
// useTypewriter hook（rxjs 驱动的逐字符揭示动画）
// ============================================================

/**
 * 逐字符揭示动画（业界 LLM 客户端通用做法，ChatGPT / Claude.ai 风格）。
 *
 * 设计目的：minimax / DeepSeek R1 等模型服务端流式粒度粗（每 chunk 14-99 字符），
 * 直接渲染会出现"一坨一坨"而非"逐字打字"。本 hook 在客户端按固定节奏逐字符
 * 揭示累积内容，与服务端 chunk 粒度解耦——任何粒度都能"看起来逐字打字"。
 *
 * 实现：用 rxjs `interval` + `scan` 累加计数，达到 buffer 长度时在订阅回调内
 * 自动 unsubscribe。用 ref 同步 buffer 避免 effect 重建时 reset 已揭示字符数。
 *
 * @param content - 累积的全文（每个 chunk 拼接进来）
 * @param rateMs - 每字符揭示间隔（毫秒），默认 30
 * @param isActive - 流是否还在进行（false 时立即揭示全部，无延迟收尾）
 * @returns 当前应揭示的字符串切片
 */
function useTypewriter(content: string, rateMs: number, isActive: boolean): string {
  const [revealed, setRevealed] = React.useState(0);
  const bufferRef = React.useRef(content);
  const subRef = React.useRef<Subscription | null>(null);

  // 同步 buffer；非活动时立即揭示全部 + 停掉动画
  React.useEffect(() => {
    bufferRef.current = content;
    if (!isActive) {
      setRevealed(content.length);
      subRef.current?.unsubscribe();
      subRef.current = null;
    }
  }, [content, isActive]);

  // rxjs 驱动：interval + scan 累加，达到时自动停止
  React.useEffect(() => {
    if (!isActive) return;
    const len = bufferRef.current.length;
    if (revealed >= len) return;

    const sub = interval(rateMs)
      .pipe(scan((n) => Math.min(n + 2, bufferRef.current.length), revealed))
      .subscribe((n) => {
        setRevealed(n);
        // 揭示完成 → 自动取消订阅
        if (n >= bufferRef.current.length) {
          sub.unsubscribe();
          subRef.current = null;
        }
      });
    subRef.current = sub;
    return () => {
      sub.unsubscribe();
      subRef.current = null;
    };
  }, [rateMs, isActive]); // 不依赖 revealed/content：用 ref 取最新值

  return content.slice(0, revealed);
}

// ============================================================
// Spinner 组件（独立于模型 chunk 粒度的持续旋转指示器）
// ============================================================

/** Braille 点阵 spinner 帧序列（10 帧，循环） */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Spinner - 持续旋转的视觉指示器。
 *
 * 设计目的：minimax/DeepSeek R1 等模型服务端"批量发送"流式响应（chunks 在几毫秒
 * 内集中到达），仅靠 chunks 打字看不到过程。Spinner 以固定节奏（默认 80ms）旋转，
 * 给用户"系统还在工作"的视觉信号，与服务端 chunk 粒度解耦。
 *
 * @param intervalMs - 帧切换间隔，默认 80ms（10 帧 = 完整一圈 ~800ms）
 * @param color - spinner 颜色（默认 wastelandTheme.colors.secondary）
 */
function Spinner({
  intervalMs = wastelandTheme.animations.spinnerIntervalMs,
  color,
}: {
  intervalMs?: number;
  color?: string;
}): React.ReactElement {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SPINNER_FRAMES.length), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return <Text color={color ?? wastelandTheme.colors.secondary}>{SPINNER_FRAMES[idx]}</Text>;
}

// ============================================================
// 思考块组件
// ============================================================

interface ThinkingBlockProps {
  thinking: string;
  width: number;
  /** 是否正在流式（未闭合），用于显示 ⏳ 提示 */
  streaming?: boolean;
}

function ThinkingBlock({ thinking, width, streaming }: ThinkingBlockProps): React.ReactElement {
  // 根因修复：去掉 thinking 阶段的 spinner。
  // 之前 `{streaming && <Spinner/>}` 让"纯 thinking 阶段"（split.content 为空、模型尚未
  // 真正输出正文）也持续旋转 ⠋，与"大模型还没真正输出就不该显示 loading" 的期望冲突。
  // 现在 thinking 阶段只显示 ⏳/💭 静态标识 + thinking 文本，spinner 由外层
  // StreamingBlock 的 label 行（已按 hasContent 条件化）和底部独立指示器负责。
  return (
    <Box flexDirection="column" width={width} marginTop={1} paddingLeft={1}>
      <Box flexDirection="row">
        <Text color={wastelandTheme.colors.muted} dimColor>
          {streaming ? ' ⏳ ' : ' 💭 '}
          {t('ui.streaming.thinking')}
        </Text>
      </Box>
      <Text color={wastelandTheme.colors.muted} dimColor wrap="wrap">
        {thinking}
      </Text>
    </Box>
  );
}

// ============================================================
// 消息项组件
// ============================================================

interface MessageItemProps {
  message: Message;
  width: number;
  selectedSkin: RoleSkin;
  showThinking: boolean;
}

function MessageItem({
  message,
  width,
  selectedSkin,
  showThinking,
}: MessageItemProps): React.ReactElement {
  const labelColor = getMessageColor(message.type);
  const label = getMessageLabel(message.type, selectedSkin);

  // 工具消息 & 子 Agent 系统消息:紧凑单行(opencode 风格)
  if (message.type === 'tool' || (message.type === 'system' && message.content.startsWith('['))) {
    // 工具/系统消息也清洗掉可能混入的 think 标签
    const split = splitThinkTags(message.content);
    return (
      <Box width={width}>
        <Text color={wastelandTheme.colors.muted}> ⏺ </Text>
        <Text color={getToolColor(message.content)}>{split.content || message.content}</Text>
      </Box>
    );
  }

  // 普通系统消息:淡色单行
  if (message.type === 'system') {
    return (
      <Box width={width} marginTop={1}>
        <Text color={wastelandTheme.colors.muted}> {message.content}</Text>
      </Box>
    );
  }

  // user / assistant:author 标签 + 内容，thinking 单独渲染
  const split = splitThinkTags(message.content);
  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Text color={labelColor} bold>
        {label}
      </Text>
      {showThinking && split.thinking && <ThinkingBlock thinking={split.thinking} width={width} />}
      <Text color={wastelandTheme.colors.text}>{split.content}</Text>
    </Box>
  );
}

// ============================================================
// 流式输出组件（实时拆分 thinking / content）
// ============================================================

interface StreamingBlockProps {
  width: number;
  selectedSkin: RoleSkin;
  content: string;
  showThinking: boolean;
  spinnerIntervalMs?: number;
  typewriterRateMs?: number;
  /** 是否还在流式（false 时 useTypewriter 立即揭示全部，无延迟收尾） */
  isStreaming?: boolean;
}

function StreamingBlock({
  width,
  selectedSkin,
  content,
  showThinking,
  spinnerIntervalMs = wastelandTheme.animations.spinnerIntervalMs,
  typewriterRateMs = wastelandTheme.animations.typewriterRateMs,
  isStreaming = true,
}: StreamingBlockProps): React.ReactElement {
  const split = splitThinkTags(content);
  // 仅在有正文内容时显示 label 行的 spinner。
  // 修复：纯 thinking 阶段（split.content 为空）不显示左侧 spinner，避免
  // "大模型还没真正输出时就在转" 的误觉。thinking 由 ThinkingBlock 自己的
  // ⏳ spinner 表达即可。
  const hasContent = split.content.length > 0;
  // 客户端打字机动画：逐字符揭示 split.content，与服务端 chunk 粒度解耦。
  // 即使 minimax 一次给 14-99 字符，UI 也能"逐字打字"显示。
  const revealedContent = useTypewriter(split.content, typewriterRateMs, isStreaming);
  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Box flexDirection="row">
        {hasContent && (
          <Spinner intervalMs={spinnerIntervalMs} color={wastelandTheme.colors.secondary} />
        )}
        <Text color={wastelandTheme.colors.secondary} bold>
          {hasContent ? ' ' : ''}
          {t(selectedSkin.roleUi.labelKey)}
        </Text>
      </Box>
      {showThinking && split.thinking && (
        <ThinkingBlock thinking={split.thinking} width={width} streaming={split.hasUnclosed} />
      )}
      <Text color={wastelandTheme.colors.text}>
        {revealedContent}
        <Text color={wastelandTheme.colors.primary}>
          {wastelandTheme.decorations.streamingCursor}
        </Text>
      </Text>
    </Box>
  );
}

// ============================================================
// 辅助函数
// ============================================================

function getRoleCatchphrase(skin: RoleSkin): string {
  const phrases = tArray(skin.roleUi.catchphrasesKey);
  return phrases.length > 0 ? phrases[Math.floor(Math.random() * phrases.length)] : '';
}

function getMessageColor(type: Message['type']): string {
  switch (type) {
    case 'user':
      return wastelandTheme.colors.messageBorderUser;
    case 'assistant':
      return wastelandTheme.colors.messageBorderAssistant;
    case 'tool':
      return wastelandTheme.colors.messageBorderTool;
    case 'system':
      return wastelandTheme.colors.messageBorderSystem;
    default:
      return wastelandTheme.colors.muted;
  }
}

function getMessageLabel(type: Message['type'], selectedSkin: RoleSkin): string {
  switch (type) {
    case 'user':
      return t(systemCommon.labels.user);
    case 'assistant':
      return t(selectedSkin.roleUi.labelKey);
    case 'tool':
      return t(systemCommon.labels.tool);
    case 'system':
      return t(systemCommon.labels.system);
    default:
      return t('tui.session.messages.message');
  }
}

function getToolColor(content: string): string {
  if (content.includes('✅') || content.includes('success')) {
    return wastelandTheme.colors.success;
  }
  if (content.includes('❌') || content.includes('error')) {
    return wastelandTheme.colors.warning;
  }
  if (content.includes('🔧')) {
    return wastelandTheme.colors.primary;
  }
  return wastelandTheme.colors.muted;
}
