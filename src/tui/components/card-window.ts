/**
 * card-window.ts - 日志卡片行预算测量与窗口切片（纯函数，可单测）
 *
 * 背景：Ink 不裁剪纵向溢出（`overflow="hidden"` 对渲染无约束），
 * ScrollableBox 只能按“张数”切片。卡片高度可变（折叠 4~6 行、展开几十行、
 * 长行按列宽换行），按张数切必然撑开页面、把顶部顶出视口。
 *
 * 本模块用与 Ink 完全相同的换行管线做行数测量：
 * - 换行：`wrapAnsi(text, width, { trim: false, hard: true })`
 *   （即 `ink/build/wrap-text.js` 中 wrapType='wrap' 的分支，Text 默认值）；
 * - 行数：换行后按 `\n` 计数（即 `ink/build/measure-text.js` 的 height 语义）；
 * - 宽度：`string-width`（与 `widest-line` 同源，CJK/emoji/ANSI 语义一致）。
 *
 * 预算语义：调用方给出行预算（右栏可用行数），`sliceCardWindow`
 * 返回恰好装得下的卡片；单张超大卡截断其可展开区域并打标，保证
 * 渲染总行数恒 ≤ 预算（页面不撑屏、顶部恒可达）。
 */

import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

import { parseTimings } from './TimingsBar.js';
import {
  formatDetail,
  formatTime,
  formatTimeFull,
  isErrorEntry,
  pad,
  truncate,
  type ErrorContextWindow,
} from './logs-page-utils.js';
import type { LogEntry } from '@core/logger/index.js';

// ============================================================
// 基础行测量
// ============================================================

/** 显示宽度（ANSI 零宽，CJK 按 2 列；与 Ink 测量语义一致）。 */
export function displayWidth(text: string): number {
  return stringWidth(text);
}

/**
 * 文本在给定内容宽度下的渲染行数（与 Ink 逐字一致）。
 *
 * Ink 管线：yoga 以可用宽约束调用 measure → wrapAnsi(hard) 换行 → 按 \n 计数。
 * 空串按 0 行计（与 measure-text.js 一致）。
 */
export function wrapRowCount(text: string, width: number): number {
  if (text.length === 0) return 0;
  const safeWidth = Math.max(1, Math.floor(width));
  return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n').length;
}

/** 按行换行（与 wrapRowCount 同管线，返回换行后的行数组，供截断消费）。 */
export function wrapLines(text: string, width: number): string[] {
  // 注意：空逻辑行占 1 行（'a\n' 在 Ink 里是 2 行；整串为空串时 Ink 计 0 行，
  // 该情况由 wrapRowCount 覆盖，此处调用方只处理 split 后的行）。
  if (text.length === 0) return [''];
  const safeWidth = Math.max(1, Math.floor(width));
  return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n');
}

/** 按显示宽度截断并追加省略号（保证单行，不断宽字符）。 */
export function truncateToWidth(text: string, width: number): string {
  const w = Math.max(1, Math.floor(width));
  if (stringWidth(text) <= w) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const cw = stringWidth(ch);
    if (used + cw > w - 1) break;
    out += ch;
    used += cw;
  }
  return `${out}…`;
}

// ============================================================
// 卡片行计划
// ============================================================

