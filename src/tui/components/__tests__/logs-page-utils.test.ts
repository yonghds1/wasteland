/**
 * logs-page.test.tsx - LogsPage 时间线视图测试
 *
 * 覆盖验收标准：
 * - 视图切换（toggleLogsView 纯逻辑 + LogsPage 初始视图渲染）
 * - buildToolTimeline 聚合：成功/失败状态、耗时、错误信息
 * - 健壮性：toolEnd 与 toolStart 不配对时的降级显示
 * - ToolTimeline 渲染：toolName / 耗时 / 状态 / 错误高亮
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEntry } from '@core/logger/index.js';
import {
  formatDuration,
  formatToolTime,
  isSlowCall,
  DEFAULT_SLOW_THRESHOLD_MS,
  type ToolCallRecord,
  type ToolCallStatus
} from '../ToolTimeline.js';
import {
  buildGlobalTimeline,
  aggregateToolStats,
  type GlobalToolCallRecord
} from '../GlobalTimeline.js';
import {
  toggleLogsView,
  toggleTimelineMode,
  toggleTimelineMetric,
  getShortcutHelp,
  entryMatchesKeyword,
  filterLogEntries,
  serializeData,
  countErrorEntries,
  findNextErrorIndex,
  getErrorContextWindow,
  getErrorContextWindowAt,
  cardKeyFor,
  transcriptToLogEntries,
  jumpOffset,
  cycleSessionIndex,
  scrollToReveal,
  DEFAULT_CONTEXT_RADIUS,
  formatTime,
  formatTimeFull,
  levelColor
} from '../LogsPage.js';
import {
  toExportLogEntry,
  serializeLogEntriesToMarkdown,
  serializeLogEntriesToJson,
  buildExportFileName,
  writeExportFile,
  exportLogEntries
} from '../log-export.js';
import {
  errIn,
  startIn,
  endIn,
  makeChronoEntries,
  exportSampleEntry
} from './logs-test-helpers.js';

describe('toggleLogsView', () => {
  it('switches between list and timeline', () => {
    expect(toggleLogsView('list')).toBe('timeline');
    expect(toggleLogsView('timeline')).toBe('list');
  });
});

// ============================================================
// buildToolTimeline 聚合
// ============================================================


describe('formatDuration', () => {
  it('formats milliseconds under 1000ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(123)).toBe('123ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds at and above 1000ms', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('shows placeholder for missing duration', () => {
    expect(formatDuration(undefined)).toBe('--');
    expect(formatDuration(Number.NaN)).toBe('--');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('--');
  });
});

describe('formatToolTime', () => {
  it('extracts HH:MM:SS.mmm from ISO timestamp', () => {
    expect(formatToolTime('2026-08-10T01:02:03.456Z')).toBe('01:02:03.456');
  });

  it('shows placeholder for missing timestamp', () => {
    expect(formatToolTime(undefined)).toBe('--');
  });
});

// ============================================================
// T12：卡片可读性 - 时间戳紧凑化 / level 配色映射（纯函数）
// ============================================================

describe('formatTime（卡片紧凑时间戳）', () => {
  it('丢弃毫秒，返回 HH:MM:SS', () => {
    expect(formatTime('2026-08-10T12:04:05.789Z')).toBe('12:04:05');
  });

  it('无毫秒的时间戳也正常解析', () => {
    expect(formatTime('2026-08-10T01:02:03Z')).toBe('01:02:03');
  });

  it('不可解析时回退为原值', () => {
    expect(formatTime('not-a-timestamp')).toBe('not-a-timestamp');
  });
});

describe('formatTimeFull（完整精度时间戳）', () => {
  it('保留毫秒，返回 HH:MM:SS.mmm', () => {
    expect(formatTimeFull('2026-08-10T12:04:05.789Z')).toBe('12:04:05.789');
  });

  it('不可解析时回退为原值', () => {
    expect(formatTimeFull('nope')).toBe('nope');
  });
});

describe('levelColor（level 配色映射，与主题系统一致）', () => {
  it('error → 主题 error 色', () => {
    expect(levelColor('error')).toBe('#D95738');
  });

  it('warn → 主题 warning 色', () => {
    expect(levelColor('warn')).toBe('#E0A33A');
  });

  it('info → 主题 info 色（区别于 warn/error 的细分色）', () => {
    expect(levelColor('info')).toBe('#6E9F9A');
  });

  it('debug → 主题 muted 色（弱化，低于 info 的视觉权重）', () => {
    expect(levelColor('debug')).toBe('#7D7468');
  });

  it('四个级别的颜色互不相同，视觉区分明显', () => {
    const colors = ['error', 'warn', 'info', 'debug'].map((l) =>
      levelColor(l as LogEntry['level']),
    );
    expect(new Set(colors).size).toBe(4);
  });
});

// ============================================================
// ToolTimeline 渲染
// ============================================================


describe('getShortcutHelp（按视图组装快捷键提示，纯函数）', () => {
  it('list 视图：列出通用按键，不含 timeline 专属 M/K', () => {
    const help = getShortcutHelp('list', 'session', 'calls');
    const keys = help.map((h) => h.keys);
    // 通用按键都在
    expect(keys).toContain('↑↓');
    expect(keys).toContain('Tab');
    expect(keys).toContain('N/B');
    expect(keys).toContain('Home/End');
    expect(keys).toContain('PgUp/PgDown');
    expect(keys).toContain('Enter');
    expect(keys).toContain('G');
    expect(keys).toContain('X');
    expect(keys).toContain('?');
    expect(keys).toContain('Esc');
    // timeline 专属按键不出现
    expect(keys).not.toContain('M');
    expect(keys).not.toContain('K');
  });

  it('timeline + session：追加 M（切换全局时间线），不含 K', () => {
    const help = getShortcutHelp('timeline', 'session', 'calls');
    const keys = help.map((h) => h.keys);
        expect(keys).not.toContain('K');
      });

  it('timeline + global + calls：追加 M 与 K，K 说明为切耗时分布', () => {
    const help = getShortcutHelp('timeline', 'global', 'calls');
    const keys = help.map((h) => h.keys);
        expect(keys).toContain('K');
        expect(help.find((h) => h.keys === 'K')?.description).toBe('切换耗时分布');
  });

  it('timeline + global + stats：K 说明为切调用时序', () => {
    const help = getShortcutHelp('timeline', 'global', 'stats');
    expect(help.find((h) => h.keys === 'K')?.description).toBe('切换调用时序');
  });

  it('所有视图组合的条目非空，且末尾恒为 Esc、? 在列表内', () => {
    for (const view of ['list', 'timeline'] as const) {
      for (const mode of ['session', 'global'] as const) {
        for (const metric of ['calls', 'stats'] as const) {
          const help = getShortcutHelp(view, mode, metric);
          expect(help.length).toBeGreaterThan(0);
          for (const h of help) {
            expect(h.keys.length).toBeGreaterThan(0);
            expect(h.description.length).toBeGreaterThan(0);
          }
          expect(help.at(-1)?.keys).toBe('Esc');
          expect(help.some((h) => h.keys === '?')).toBe(true);
        }
      }
    }
  });
});


describe('serializeData', () => {
  it('string 原样返回', () => {
    expect(serializeData('raw text payload')).toBe('raw text payload');
  });

  it('对象序列化为 JSON', () => {
    expect(serializeData({ kind: 'tool_start', toolName: 'read-file' })).toBe(
      '{"kind":"tool_start","toolName":"read-file"}',
    );
  });

  it('空值返回空串', () => {
    expect(serializeData(undefined)).toBe('');
    expect(serializeData(null)).toBe('');
  });
});

describe('entryMatchesKeyword', () => {
  const base: LogEntry = {
    version: 1,
    timestamp: '2026-08-10T01:00:00.000Z',
    level: 'info',
    scope: 'tool',
    sessionId: 's1',
    message: 'tool.start',
  };

  it('匹配 message 内容（大小写不敏感）', () => {
    expect(entryMatchesKeyword(base, 'tool')).toBe(true);
    expect(entryMatchesKeyword(base, 'START')).toBe(true);
    expect(entryMatchesKeyword(base, 'zzz')).toBe(false);
  });

  it('匹配 data 序列化内容', () => {
    const withData = { ...base, data: { kind: 'tool_start', toolName: 'read-file' } };
    expect(entryMatchesKeyword(withData, 'read-file')).toBe(true);
    expect(entryMatchesKeyword(withData, 'tool_start')).toBe(true);
    expect(entryMatchesKeyword(withData, 'write-doc')).toBe(false);
  });

  it('空关键字（含全空白）匹配所有条目', () => {
    expect(entryMatchesKeyword(base, '')).toBe(true);
    expect(entryMatchesKeyword(base, '   ')).toBe(true);
  });
});

describe('filterLogEntries（level + 关键字叠加）', () => {
  const entries: LogEntry[] = [
    { version: 1, timestamp: 't1', level: 'info', scope: 'tool', sessionId: 's1', message: 'read start' },
    { version: 1, timestamp: 't2', level: 'error', scope: 'tool', sessionId: 's1', message: 'read boom' },
    { version: 1, timestamp: 't3', level: 'debug', scope: 'session', sessionId: 's1', message: 'read verbose' },
    { version: 1, timestamp: 't4', level: 'info', scope: 'session', sessionId: 's1', message: 'hello world' },
  ];

  it('仅按关键字过滤时不过滤 level', () => {
    expect(filterLogEntries(entries, { keyword: 'read' }).map((e) => e.timestamp)).toEqual([
      't1',
      't2',
      't3',
    ]);
  });

  it('关键字与 level 叠加（两者同时生效）', () => {
    expect(
      filterLogEntries(entries, { minLevel: 'info', keyword: 'read' }).map((e) => e.timestamp),
    ).toEqual(['t1', 't2']);
  });

  it('提高 minLevel 后进一步缩小范围', () => {
    expect(
      filterLogEntries(entries, { minLevel: 'warn', keyword: 'read' }).map((e) => e.timestamp),
    ).toEqual(['t2']);
  });

  it('无匹配时返回空数组', () => {
    expect(filterLogEntries(entries, { keyword: 'zzz' })).toEqual([]);
  });

  it('空关键字仅按 level 过滤', () => {
    expect(filterLogEntries(entries, { minLevel: 'warn' }).map((e) => e.timestamp)).toEqual(['t2']);
  });

  it('focusErrors 只保留 warn/error 条目', () => {
    expect(
      filterLogEntries(entries, { focusErrors: true }).map((e) => e.timestamp),
    ).toEqual(['t2']);
  });

  it('focusErrors 与 level 过滤叠加（取两者交集）', () => {
    expect(
      filterLogEntries(entries, { minLevel: 'info', focusErrors: true }).map((e) => e.timestamp),
    ).toEqual(['t2']);
  });

  it('focusErrors 与关键字过滤叠加', () => {
    expect(
      filterLogEntries(entries, { keyword: 'read', focusErrors: true }).map((e) => e.timestamp),
    ).toEqual(['t2']);
  });

  it('focusErrors 无 warn/error 时返回空数组', () => {
    const onlyDebug = entries.filter((e) => e.level === 'debug');
    expect(filterLogEntries(onlyDebug, { focusErrors: true })).toEqual([]);
  });
});

// ============================================================
// T8：countErrorEntries / findNextErrorIndex（纯函数）
// ============================================================

describe('countErrorEntries', () => {
  it('统计 warn/error 条目数，忽略 debug/info', () => {
    const entries: LogEntry[] = [
      { version: 1, timestamp: 't1', level: 'info', scope: 'tool', sessionId: 's1', message: 'a' },
      { version: 1, timestamp: 't2', level: 'warn', scope: 'tool', sessionId: 's1', message: 'b' },
      { version: 1, timestamp: 't3', level: 'error', scope: 'tool', sessionId: 's1', message: 'c' },
      { version: 1, timestamp: 't4', level: 'debug', scope: 'session', sessionId: 's1', message: 'd' },
      { version: 1, timestamp: 't5', level: 'warn', scope: 'session', sessionId: 's1', message: 'e' },
    ];
    expect(countErrorEntries(entries)).toBe(3);
  });

  it('空数组返回 0', () => {
    expect(countErrorEntries([])).toBe(0);
  });

  it('全部非错误时返回 0', () => {
    const entries: LogEntry[] = [
      { version: 1, timestamp: 't1', level: 'info', scope: 'tool', sessionId: 's1', message: 'a' },
      { version: 1, timestamp: 't2', level: 'debug', scope: 'tool', sessionId: 's1', message: 'b' },
    ];
    expect(countErrorEntries(entries)).toBe(0);
  });
});

describe('findNextErrorIndex', () => {
  // 显示顺序（最新在上）：idx0=error, idx1=info, idx2=warn, idx3=error, idx4=info
  const entries: LogEntry[] = [
    { version: 1, timestamp: 't5', level: 'error', scope: 'tool', sessionId: 's1', message: 'e1' },
    { version: 1, timestamp: 't4', level: 'info', scope: 'tool', sessionId: 's1', message: 'i1' },
    { version: 1, timestamp: 't3', level: 'warn', scope: 'tool', sessionId: 's1', message: 'w1' },
    { version: 1, timestamp: 't2', level: 'error', scope: 'tool', sessionId: 's1', message: 'e2' },
    { version: 1, timestamp: 't1', level: 'info', scope: 'session', sessionId: 's1', message: 'i2' },
  ];

  it('向下找到下一条错误（warn/error）', () => {
    expect(findNextErrorIndex(entries, -1, 1)).toBe(0); // 从顶部之前开始 → 第一条
    expect(findNextErrorIndex(entries, 0, 1)).toBe(2);
    expect(findNextErrorIndex(entries, 1, 1)).toBe(2);
    expect(findNextErrorIndex(entries, 2, 1)).toBe(3);
    expect(findNextErrorIndex(entries, 3, 1)).toBe(-1); // 到底没有更多
  });

  it('向上找到上一条错误', () => {
    expect(findNextErrorIndex(entries, 4, -1)).toBe(3);
    expect(findNextErrorIndex(entries, 3, -1)).toBe(2);
    expect(findNextErrorIndex(entries, 2, -1)).toBe(0);
    expect(findNextErrorIndex(entries, 1, -1)).toBe(0);
    expect(findNextErrorIndex(entries, 0, -1)).toBe(-1); // 到顶没有更多
  });

  it('起始位置本身是错误时不重复返回自身（跳过当前）', () => {
    expect(findNextErrorIndex(entries, 2, -1)).toBe(0);
    expect(findNextErrorIndex(entries, 2, 1)).toBe(3);
  });

  it('空数组返回 -1', () => {
    expect(findNextErrorIndex([], 0, 1)).toBe(-1);
    expect(findNextErrorIndex([], 0, -1)).toBe(-1);
  });
});

// ============================================================
// T13：导航增强纯函数 - jumpOffset / cycleSessionIndex / scrollToReveal
// ============================================================

describe('jumpOffset（跳转到日志流最早/最晚位置的滚动偏移）', () => {
  it('latest → 顶部偏移 0（cards 最新在上）', () => {
    expect(jumpOffset(10, 6, 'latest')).toBe(0);
    expect(jumpOffset(0, 6, 'latest')).toBe(0);
  });

  it('earliest → 底部偏移 total - visible', () => {
    expect(jumpOffset(10, 6, 'earliest')).toBe(4);
    expect(jumpOffset(6, 6, 'earliest')).toBe(0); // 恰好一屏，无可滚动
  });

  it('空列表返回 0（无可跳转）', () => {
    expect(jumpOffset(0, 6, 'earliest')).toBe(0);
    expect(jumpOffset(0, 6, 'latest')).toBe(0);
  });

  it('visible 大于 total 时 clamp 到 0', () => {
    expect(jumpOffset(3, 10, 'earliest')).toBe(0);
  });
});

describe('cycleSessionIndex（当前 filter 下循环下一个/上一个 session）', () => {
  it('下一个循环：尾部环绕回 0', () => {
    expect(cycleSessionIndex(0, 3, 1)).toBe(1);
    expect(cycleSessionIndex(1, 3, 1)).toBe(2);
    expect(cycleSessionIndex(2, 3, 1)).toBe(0);
  });

  it('上一个循环：头部环绕回尾部', () => {
    expect(cycleSessionIndex(0, 3, -1)).toBe(2);
    expect(cycleSessionIndex(1, 3, -1)).toBe(0);
    expect(cycleSessionIndex(2, 3, -1)).toBe(1);
  });

  it('空列表返回 0（占位，外层 clamp 兜底）', () => {
    expect(cycleSessionIndex(0, 0, 1)).toBe(0);
    expect(cycleSessionIndex(2, 0, -1)).toBe(0);
  });

  it('单条 session 恒为 0', () => {
    expect(cycleSessionIndex(0, 1, 1)).toBe(0);
    expect(cycleSessionIndex(0, 1, -1)).toBe(0);
  });
});

describe('scrollToReveal（滚动联动：保证选中行进入可见窗口）', () => {
  it('选中已在窗口内：保持原偏移（不扰动已稳定视图）', () => {
    expect(scrollToReveal(3, 4, 6, 20)).toBe(3);
    expect(scrollToReveal(0, 0, 6, 20)).toBe(0);
    expect(scrollToReveal(5, 10, 6, 20)).toBe(5);
  });

  it('选中在窗口上方：滚到选中项置于窗口顶', () => {
    expect(scrollToReveal(6, 2, 6, 20)).toBe(2);
    expect(scrollToReveal(10, 0, 6, 20)).toBe(0);
  });

  it('选中在窗口下方：滚到选中项置于窗口底', () => {
    // offset + visibleCount = 3 + 6 = 9，selected 10 在窗口下方
    expect(scrollToReveal(3, 10, 6, 20)).toBe(5); // 10 - 6 + 1
  });

  it('窗口下方越界时 clamp 到 maxOffset', () => {
    // total - visible = 14，selected 19 应 clamp 到 14
    expect(scrollToReveal(10, 19, 6, 20)).toBe(14);
  });

  it('空列表返回 0', () => {
    expect(scrollToReveal(0, 0, 6, 0)).toBe(0);
    expect(scrollToReveal(5, 3, 6, 0)).toBe(0);
  });
});

// ============================================================
// T6：LogsPage 关键字搜索（键盘 + 渲染集成，mock 磁盘加载）
// ============================================================

/** 构造磁盘 session 摘要（mock 数据）。 */

