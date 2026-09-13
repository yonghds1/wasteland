/**
 * route-logs-command - 把 `/logs` 系列本地命令路由到 page 切换 / filter 设置
 *
 * 设计要点：
 * - 纯函数：无 React 依赖，便于测试。
 * - 不解析 / 颜色 / i18n（仅当 `cmd === 'logs help'` 时 echo 帮助文本，由调用方
 *   注入 i18n 后的 `helpText`，避免本模块引入 locales 依赖）。
 * - 命中命令返回 true；未识别子命令返回 false，调用方继续走 skill registry / runtime。
 * - 接受 `LogScope` 列表（type → string），非法 scope 静默忽略（不抛错，避免破坏
 *   TUI 输入流）。
 *
 * 8 个子命令（PRD R26）：
 * - /logs            → 切到 logs page（filter 保留）
 * - /logs close      → 切回 chat page
 * - /logs errors     → 切到 logs page + level='error'
 * - /logs show <sid> → 切到 logs page + sessionId=<sid>
 * - /logs level <l>  → 仅改 level（page 不动）
 * - /logs scope <s>  → 仅改 scope（逗号分隔，page 不动）
 * - /logs all        → 清除所有 filter + 切到 logs page
 * - /logs help       → echo 帮助文本（page 不动）
 */

import type { LogLevel, LogScope } from '@core/logger/index.js';

// 重新导出，方便调用方（如 route-logs-command.test.ts）直接取类型。
export type { LogLevel, LogScope } from '@core/logger/index.js';

// ============================================================
// 类型定义
// ============================================================

/** Page 名集合（本批仅涉及 chat / sessions / logs；保留扩展性）。 */
export type RoutePage = 'chat' | 'sessions' | 'logs';

/**
 * Logs page filter：与 AppContext 的 LogPageFilter 同构。
 *
 * 字段全部可选。
 */
export type LogPageFilter = {
  level?: LogLevel;
  scope?: ReadonlySet<LogScope>;
  sessionId?: string;
};

/**
 * routeLogsCommand 依赖。
 *
 * @property dispatchPage - 切换 page；logs ↔ chat / sessions
 * @property applyFilter  - 增量 patch filter（多次调用累计）
 * @property resetFilter  - 清空所有 filter（/logs all 使用）
 * @property echo         - 在 chat 区 echo 帮助文本
 * @property helpText     - i18n 后帮助文本（由调用方注入）
 */
export type RouteLogsCommandDeps = {
  dispatchPage: (page: RoutePage) => void;
  applyFilter: (patch: Partial<LogPageFilter>) => void;
  resetFilter: () => void;
  echo: (msg: string) => void;
  helpText: string;
};

// ============================================================
// 常量
// ============================================================

/** 合法 level 集合（与 LogLevel 字面量对齐）。 */
const VALID_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>([
  'debug',
  'info',
  'warn',
  'error',
]);

/** 合法 scope 集合（与 LogScope 字面量对齐）。 */
const VALID_SCOPES: ReadonlySet<LogScope> = new Set<LogScope>([
  'session',
  'turn',
  'provider',
  'tool',
  'ui',
  'skill',
  'permission',
  'mcp',
  'acp',
  'file',
]);

/** 触发 /logs 路由的根命令集合（仅 canonical name）。 */
const LOGS_ROOT_COMMANDS: ReadonlySet<string> = new Set<string>(['logs']);

// ============================================================
// 工具函数
// ============================================================

/**
 * 把任意字符串解析为 LogLevel；非法返回 undefined（保留原 filter）。
 */
function parseLevel(raw: string | undefined): LogLevel | undefined {
  if (typeof raw !== 'string') return undefined;
  const lower = raw.trim().toLowerCase();
  return VALID_LEVELS.has(lower as LogLevel) ? (lower as LogLevel) : undefined;
}

