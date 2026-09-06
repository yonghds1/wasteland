/**
 * Command completion pure helpers (R3).
 *
 * 数据源为 `getCommandManager().getAll()`（单一来源，见
 * `.trellis/spec/backend/command-registry.md §11`），本模块只做
 * 纯过滤/索引/套用决策，可独立单测。
 */

export interface CompletionItem {
  /** 主命令名（含前导 `/`，如 `/help`） */
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  /** i18n key，调用方用 `t()` 解析 */
  readonly description: string;
}

/** 下拉最多展示条数（输入区上方浮层，保持 1 屏内）。 */
export const MAX_COMPLETION_ITEMS = 6;

/**
 * 按当前输入过滤补全候选。
 *
 * - 仅当 `input` 以 `/` 开头且光标前无空格（还在输命令词）时返回候选；
 * - 大小写不敏感，前缀匹配 `name` 或任意 alias；
 * - 恰好等于某命令全名时返回空（已唯一，无需补全）。
 */
export function filterCompletions(
  input: string,
  cursorOffset: number,
  items: ReadonlyArray<CompletionItem>,
): CompletionItem[] {
  if (!input.startsWith('/')) return [];
  const before = input.slice(0, cursorOffset);
  if (before.includes(' ') || before.includes('\n')) return [];
  const query = before.toLowerCase();
  if (query.length <= 1) return items.slice(0, MAX_COMPLETION_ITEMS);
  const exact = items.some((it) => it.name.toLowerCase() === query);
  if (exact) return [];
  const out = items.filter(
    (it) =>
      it.name.toLowerCase().startsWith(query) ||
      it.aliases.some((a) => a.toLowerCase().startsWith(query)),
  );
  return out.slice(0, MAX_COMPLETION_ITEMS);
}

/**
 * 补全索引移动（循环回绕，空列表回 0）。
 */
export function moveCompletionIndex(current: number, dir: 1 | -1, len: number): number {
  if (len <= 0) return 0;
  return (current + dir + len) % len;
}

/**
 * 把选中项套用到输入（只替换光标前的命令词，保留后续参数）。
 */
export function applyCompletion(
  input: string,
  cursorOffset: number,
  item: CompletionItem,
): { input: string; cursor: number } {
  const before = input.slice(0, cursorOffset);
  const after = input.slice(cursorOffset);
  const replaced = item.name + ' ';
  // before 无空格（filterCompletions 已保证），整体替换 before
  void before;
  const nextInput = replaced + after.replace(/^\s*/, '');
  return { input: nextInput, cursor: replaced.length };
}

/**
 * 输入历史导航（R2）。
 *
 * - `idx === null` 表示正在编辑草稿；
 * - `dir === -1`（↑）：null→最后一条，否则上移钳制；
 * - `dir === 1`（↓）：null→null，末尾下一步回到草稿（null）。
 */
export function navigateHistory(
  historyLength: number,
  idx: number | null,
  dir: 1 | -1,
): number | null {
  if (historyLength <= 0) return null;
  if (dir === -1) {
    if (idx === null) return historyLength - 1;
    return Math.max(0, idx - 1);
  }
  if (idx === null) return null;
  const next = idx + 1;
  return next >= historyLength ? null : next;
}