describe('isSlowCall', () => {
  const base: ToolCallRecord = {
    toolName: 'bash',
    startTime: '2026-08-10T01:00:00.000Z',
    endTime: '2026-08-10T01:00:01.000Z',
    durationMs: 1000,
    status: 'success',
  };

  it('耗时超过默认阈值（>5000ms）视为慢调用', () => {
    expect(isSlowCall({ ...base, durationMs: 5001 })).toBe(true);
    expect(isSlowCall({ ...base, durationMs: 6000 })).toBe(true);
  });

  it('耗时未超过默认阈值不算慢调用', () => {
    expect(isSlowCall({ ...base, durationMs: 1000 })).toBe(false);
    expect(isSlowCall({ ...base, durationMs: 4999 })).toBe(false);
  });

  it('恰好等于阈值不算慢调用（严格超过）', () => {
    expect(isSlowCall({ ...base, durationMs: DEFAULT_SLOW_THRESHOLD_MS })).toBe(false);
  });

  it('无耗时（started / 数据缺失）不算慢调用', () => {
    const noDuration: ToolCallRecord = { toolName: 'bash', startTime: 't0', status: 'started' };
    expect(isSlowCall(noDuration)).toBe(false);
    expect(isSlowCall({ ...base, durationMs: undefined })).toBe(false);
  });

  it('阈值可被覆盖', () => {
    expect(isSlowCall({ ...base, durationMs: 200 }, 100)).toBe(true);
    expect(isSlowCall({ ...base, durationMs: 200 }, 500)).toBe(false);
  });
});


