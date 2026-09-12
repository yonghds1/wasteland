/**
 * reasoning-roundtrip.ts - OpenAI 兼容 reasoning 字面回传的纯函数工具
 *
 * 抽取自 openai.ts，便于单测（无副作用、无 IO、无状态）与行数预算控制。
 * 背景见 `.trellis/tasks/09-13-reasoning-roundtrip/prd.md`：
 * - R-1/R-3：上游发过哪个 reasoning 字段，续传历史时就用同名原字段、原值带回。
 * - R-4：少数厂商反过来拒收回传，命中该错误时去字段重试一次（自愈）。
 */

import type { OpenAIMessage } from '../openai-compatible/types.js';
import type { OpenAIStreamDelta } from '../openai-compatible/stream-types.js';

/** R-1/R-3/R-4 共用的 reasoning 源字段名集合（与流解析探测的三个字段一致）。 */
export const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'thought'] as const;

/**
 * R-1：探测 delta 实际命中的 reasoning 源字段名
 *
 * 严格判定 `!== undefined && !== null`，按 `reasoning_content` → `reasoning` → `thought`
 * 顺序取第一个命中；未命中返回 undefined（不猜测、不归一化）。
 */
export function detectReasoningField(
  delta: OpenAIStreamDelta
): (typeof REASONING_FIELDS)[number] | undefined {
  return REASONING_FIELDS.find(
    (field) => delta[field] !== undefined && delta[field] !== null
  );
}

/**
 * R-4 自愈：识别"reasoning 字段被端点拒收"类错误
 *
 * 部分较真厂商接受模型输出 reasoning，却拒收客户端把该字段原样带回（与"必须回传"相反）。
 * 命中此模式时去字段重试一次。
 *
 * ⚠️ 关键排除：`must be passed back` / `required` / `requires` / `missing` 一类
 * "要求我们多带"的错误由 R-3 解决（把 reasoning 带回去），**绝不能**靠去字段"自愈"
 * ——那只会让它更少、更糟，还会污染进程内记忆导致整会话停回传。
 * 故这类措辞一律返回 false，交回 R-3 链路。
 * 判错方向的代价不对称：漏判"拒收"= 用户看到原始错误（安全）；
 * 误判"要求多带"= 悄悄丢掉 R-3 能力（危险），所以排除侧刻意从宽。
 */
export function isReasoningRoundTripError(message: string): boolean {
  const lower = message.toLowerCase();
  // "要求多带"措辞（must / requires / needs / please / missing / pass back ...）一律排除。
  const demandsRoundTrip =
    /\bmust\b|\brequir|\bneed|\bshould\b|\bplease\b|\bmissing\b|\binclude[sd]?\b|\bprovide\b|\bbring\b/.test(
      lower
    ) || /pass(?:ing|ed)?\b.{0,20}\bback\b/.test(lower);
  if (demandsRoundTrip) {
    return false;
  }
  const mentionsReasoning = lower.includes('reasoning') || lower.includes('thinking');
  const rejected =
    lower.includes('unrecognized') ||
    lower.includes('not supported') ||
    lower.includes('unexpected') ||
    lower.includes('unknown') ||
    lower.includes('invalid_request') ||
    lower.includes('invalid field') ||
    lower.includes('invalid parameter');
  return mentionsReasoning && rejected;
}

/**
 * 判断请求体中是否真的带了 reasoning 字段
 *
 * 只有"我们确实回了传"才有"被拒收"的可能；无字段时不做无意义重试。
 */
export function hasReasoningFields(messages: readonly OpenAIMessage[]): boolean {
  return messages.some((m) => REASONING_FIELDS.some((f) => f in (m as object)));
}

/**
 * R-4 自愈：剥离历史消息中的 reasoning 字段
 *
 * 返回新数组，逐条浅拷贝并删除 `REASONING_FIELDS` 中的动态 key。
 * 无 reasoning 字段时原样返回（同引用），保证默认路径零开销、零差异。
 */
export function stripReasoningFields(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  if (!hasReasoningFields(messages)) {
    return messages;
  }
  return messages.map((m) => {
    if (!REASONING_FIELDS.some((f) => f in (m as object))) return m;
    // 逐 key 复制、跳过 reasoning key（比 delete 计算属性更干净，lint 友好）。
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(m as object)) {
      if (!(REASONING_FIELDS as readonly string[]).includes(key)) rest[key] = value;
    }
    // 动态字段名不改变 OpenAI 消息形状（额外 key 由端点按厂商语义解析或忽略）
    return rest as unknown as OpenAIMessage;
  });
}