/**
 * 把逗号分隔的 scope 字符串解析为 ReadonlySet；非法 scope 静默忽略。
 *
 * 例如："tool,permission,foo,bar" → {tool, permission}。
 */
function parseScopes(raw: string | undefined): ReadonlySet<LogScope> | undefined {
  if (typeof raw !== 'string') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const out = new Set<LogScope>();
  for (const part of parts) {
    if (VALID_SCOPES.has(part as LogScope)) {
      out.add(part as LogScope);
    }
  }
  return out.size > 0 ? out : undefined;
}

/**
 * 把 RoutePage 映射到 AppState.PageName。
 *
 * - 'chat' → 'session'（当前 PageName 没有 'chat' 字面量）
 * - 'sessions' → 'sessions'
 * - 'logs' → 'logs'
 */
export function toPageName(page: RoutePage): 'session' | 'sessions' | 'logs' {
  return page === 'chat' ? 'session' : page;
}

// ============================================================
// 主路由函数
// ============================================================

/**
 * routeLogsCommand - 处理 /logs 系列命令。
 *
 * @param cmd   - 根命令（如 'logs'）
 * @param args  - 子参数数组（已按空白 split）
 * @param deps  - 副作用依赖（page 切换 / filter / echo）
 * @returns true 表示已处理（应拦截，不再走 runtime）；false 表示未识别
 *
 * 注意：本函数不修改 deps 之外的全局状态；调用方应保证 deps 的引用稳定。
 */
export function routeLogsCommand(
  cmd: string,
  args: readonly string[],
  deps: RouteLogsCommandDeps,
): boolean {
  if (!LOGS_ROOT_COMMANDS.has(cmd)) return false;

  const sub = (args[0] ?? '').toLowerCase();

  // /logs           → 切到 logs page
  // /logs close     → 切回 chat page
  // /logs errors    → 切到 logs page + level=error
  // /logs show <sid>→ 切到 logs page + sessionId=<sid>
  // /logs level <l> → 仅改 level
  // /logs scope <s> → 仅改 scope
  // /logs help      → echo help

  switch (sub) {
    case '': {
      // 无参数 /logs
      deps.dispatchPage('logs');
      return true;
    }
    case 'close': {
      deps.dispatchPage('chat');
      return true;
    }
    case 'all': {
      // /logs all → 清除所有 filter，回到全量视图
      deps.resetFilter();
      deps.dispatchPage('logs');
      deps.echo('All filters cleared — showing full log history.');
      return true;
    }
    case 'errors': {
      deps.dispatchPage('logs');
      deps.applyFilter({ level: 'error' });
      return true;
    }
    case 'show': {
      const sid = args[1]?.trim();
      if (!sid) {
        // 缺 sid 不切 page，echo 提示；保持原 filter
        deps.echo('Usage: /logs show <sessionId>');
        return true;
      }
      deps.dispatchPage('logs');
      deps.applyFilter({ sessionId: sid });
      return true;
    }
    case 'level': {
      const lvl = parseLevel(args[1]);
      if (!lvl) {
        deps.echo(`Usage: /logs level <debug|info|warn|error>`);
        return true;
      }
      deps.applyFilter({ level: lvl });
      return true;
    }
    case 'scope': {
      const scopes = parseScopes(args[1]);
      if (!scopes) {
        deps.echo('Usage: /logs scope <s1,s2,...>');
        return true;
      }
      deps.applyFilter({ scope: scopes });
      return true;
    }
    case 'help': {
      deps.echo(deps.helpText);
      return true;
    }
    default: {
      // 未知子命令：返回 false 让调用方继续走 skill registry。
      return false;
    }
  }
}

/**
 * 检查某个 root command 是否会进入本路由（用于调用方快速分流）。
 *
 * 注意：本函数仅判断 root cmd 是否命中；具体子命令解析在 routeLogsCommand 内。
 */
export function isLogsRootCommand(cmd: string): boolean {
  return LOGS_ROOT_COMMANDS.has(cmd);
}