describe('DEFAULT_CONTEXT_RADIUS', () => {
  it('默认前后各 5 条', () => {
    expect(DEFAULT_CONTEXT_RADIUS).toBe(5);
  });
});

describe('getErrorContextWindow', () => {
  it('默认 radius=5：返回错误前后各 5 条，不含错误自身', () => {
    const entries = makeChronoEntries({ count: 11, errorAt: 6 });
    const window = getErrorContextWindow(entries, '2026-08-10T01:00:06.000Z');
    expect(window).not.toBeNull();
    expect(window!.error.message).toBe('step-6');
    expect(window!.before.map((e) => e.message)).toEqual([
      'step-1',
      'step-2',
      'step-3',
      'step-4',
      'step-5',
    ]);
    expect(window!.after.map((e) => e.message)).toEqual([
      'step-7',
      'step-8',
      'step-9',
      'step-10',
      'step-11',
    ]);
    // before / after 不含错误条目自身
    expect(window!.before.some((e) => e.timestamp === window!.error.timestamp)).toBe(false);
    expect(window!.after.some((e) => e.timestamp === window!.error.timestamp)).toBe(false);
  });

  it('radius 可配：前后各取 radius 条', () => {
    const entries = makeChronoEntries({ count: 11, errorAt: 6 });
    const window = getErrorContextWindow(entries, '2026-08-10T01:00:06.000Z', 2);
    expect(window!.before.map((e) => e.message)).toEqual(['step-4', 'step-5']);
    expect(window!.after.map((e) => e.message)).toEqual(['step-7', 'step-8']);
  });

  it('流首边界截断：错误在第一条时 before 为空，after 仍取 radius 条', () => {
    const entries = makeChronoEntries({ count: 11, errorAt: 1 });
    const window = getErrorContextWindow(entries, '2026-08-10T01:00:01.000Z');
    expect(window!.before).toEqual([]);
    expect(window!.after.map((e) => e.message)).toEqual([
      'step-2',
      'step-3',
      'step-4',
      'step-5',
      'step-6',
    ]);
  });

  it('流尾边界截断：错误在最后一条时 after 为空，before 仍取 radius 条', () => {
    const entries = makeChronoEntries({ count: 11, errorAt: 11 });
    const window = getErrorContextWindow(entries, '2026-08-10T01:00:11.000Z');
    expect(window!.after).toEqual([]);
    expect(window!.before.map((e) => e.message)).toEqual([
      'step-6',
      'step-7',
      'step-8',
      'step-9',
      'step-10',
    ]);
  });

  it('窗口不足 radius 条时返回可用部分（count < radius*2+1）', () => {
    const entries = makeChronoEntries({ count: 5, errorAt: 3 });
    const window = getErrorContextWindow(entries, '2026-08-10T01:00:03.000Z');
    expect(window!.before.map((e) => e.message)).toEqual(['step-1', 'step-2']);
    expect(window!.after.map((e) => e.message)).toEqual(['step-4', 'step-5']);
  });

  it('找不到指定时间戳时返回 null', () => {
    const entries = makeChronoEntries({ count: 11, errorAt: 6 });
    expect(getErrorContextWindow(entries, '2026-08-10T99:00:00.000Z')).toBeNull();
    expect(getErrorContextWindow([], '2026-08-10T01:00:06.000Z')).toBeNull();
  });

  it('同毫秒多条时仍定位到第一条（兼容旧行为）', () => {
    const ts = '2026-08-10T01:00:06.000Z';
    const entries = [
      { ...makeChronoEntries({ count: 1, errorAt: 1 })[0]!, timestamp: ts, message: 'first' },
      { ...makeChronoEntries({ count: 1, errorAt: 1 })[0]!, timestamp: ts, message: 'second' },
    ];
    const window = getErrorContextWindow(entries, ts);
    expect(window!.error.message).toBe('first');
  });
});