/** 卡片各区域的行计划（渲染侧按此消费，不再自行截断）。 */
export type CardLinePlan = {
  /** 卡头行数（通常 1，窄终端可换行；渲染侧仍走 <Text wrap> 原样渲染） */
  headerRows: number;
  /** 消息展示行（已换行+切片，直接 join('\n') 渲染） */
  messageLines: string[];
  /** 折叠态隐藏的原始行数（展开态/短消息为 0；截断标记计数用） */
  messageHiddenRaw: number;
  /** 消息截断标记行（null = 无截断；折叠态为原生的 more 提示） */
  messageMore: string | null;
  /** Timings 区行数（0 = 无；原子 inclusion，不足则整体丢弃） */
  timingsRows: number;
  /** 错误行（已换行+切片） */
  errorLines: string[];
  /** 详情头行（`── detail @ … ──`，换行后行数组，原子 inclusion） */
  detailHeaderLines: string[];
  /** 详情 JSON 行（已换行+切片，仅展开态） */
  detailLines: string[];
  /** 详情截断标记行（null = 无截断） */
  detailMore: string | null;
  /** 错误上下文条目（已按 cap 切分，渲染侧原样 map） */
  contextBefore: LogEntry[];
  contextAfter: LogEntry[];
  /** 上下文铬行数（marginTop 1 + 标题 1 + 定位行；0 = 无上下文区） */
  contextChromeRows: number;
  /** 上下文截断标记行（null = 无截断） */
  contextMore: string | null;
  /** 卡片固定铬：下边框 1 + marginBottom 1 */
  chromeRows: number;
  /** 是否被截断（任一标记非空） */
  truncated: boolean;
};

export type MeasureCardOpts = {
  /** 卡片文本区宽度（列数，见 LogsPage 右栏账本） */
  contentWidth: number;
  /** 是否展开 */
  isExpanded: boolean;
  /** 错误上下文窗口（仅展开的错误卡片） */
  contextWindow: ErrorContextWindow | null;
  /** 相对耗时串（与渲染侧同一计算，如 `<+1.2s>`，无则 ''） */
  relativeTimeStr: string;
  /** 是否当前聚焦卡（▶ 标记，不影响宽度） */
  isCurrentCard: boolean;
};

/** 错误上下文定位行（与 ErrorContextSection 逐字对应，paddingLeft 2 由调用方折宽度）。 */
export function locatorText(error: LogEntry): string {
  return `▼ ${formatTime(error.timestamp)} | ${error.level} | ${error.scope} | ${truncate(error.message, 64)}`;
}

/** 上下文行（与 ContextLine 逐字对应，paddingLeft 2 由调用方折宽度）。 */
export function contextLineText(entry: LogEntry): string {
  return `│ ${formatTime(entry.timestamp)} | ${entry.level} | ${truncate(entry.scope, 12)} | ${truncate(entry.message, 64)}`;
}

/** Timings 4 段行的文本（与 TimingsBar 逐字对应：label 10 + bar 32 + 数值）。 */
function timingsSegmentLines(timings: {
  preHookMs: number;
  permissionMs: number;
  toolMs: number;
  postHookMs: number;
  totalMs: number;
}): string[] {
  const total = Math.max(timings.totalMs, 1);
  const segs: Array<[string, number]> = [
    ['preHook', timings.preHookMs],
    ['permission', timings.permissionMs],
    ['tool', timings.toolMs],
    ['postHook', timings.postHookMs],
  ];
  return segs.map(([label, ms]) => {
    const pct = (ms / total) * 100;
    const barWidth = Math.max(1, Math.round((ms / timings.totalMs) * 32));
    const bar = '▓'.repeat(barWidth) + '░'.repeat(Math.max(0, 32 - barWidth));
    return `  ${label.padEnd(10, ' ')}${bar} ${String(ms).padStart(4, ' ')}ms (${pct.toFixed(1)}%)`;
  });
}

/**
 * 测量单张卡片（完整计划，不截断；截断由 sliceCardWindow 对首卡执行）。
 *
 * currentCard 标记不占宽；颜色/highlight 不占宽；paddingLeft 缩进计入宽度。
 */
