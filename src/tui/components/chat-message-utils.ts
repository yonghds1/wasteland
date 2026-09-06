import React from 'react';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { systemCommon, type Skin } from '@skins/index.js';
import { t } from '@locales/index.js';
import { type Message } from '../context/AppContext.js';
import { splitThinkTags } from '@ui/think-tags.js';

/** 计算字符串在终端中占据的物理列宽（CJK 全角字符占 2 列，ASCII 占 1 列） */
export function getVisualWidth(str: string): number {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/** 按照终端物理列宽精确折行，确保每一行在终端上严格占据 1 个物理行 */
export function wrapTextToLines(text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const rawLines = text.split('\n');
  const result: string[] = [];
  const safeWidth = Math.max(10, maxWidth);

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      result.push('');
      continue;
    }

    let currentLine = '';
    let currentWidth = 0;

    for (let i = 0; i < rawLine.length; i++) {
      const char = rawLine.charAt(i);
      const charWidth = getVisualWidth(char);

      if (currentWidth + charWidth > safeWidth) {
        result.push(currentLine);
        currentLine = char;
        currentWidth = charWidth;
      } else {
        currentLine += char;
        currentWidth += charWidth;
      }
    }

    if (currentLine.length > 0) {
      result.push(currentLine);
    }
  }

  return result;
}

/** 解析权限询问内容，提取 toolName 与详情 */
export function parsePermissionQuestion(content: string): { toolName: string; detail: string } | null {
  if (content.includes('是否允许创建子 Agent') || content.includes('是否允许创建子Agent')) {
    const match = content.match(/是否允许创建子\s*Agent[^(]*\(([^)]+)\)?/);
    return {
      toolName: 'spawn_agent',
      detail: match?.[1] ?? '创建子 Agent 执行任务',
    };
  }
  if (content.includes('是否允许执行')) {
    const match = content.match(/是否允许执行\s*([^\s(?]+)(?:\s*\(([^)]+)\))?/);
    return {
      toolName: match?.[1] ?? '工具',
      detail: match?.[2] ?? '',
    };
  }
  return null;
}

/** Braille 点阵 spinner 帧序列（10 帧，循环） */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/**
 * 顶层 Spinner 动画帧调度 Hook
 * 在组件生命周期内维护单一稳定的计时器，彻底杜绝因为流式 chunk 频繁重绘而导致子组件计时器不断被重置
 */
export function useSpinnerFrame(
  intervalMs: number = wastelandTheme.animations.spinnerIntervalMs,
  isActive: boolean = true
): string {
  const [frameIdx, setFrameIdx] = React.useState(0);

  React.useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setFrameIdx((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, isActive]);

  return SPINNER_FRAMES[frameIdx] ?? '⠋';
}

/** 实时统计当前微任务执行耗时（秒） */
export function useElapsedTimer(isActive: boolean): string {
  const [elapsed, setElapsed] = React.useState('0.0');
  const startRef = React.useRef(Date.now());

  React.useEffect(() => {
    if (!isActive) {
      setElapsed('0.0');
      return;
    }
    startRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(((Date.now() - startRef.current) / 1000).toFixed(1));
    }, 100);
    return () => clearInterval(timer);
  }, [isActive]);

  return elapsed;
}

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
export function useTypewriter(content: string, _rateMs: number, _isActive: boolean): string {
  return content;
}

export function getRoleCatchphrase(skin: Skin): string {
  const phrases = skin.catchphrases;
  return phrases.length > 0 ? phrases[Math.floor(Math.random() * phrases.length)] : '';
}

export function getMessageColor(type: Message['type']): string {
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

export function getMessageLabel(type: Message['type'], selectedSkin: Skin): string {
  switch (type) {
    case 'user':
      return t(systemCommon.labels.user);
    case 'assistant':
      return selectedSkin.label;
    case 'tool':
      return t(systemCommon.labels.tool);
    case 'system':
      return t(systemCommon.labels.system);
    default:
      return t('tui.session.messages.message');
  }
}

export interface SemanticToolInfo {
  icon: string;
  action: string;
  target: string;
  meta: string;
  isError: boolean;
}

/**
 * 检测内容是否为错误。
 *
 * 匹配关键字：error / failed / 失败 / 错误 / ❌ / Error: prefix
 */
export function isErrorContent(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes('error:') ||
    lower.includes('failed:') ||
    lower.includes('❌') ||
    content.includes('失败') ||
    content.includes('错误')
  );
}

/**
 * 检测内容是否为警告。
 *
 * 匹配关键字：warn / warning / 警告 / ⚠️
 */
export function isWarnContent(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes('warn:') ||
    lower.includes('warning:') ||
    lower.includes('⚠️') ||
    content.includes('警告')
  );
}

/**
 * ISO 时间戳 → HH:MM（紧凑格式）。
 *
 * 输入形如 '2026-07-29T12:34:56.789Z'，返回 '12:34'。
 * 解析失败返回空字符串（调用方决定是否显示）。
 */
export function formatTimeHHMM(iso: string): string {
  if (typeof iso !== 'string' || iso.length < 16) return '';
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  if (!/^\d{2}$/.test(hh) || !/^\d{2}$/.test(mm)) return '';
  return `${hh}:${mm}`;
}