describe('getErrorContextWindowAt', () => {
  it('按下标精确定位（同毫秒第二条）', () => {
    const ts = '2026-08-10T01:00:06.000Z';
    const entries = [
      { ...makeChronoEntries({ count: 1, errorAt: 1 })[0]!, timestamp: ts, message: 'first' },
      { ...makeChronoEntries({ count: 1, errorAt: 1 })[0]!, timestamp: ts, message: 'second' },
      { ...makeChronoEntries({ count: 1, errorAt: 1 })[0]!, timestamp: '2026-08-10T01:00:07.000Z', message: 'third' },
    ];
    const window = getErrorContextWindowAt(entries, 1, 1);
    expect(window!.error.message).toBe('second');
    expect(window!.before.map((e) => e.message)).toEqual(['first']);
    expect(window!.after.map((e) => e.message)).toEqual(['third']);
  });

  it('下标越界返回 null', () => {
    const entries = makeChronoEntries({ count: 3, errorAt: 2 });
    expect(getErrorContextWindowAt(entries, -1)).toBeNull();
    expect(getErrorContextWindowAt(entries, 3)).toBeNull();
    expect(getErrorContextWindowAt([], 0)).toBeNull();
  });
});

describe('cardKeyFor', () => {
  it('有 seq 时用 seq（全局唯一）', () => {
    const [entry] = makeChronoEntries({ count: 1, errorAt: 1 });
    expect(cardKeyFor({ ...entry!, seq: 42 }, 0)).toBe('seq:42');
    expect(cardKeyFor({ ...entry!, seq: 42 }, 7)).toBe('seq:42');
  });

  it('无 seq 时用 timestamp + 同毫秒序号区分', () => {
    const [entry] = makeChronoEntries({ count: 1, errorAt: 1 });
    const ts = entry!.timestamp;
    expect(cardKeyFor({ ...entry!, seq: undefined }, 0)).toBe(`ts:${ts}#0`);
    expect(cardKeyFor({ ...entry!, seq: undefined }, 1)).toBe(`ts:${ts}#1`);
  });
});