export function measureCard(entry: LogEntry, opts: MeasureCardOpts): CardLinePlan {
  const w = Math.max(8, Math.floor(opts.contentWidth));
  const indentPad = entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0;
  const textW = Math.max(4, w - indentPad);

  // ---- 卡头（与渲染 JSX 同序拼接，pad 用同一实现） ----
  const marker = opts.isCurrentCard ? '▶ ' : '  ';
  const turnMarker =
    entry.turn !== undefined ? (entry.step === 0 ? `▼ T${entry.turn} ` : entry.step ? ' ├─ ' : ' │ ') : '';
  const kind = ((entry.data as Record<string, unknown> | undefined)?.kind as string | undefined) ?? '-';
  const headerText =
    `${marker}${turnMarker}${formatTime(entry.timestamp)}` +
    (opts.relativeTimeStr ? ` ${opts.relativeTimeStr}` : '') +
    ` | ${entry.level.padEnd(5)} | ${pad(entry.scope, 10)} | ${kind}`;
  const headerRows = Math.max(1, wrapRowCount(headerText, w));

  // ---- 消息（折叠态最多 5 原始行 + 1 提示行；各行按 textW 换行） ----
  const rawLines = entry.message.split('\n');
  const collapsed = !opts.isExpanded && rawLines.length > 5;
  const shownRaw = collapsed ? rawLines.slice(0, 5) : rawLines;
  const messageLines: string[] = [];
  for (const ln of shownRaw) {
    messageLines.push(...wrapLines(ln, textW));
  }
  const messageMore = collapsed
    ? `... (${rawLines.length - 5} more lines, press Enter to expand)`
    : null;

  // ---- Timings（原子：marginTop 1 + 标题 1 + 4 段行，各自换行测量） ----
  const timings = parseTimings(entry.data);
  let timingsRows = 0;
  if (timings) {
    timingsRows =
      1 +
      wrapRowCount(`timings (total: ${timings.totalMs}ms):`, w) +
      timingsSegmentLines(timings).reduce((sum, ln) => sum + Math.max(1, wrapRowCount(ln, w)), 0);
  }

  // ---- 错误行 ----
  const errorLines: string[] = [];
  if (entry.error) {
    errorLines.push(...wrapLines(`✗ ${entry.error.name}: ${entry.error.message}`, textW));
  }

  // ---- 展开详情 JSON（头原子 + JSON 行） ----
  const detailHeaderLines: string[] = [];
  const detailLines: string[] = [];
  if (opts.isExpanded) {
    detailHeaderLines.push(...wrapLines(`── detail @ ${formatTimeFull(entry.timestamp)} ──`, textW));
    for (const ln of formatDetail(entry).split('\n')) {
      detailLines.push(...wrapLines(ln, textW));
    }
  }

  // ---- 错误上下文（条目原样保留，行数由调用方按 wrap 展开计算） ----
  let contextBefore: LogEntry[] = [];
  let contextAfter: LogEntry[] = [];
  let contextChromeRows = 0;
  if (opts.isExpanded && opts.contextWindow && isErrorEntry(entry)) {
    contextBefore = [...opts.contextWindow.before];
    contextAfter = [...opts.contextWindow.after];
    contextChromeRows =
      1 + // marginTop
      wrapRowCount(`── context ↑${contextBefore.length} ↓${contextAfter.length} ──`, textW) +
      wrapRowCount(`  ${locatorText(opts.contextWindow.error)}`, w);
  }

  return {
    headerRows,
    messageLines,
    messageMore,
    messageHiddenRaw: collapsed ? rawLines.length - 5 : 0,
    timingsRows,
    errorLines,
    detailHeaderLines,
    detailLines,
    detailMore: null,
    contextBefore,
    contextAfter,
    contextChromeRows,
    contextMore: null,
    chromeRows: 2, // borderBottom 1 + marginBottom 1
    truncated: false,
  };
}

/** 上下文条目总行数（paddingLeft 2 折进字符串后按整宽测量）。 */
function contextEntriesRows(entries: LogEntry[], contentWidth: number): number {
  const w = Math.max(4, Math.floor(contentWidth));
  let rows = 0;
  for (const e of entries) {
    rows += Math.max(1, wrapRowCount(`  ${contextLineText(e)}`, w));
  }
  return rows;
}