/**
 * 计算流式输出的 token 速率（字符/秒）。
 *
 * 用 1 秒滑动窗口跟踪内容增长量：每秒开始时记录基准，长度差即为该秒内新增的字符数。
 * 近似视作 token 数（实际生产可接分词器；UI 反馈用字符数已足够）。
 *
 * @param currentLength - 当前已揭示字符数
 * @param isActive - 流式是否仍在进行（结束后停止计算）
 * @returns 当前速率（字符/秒），无足够数据时返回 null
 */
export function useTokenRate(currentLength: number, isActive: boolean): number | null {
  const baselineRef = React.useRef<{ length: number; time: number } | null>(null);
  const [rate, setRate] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!isActive) {
      baselineRef.current = null;
      setRate(null);
      return;
    }
    const now = Date.now();
    const baseline = baselineRef.current;
    if (!baseline) {
      baselineRef.current = { length: currentLength, time: now };
      return;
    }
    const elapsedMs = now - baseline.time;
    if (elapsedMs >= 1000) {
      const deltaChars = currentLength - baseline.length;
      const ratePerSec = (deltaChars / elapsedMs) * 1000;
      setRate(ratePerSec);
      baselineRef.current = { length: currentLength, time: now };
    }
  }, [currentLength, isActive]);

  return rate;
}

/**
 * OpenCode 规范的语义化工具输出解析器
 * 提取干净的动作谓词、操作目标与统计信息，彻底剥离冗余的分割线和截断代码正文。
 */
export function parseSemanticTool(rawContent: string): SemanticToolInfo {
  const isError = isErrorContent(rawContent);
  const split = splitThinkTags(rawContent);
  const content = split.content || rawContent;
  // 取首行并去除可能的虚线及之后内容
  const firstLine = content.split(/\r?\n/)[0]?.split(/─{3,}/)[0]?.trim() || content.trim();

  // 1. Read file: 📄 package.json (92 lines, 3.0KB) — lines 1-80
  if (firstLine.includes('📄') || firstLine.startsWith('read_file') || firstLine.startsWith('view_file')) {
    const match = firstLine.match(/^[📄]?\s*(?:read_file|view_file|📄)?\s*([^\s(—─]+)\s*(?:\(([^)]+)\))?\s*(?:—\s*([^─\n]+))?/iu);
    const target = match?.[1]?.trim() || firstLine.replace(/^[📄\s]+/u, '').split(' ')[0] || '';
    const parenInfo = match?.[2]?.trim();
    const dashInfo = match?.[3]?.trim();
    const meta = [parenInfo, dashInfo].filter(Boolean).join(', ');
    return {
      icon: isError ? '✗' : '✓',
      action: 'Read',
      target,
      meta: meta ? `(${meta})` : '',
      isError,
    };
  }

  // 2. Glob / Search: 🔍 glob "**/*.{json,yaml}" — 7 matches
  if (firstLine.includes('🔍') || firstLine.includes('glob') || firstLine.includes('grep') || firstLine.includes('search')) {
    const globMatch = firstLine.match(/^[🔍]?\s*(?:glob|grep|search|find_by_name)?\s*"?([^"—─]+)"?\s*(?:—\s*([^─\n]+))?/iu);
    const target = globMatch?.[1]?.trim() || '';
    const meta = globMatch?.[2]?.trim() || '';
    return {
      icon: isError ? '✗' : '✓',
      action: 'Search',
      target: target.startsWith('"') ? target : `"${target}"`,
      meta: meta ? `(${meta})` : '',
      isError,
    };
  }

  // 3. List directory: 📁 /home/.../wasteland — 500 entries (recursive)
  if (firstLine.includes('📁') || firstLine.includes('list_directory') || firstLine.includes('list_dir')) {
    const listMatch = firstLine.match(/^[📁]?\s*(?:list_directory|list_dir|📁)?\s*([^\s—─]+)\s*(?:—\s*([^─\n]+))?/iu);
    const target = listMatch?.[1]?.trim() || '';
    const meta = listMatch?.[2]?.trim() || '';
    return {
      icon: isError ? '✗' : '✓',
      action: 'List',
      target,
      meta: meta ? `(${meta})` : '',
      isError,
    };
  }

  // 4. Run command: ⚡ run_command "npm test"
  if (firstLine.includes('⚡') || firstLine.includes('run_command') || firstLine.includes('exec')) {
    const cmdClean = firstLine.replace(/^[⚡]?\s*(?:run_command|exec)?\s*:?\s*/iu, '').trim();
    return {
      icon: isError ? '✗' : '✓',
      action: 'Run',
      target: cmdClean.startsWith('"') ? cmdClean : `"${cmdClean}"`,
      meta: '',
      isError,
    };
  }

  // 5. Fallback clean first line
  const cleanFirst = firstLine.slice(0, 80);
  return {
    icon: isError ? '✗' : '✓',
    action: 'Tool',
    target: cleanFirst,
    meta: '',
    isError,
  };
}

/**
 * 未读新行数（R7，纯函数，可单测）。
 *
 * 钉底时恒为 0；脱钉时为视口下方不可见行数。
 */
export function countNewLines(
  totalLines: number,
  scrollOffset: number,
  maxDisplayLines: number,
  stickToBottom: boolean,
): number {
  if (stickToBottom) return 0;
  return Math.max(0, totalLines - (scrollOffset + maxDisplayLines));
}