describe('transcriptToLogEntries', () => {
  it('只取 message 记录，非 message 丢弃', () => {
    const entries = transcriptToLogEntries(
      [
        { type: 'message', role: 'user', turn: 1, content: '列出目录', timestamp: '2026-08-10T01:00:01.000Z' },
        { type: 'tool_call', sessionId: 's', turn: 1, callId: 'c1', toolName: 'bash', input: {}, timestamp: '2026-08-10T01:00:02.000Z' },
        { type: 'message', role: 'assistant', turn: 1, content: '好的', timestamp: '2026-08-10T01:00:03.000Z' },
      ],
      's1'
    );
    expect(entries.map((e) => e.message)).toEqual(['[user] 列出目录', '[assistant] 好的']);
    expect(entries[0]).toMatchObject({
      version: 1,
      level: 'info',
      scope: 'turn',
      sessionId: 's1',
      turn: 1,
      data: { kind: 'transcript', role: 'user' },
    });
  });

  it('空记录返回空数组', () => {
    expect(transcriptToLogEntries([], 's1')).toEqual([]);
  });
});


describe('toExportLogEntry', () => {
  it('从 data.kind 派生 kind，其余字段透传', () => {
    const exp = toExportLogEntry({
      version: 1,
      timestamp: '2026-08-10T01:00:00.000Z',
      level: 'error',
      scope: 'tool',
      sessionId: 's1',
      turn: 2,
      step: 3,
      message: 'read failed',
      data: { kind: 'tool_error', toolName: 'read-file' },
      error: { name: 'Error', message: 'boom' },
    });
    expect(exp).toEqual({
      timestamp: '2026-08-10T01:00:00.000Z',
      level: 'error',
      kind: 'tool_error',
      scope: 'tool',
      message: 'read failed',
      data: { kind: 'tool_error', toolName: 'read-file' },
      turn: 2,
      step: 3,
      error: { name: 'Error', message: 'boom' },
    });
  });

  it('data.kind 缺失或非字符串时省略 kind', () => {
    const base = exportSampleEntry('t1', 'info', 'hi');
    expect(toExportLogEntry({ ...base, data: undefined }).kind).toBeUndefined();
    expect(toExportLogEntry({ ...base, data: { kind: 42 } }).kind).toBeUndefined();
  });
});