/** 计划总行数。 */
export function planRows(plan: CardLinePlan, contentWidth: number): number {
  return (
    plan.headerRows +
    plan.messageLines.length +
    (plan.messageMore ? 1 : 0) +
    plan.timingsRows +
    plan.errorLines.length +
    plan.detailHeaderLines.length +
    plan.detailLines.length +
    (plan.detailMore ? 1 : 0) +
    plan.contextChromeRows +
    contextEntriesRows(plan.contextBefore, contentWidth) +
    contextEntriesRows(plan.contextAfter, contentWidth) +
    (plan.contextMore ? 1 : 0) +
    plan.chromeRows
  );
}

// ============================================================
// 窗口切片
// ============================================================

export type CardWindowItem = {
  /** 卡片在 sessionCards 中的下标 */
  index: number;
  /** 行计划（truncated 区域已按 cap 切好，渲染侧直接消费） */
  plan: CardLinePlan;
  /** 本卡实际渲染行数 */
  rows: number;
};

export type SliceWindowOpts = {
  contentWidth: number;
  budgetRows: number;
  isExpanded: (index: number) => boolean;
  contextWindowOf: (index: number) => ErrorContextWindow | null;
  relativeTimeOf: (index: number) => string;
  isCurrentCard: (index: number) => boolean;
};

/**
 * 按行预算切窗口（替代按张数切）。
 *
 * - 从 startIndex 起按序装卡，装得下整卡则整卡装；
 * - 首卡单张超预算：截断其可展开区域（消息 > 错误 > 详情 > 上下文；timings 原子丢弃）
 *   硬塞进预算并打标；
 * - 非首卡装不下：窗口在此结束；
 * - 恒保证返回 ≥1 张（空 entries 除外）。
 */
export function sliceCardWindow(
  entries: LogEntry[],
  startIndex: number,
  opts: SliceWindowOpts
): CardWindowItem[] {
  const budget = Math.max(1, Math.floor(opts.budgetRows));
  const out: CardWindowItem[] = [];
  let used = 0;
  const start = entries.length === 0 ? 0 : Math.max(0, Math.min(startIndex, entries.length - 1));

  for (let i = start; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const plan = measureCard(entry, {
      contentWidth: opts.contentWidth,
      isExpanded: opts.isExpanded(i),
      contextWindow: opts.contextWindowOf(i),
      relativeTimeStr: opts.relativeTimeOf(i),
      isCurrentCard: opts.isCurrentCard(i),
    });
    const rows = planRows(plan, opts.contentWidth);
    if (used + rows <= budget) {
      out.push({ index: i, plan, rows });
      used += rows;
      continue;
    }
    if (out.length === 0) {
      const capped = capPlanToBudget(plan, budget, opts.contentWidth);
      out.push({ index: i, plan: capped.plan, rows: capped.rows });
    }
    break;
  }
  return out;
}

/**
 * 把计划截到预算内（优先级：卡头 > 消息 > 错误 > timings原子 > 详情 > 上下文）。
 *
 * 每个可展开区域独立打标（`… (N more lines)`，N = 被截渲染行 + 折叠隐藏原始行）；
 * marker 行计入预算；timings 装不下整体丢弃（标题区已有 x-y of N 计数）。
 */
