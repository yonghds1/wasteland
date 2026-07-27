/**
 * think-tags.ts - 拆分 <think>...</think> 标签
 *
 * 一些模型（minimax、DeepSeek R1、Qwen QwQ 等）会把"思考过程"
 * 作为 `<think>...</think>` 文本块直接拼接到 assistant content 里。
 * UI 渲染时需要把 thinking 和正文分离，便于用不同样式展示
 * （参考 Claude Code / OpenCode 的折叠式 thinking 区块）。
 *
 * 流式场景下，开标签已到达但闭标签未到达时，会把从开标签到文本末尾
 * 的内容作为 thinking 的"未闭合片段"返回。调用方据此决定渲染策略：
 * 已闭合 → 折叠展示，未闭合 → 视为正在思考中（用 ⏳ 样式）。
 */

/**
 * 拆分结果
 * @property thinking - 累计的思考正文（多个 <think> 块用 \n\n 拼接，已 trim）
 * @property content - 剥离 <think> 后的正文（已 trim）
 * @property hasUnclosed - 是否存在未闭合的 <think>（流式中段）
 */
export type ThinkSplit = {
  thinking: string;
  content: string;
  hasUnclosed: boolean;
};

/**
 * 拆分 <think>...</think> 标签
 *
 * @param text - 可能含 think 标签的原始文本
 * @returns { thinking, content, hasUnclosed }
 */
export function splitThinkTags(text: string): ThinkSplit {
  const thinkParts: string[] = [];
  let remaining = text;

  // 已闭合的 <think>...</think>
  const closedRegex = /<think>([\s\S]*?)<\/think>/g;
  remaining = remaining.replace(closedRegex, (_match, inner: string) => {
    thinkParts.push(inner.trim());
    return '';
  });

  // 未闭合：开标签后无对应闭标签（流式中段）
  const unclosed = /<think>([\s\S]*)$/.exec(remaining);
  let hasUnclosed = false;
  if (unclosed) {
    thinkParts.push(unclosed[1].trim());
    remaining = remaining.slice(0, unclosed.index);
    hasUnclosed = true;
  }

  return {
    thinking: thinkParts.join('\n\n').trim(),
    content: remaining.trim(),
    hasUnclosed,
  };
}