describe('serializeLogEntriesToMarkdown', () => {
  it('markdown 表格含完整字段（timestamp/level/kind/message/data）', () => {
    const md = serializeLogEntriesToMarkdown(
      [
        exportSampleEntry('t1', 'info', 'start'),
        exportSampleEntry('t2', 'error', 'boom'),
      ],
      { sessionId: 's1', now: '2026-08-11T00:00:00.000Z' },
    );
    expect(md).toContain('# Session Log Export');
    expect(md).toContain('- session: s1');
    expect(md).toContain('- entries: 2');
    expect(md).toContain('| timestamp | level | kind | scope | message | data |');
    expect(md).toContain('| 1 | t1 | info | tool_error | tool | start | {"kind":"tool_error","toolName":"read-file"} |');
    expect(md).toContain('| 2 | t2 | error | tool_error | tool | boom | {"kind":"tool_error","toolName":"read-file"} |');
  });

  it('message/data 中的 | 被转义避免破坏表格', () => {
    const md = serializeLogEntriesToMarkdown([
      {
        version: 1,
        timestamp: 't1',
        level: 'info',
        scope: 'session',
        sessionId: 's1',
        message: 'a|b',
        data: { note: 'x|y' },
      },
    ]);
    expect(md).toContain('a\\|b');
    expect(md).toContain('{"note":"x\\|y"}');
  });

  it('空条目仍输出元信息与表头', () => {
    const md = serializeLogEntriesToMarkdown([], { sessionId: 's1' });
    expect(md).toContain('- entries: 0');
    expect(md).toContain('|---|---|---|---|---|---|---|');
  });
});