function capPlanToBudget(
  plan: CardLinePlan,
  budget: number,
  contentWidth: number
): { plan: CardLinePlan; rows: number } {
  const fixed = plan.headerRows + plan.chromeRows;
  let remaining = Math.max(0, budget - fixed);
  const next: CardLinePlan = {
    ...plan,
    messageLines: [],
    messageMore: null,
    messageHiddenRaw: 0,
    timingsRows: 0,
    errorLines: [],
    detailHeaderLines: [],
    detailLines: [],
    detailMore: null,
    contextBefore: [],
    contextAfter: [],
    contextChromeRows: 0,
    contextMore: null,
    truncated: true,
  };

  // 取行数组：全装下则全取（+ 原生 marker，行数一并扣除）；否则留 1 行给截断标记。
  // 无内容可取时不消费预算；预算已耗尽则静默丢弃——保证渲染总行数恒 ≤ 预算。
  const takeLines = (
    lines: string[],
    rawHidden: number,
    nativeMore: string | null
  ): { kept: string[]; more: string | null } => {
    if (lines.length === 0 && rawHidden === 0 && !nativeMore) return { kept: [], more: null };
    if (remaining <= 0) return { kept: [], more: null };
    if (lines.length === 0 && nativeMore) {
      remaining -= 1;
      return { kept: [], more: nativeMore };
    }
    if (lines.length + (nativeMore ? 1 : 0) <= remaining) {
      remaining -= lines.length + (nativeMore ? 1 : 0);
      return { kept: lines, more: nativeMore };
    }
    const kept = lines.slice(0, Math.max(0, remaining - 1));
    const hidden = lines.length - kept.length + rawHidden;
    remaining = 0;
    return { kept, more: `… (${hidden} more lines)` };
  };

  // 消息
  const msg = takeLines(plan.messageLines, plan.messageHiddenRaw, plan.messageMore);
  next.messageLines = msg.kept;
  next.messageMore = msg.more;

  // 错误
  const err = takeLines(plan.errorLines, 0, null);
  next.errorLines = err.kept;
  if (err.more) {
    // 错误区被截：marker 并入错误行末（不再占额外行，行数已在 takeLines 预留）
    next.errorLines = [...err.kept, err.more];
  }

  // timings 原子 inclusion
  if (plan.timingsRows > 0 && plan.timingsRows <= remaining) {
    next.timingsRows = plan.timingsRows;
    remaining -= plan.timingsRows;
  }

  // 详情（头原子 + JSON 切片；头装不下则整个区丢弃，行数不够打标时静默）
  if (plan.detailHeaderLines.length > 0 || plan.detailLines.length > 0) {
    if (plan.detailHeaderLines.length <= remaining) {
      next.detailHeaderLines = plan.detailHeaderLines;
      remaining -= plan.detailHeaderLines.length;
      const det = takeLines(plan.detailLines, 0, null);
      next.detailLines = det.kept;
      next.detailMore = det.more;
    } else if (remaining > 0) {
      const hidden =
        plan.detailHeaderLines.length +
        plan.detailLines.length +
        (plan.detailMore ? 1 : 0);
      next.detailMore = `… (${hidden} more lines)`;
      remaining -= 1;
    }
  }

  // 上下文：铬（margin+标题+定位）必须整装，否则整个区丢弃；条目逐条装
  const w = Math.max(4, Math.floor(contentWidth));
  if (plan.contextChromeRows > 0 && plan.contextChromeRows <= remaining) {
    let ctxUsed = plan.contextChromeRows;
    const takeEntries = (entries: LogEntry[]): LogEntry[] => {
      const kept: LogEntry[] = [];
      for (const e of entries) {
        const r = Math.max(1, wrapRowCount(`  ${contextLineText(e)}`, w));
        // 条目 + 可能的 marker 行都必须装下
        if (ctxUsed + r + 1 > remaining) break;
        kept.push(e);
        ctxUsed += r;
      }
      return kept;
    };
    next.contextBefore = takeEntries(plan.contextBefore);
    next.contextAfter = takeEntries(plan.contextAfter);
    const dropped =
      plan.contextBefore.length -
      next.contextBefore.length +
      (plan.contextAfter.length - next.contextAfter.length);
    if (next.contextBefore.length > 0 || next.contextAfter.length > 0) {
      next.contextChromeRows = plan.contextChromeRows;
      if (dropped > 0) {
        next.contextMore = `… (${dropped} more context entries)`;
        ctxUsed += 1;
      }
      remaining -= ctxUsed;
    }
  }

  const rows = planRows(next, contentWidth);
  return { plan: next, rows };
}