describe('serializeLogEntriesToJson', () => {
  it('输出结构化数组且含完整字段', () => {
    const json = serializeLogEntriesToJson([
      exportSampleEntry('t2', 'error', 'boom'),
      exportSampleEntry('t1', 'info', 'start'),
    ]);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      timestamp: 't2',
      level: 'error',
      kind: 'tool_error',
      scope: 'tool',
      message: 'boom',
      data: { kind: 'tool_error', toolName: 'read-file' },
    });
    expect(parsed[1]).toMatchObject({ timestamp: 't1', level: 'info', message: 'start' });
  });

  it('pretty=false 输出紧凑 JSON', () => {
    expect(serializeLogEntriesToJson([], { pretty: false })).toBe('[]');
  });
});

describe('buildExportFileName', () => {
  it('生成 <sessionId>-<时间戳>.<ext> 格式', () => {
    const now = new Date('2026-08-11T01:02:03.000Z');
    expect(buildExportFileName('s1', 'markdown', now)).toBe(
      's1-2026-08-11T01-02-03-000Z.md',
    );
    expect(buildExportFileName('s1', 'json', now)).toBe(
      's1-2026-08-11T01-02-03-000Z.json',
    );
  });

  it('非法字符替换为 _，空 sessionId 用默认名', () => {
    const name = buildExportFileName('a/b:c', 'json', new Date('2026-08-11T00:00:00.000Z'));
    expect(name).toBe('a_b_c-2026-08-11T00-00-00-000Z.json');
    const empty = buildExportFileName('', 'markdown', new Date('2026-08-11T00:00:00.000Z'));
    expect(empty).toBe('session-2026-08-11T00-00-00-000Z.md');
  });
});

describe('writeExportFile / exportLogEntries（临时目录）', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wasteland-export-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('写入文件并返回完整路径，目录不存在时自动创建', async () => {
    const nested = join(dir, 'nested', 'exports');
    const filePath = await writeExportFile({
      dir: nested,
      sessionId: 's1',
      format: 'markdown',
      content: '# hello',
      now: new Date('2026-08-11T01:02:03.000Z'),
    });
    expect(filePath).toBe(join(nested, 's1-2026-08-11T01-02-03-000Z.md'));
    expect(await readFile(filePath, 'utf8')).toBe('# hello');
  });

  it('exportLogEntries 序列化后写盘，JSON 可解析回数组', async () => {
    const filePath = await exportLogEntries({
      dir,
      sessionId: 's1',
      entries: [exportSampleEntry('t1', 'info', 'start')],
      format: 'json',
      now: new Date('2026-08-11T01:02:03.000Z'),
    });
    expect(filePath).toBe(join(dir, 's1-2026-08-11T01-02-03-000Z.json'));
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ timestamp: 't1', message: 'start' });
  });
});


describe('toggleTimelineMode / toggleTimelineMetric', () => {
  it('toggleTimelineMode switches between session and global', () => {
    expect(toggleTimelineMode('session')).toBe('global');
    expect(toggleTimelineMode('global')).toBe('session');
  });

  it('toggleTimelineMetric switches between calls and stats', () => {
    expect(toggleTimelineMetric('calls')).toBe('stats');
    expect(toggleTimelineMetric('stats')).toBe('calls');
  });
});

describe('buildGlobalTimeline', () => {
  it('merges records from multiple sessions into global time order', () => {
    const groups = [
      {
        sessionId: 's1',
        entries: [
          startIn('s1', 'bash', '2026-08-10T01:00:01.000Z'),
          endIn('s1', 'bash', '2026-08-10T01:00:02.000Z', 1000),
        ],
      },
      {
        sessionId: 's2',
        entries: [
          startIn('s2', 'grep', '2026-08-10T01:00:00.000Z'),
          endIn('s2', 'grep', '2026-08-10T01:00:00.500Z', 500),
        ],
      },
    ];
    const records = buildGlobalTimeline(groups);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      sessionId: 's2',
      toolName: 'grep',
      status: 'success',
      durationMs: 500,
    });
    expect(records[1]).toMatchObject({
      sessionId: 's1',
      toolName: 'bash',
      status: 'success',
      durationMs: 1000,
    });
  });

  it('tags each record with its owning sessionId', () => {
    const records = buildGlobalTimeline([
      {
        sessionId: 'alpha',
        entries: [
          startIn('alpha', 'bash', '2026-08-10T01:00:00.000Z'),
          endIn('alpha', 'bash', '2026-08-10T01:00:01.000Z', 100),
        ],
      },
    ]);
    expect(records[0]).toMatchObject({ sessionId: 'alpha', toolName: 'bash' });
  });

  it('keeps per-session failure status and errorMessage', () => {
    const records = buildGlobalTimeline([
      {
        sessionId: 's1',
        entries: [
          startIn('s1', 'bash', '2026-08-10T01:00:00.000Z'),
          errIn('s1', 'bash', '2026-08-10T01:00:01.000Z', 'boom', 500),
        ],
      },
    ]);
    expect(records[0]).toMatchObject({
      sessionId: 's1',
      status: 'error',
      durationMs: 500,
      errorMessage: 'boom',
    });
  });

  it('does not pair tool calls across sessions', () => {
    // s1 只有 start（无 end），s2 只有 end（无 start）：不跨 session 配对
    const records = buildGlobalTimeline([
      { sessionId: 's1', entries: [startIn('s1', 'bash', '2026-08-10T01:00:00.000Z')] },
      { sessionId: 's2', entries: [endIn('s2', 'bash', '2026-08-10T01:00:01.000Z', 100)] },
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ sessionId: 's1', status: 'started' });
    expect(records[1]).toMatchObject({ sessionId: 's2', status: 'success' });
  });

  it('returns empty array when no session groups', () => {
    expect(buildGlobalTimeline([])).toEqual([]);
  });
});

describe('aggregateToolStats', () => {
  const record = (
    toolName: string,
    status: ToolCallStatus,
    durationMs?: number,
    sessionId = 's1',
  ): GlobalToolCallRecord => ({
    toolName,
    status,
    sessionId,
    ...(durationMs !== undefined ? { durationMs } : {}),
  });

  it('counts calls and failures per toolName', () => {
    const stats = aggregateToolStats([
      record('bash', 'success', 100),
      record('bash', 'error', 200),
      record('grep', 'success', 50),
    ]);
    expect(stats).toEqual([
      { toolName: 'bash', calls: 2, failed: 1, avgDurationMs: 150, maxDurationMs: 200, slowCalls: 0 },
      { toolName: 'grep', calls: 1, failed: 0, avgDurationMs: 50, maxDurationMs: 50, slowCalls: 0 },
    ]);
  });

  it('computes avg and max duration across sessions', () => {
    const stats = aggregateToolStats([
      record('bash', 'success', 1000, 's1'),
      record('bash', 'success', 3000, 's2'),
    ]);
    expect(stats[0]).toMatchObject({ avgDurationMs: 2000, maxDurationMs: 3000 });
  });

  it('counts slow calls above threshold', () => {
    const stats = aggregateToolStats([
      record('bash', 'success', 6000),
      record('bash', 'success', 1000),
    ]);
    expect(stats[0]).toMatchObject({ slowCalls: 1 });
  });

  it('omits avg/max when no record has duration', () => {
    const stats = aggregateToolStats([record('bash', 'started'), record('bash', 'started')]);
    expect(stats[0]).toEqual({ toolName: 'bash', calls: 2, failed: 0, slowCalls: 0 });
    expect(stats[0]).not.toHaveProperty('avgDurationMs');
  });

  it('sorts by calls desc then failed desc', () => {
    const stats = aggregateToolStats([
      record('a', 'success'),
      record('b', 'error'),
      record('b', 'error'),
      record('c', 'error'),
    ]);
    // b: calls2/failed2；c: calls1/failed1；a: calls1/failed0
    expect(stats.map((s) => s.toolName)).toEqual(['b', 'c', 'a']);
  });

  it('returns empty array when no records', () => {
    expect(aggregateToolStats([])).toEqual([]);
  });
});

