/**
 * html-to-markdown.ts - HTML 转 Markdown
 *
 * 单一职责：接受 HTML 字符串，输出可读的 Markdown 文本。
 * 为 web-fetch 工具服务：让 LLM 拿到结构化文本而非 raw HTML 源码。
 *
 * ## 转换流程
 *
 * 1. cheerio 解析 DOM，移除噪声标签（script/style/nav/header/footer/aside 等）
 * 2. turndown 转 Markdown（保留标题、列表、链接、代码块等结构）
 * 3. 长度截断（防止超大 HTML 占满模型 context）
 *
 * ## 健壮性
 *
 * - 输入超大（> 500KB）：提前截断避免 cheerio OOM
 * - cheerio/turndown 抛错：fallback 到 stripTags 纯文本
 * - 空输入：返回空字符串
 * - 不抛任何异常给调用方（保证调用方总是拿到字符串）
 *
 * ## 设计原则
 *
 * - 纯函数：无 IO 副作用，输入 HTML 输出 Markdown
 * - 可测：纯函数易写单元测试
 * - 单一职责：只做 HTML→Markdown，不处理 HTTP/IO
 */

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

// ============================================================
// 常量
// ============================================================

/** 应移除的噪声标签（不包含正文内容） */
const NOISE_TAGS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'input',
  'select',
  'textarea',
] as const;

/** cheerio 输入大小上限（字节），防 OOM */
const MAX_INPUT_BYTES = 500_000;

/** 输出默认上限（字符），防止占满模型 context */
const DEFAULT_MAX_OUTPUT_CHARS = 15_000;

// ============================================================
// 公共 API
// ============================================================

export type HtmlToMarkdownOptions = {
  /** 输出最大字符数；超过则截断（带 [content truncated] 标记）。默认 15000 */
  maxLength?: number;
};

/**
 * HTML 转 Markdown。
 *
 * **绝不抛错**：任何异常（损坏 HTML、cheerio/turndown 失败）都会 fallback 到
 * "去除标签的纯文本"，保证调用方总是拿到字符串。
 *
 * @param html - 原始 HTML 字符串
 * @param options - 转换选项
 * @returns Markdown 字符串
 */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_OUTPUT_CHARS;

  // 空输入短路
  if (!html || html.trim().length === 0) {
    return '';
  }

  // 输入过大提前截断（避免 cheerio/turndown OOM）
  const safeInput = html.length > MAX_INPUT_BYTES ? html.slice(0, MAX_INPUT_BYTES) : html;

  try {
    const cleaned = removeNoiseTags(safeInput);
    const markdown = convertWithTurndown(cleaned);
    return truncate(markdown, maxLength);
  } catch {
    // 主路径失败：fallback 到 stripTags 纯文本
    return truncate(stripTagsFallback(safeInput), maxLength);
  }
}

// ============================================================
// 内部辅助函数（单一职责：每个函数只做一件事）
// ============================================================

/**
 * 用 cheerio 移除噪声标签，保留正文结构
 */
function removeNoiseTags(html: string): string {
  try {
    const $ = cheerio.load(html);
    NOISE_TAGS.forEach((tag) => $(tag).remove());
    // 移除 HTML 注释节点
    $('*')
      .contents()
      .filter((_, el) => el.type === 'comment')
      .remove();
    return $.html();
  } catch {
    // cheerio 解析失败：返回原 HTML，让 turndown 尝试（可能仍能转）
    return html;
  }
}

/**
 * 用 turndown 转 Markdown（单例 TurndownService 以避免重复创建开销）
 */
let turndownInstance: TurndownService | null = null;
function getTurndownService(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx', // # / ## / ###
      codeBlockStyle: 'fenced', // ``` 围栏
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
    });
  }
  return turndownInstance;
}

function convertWithTurndown(html: string): string {
  return getTurndownService().turndown(html);
}

/**
 * 终极 fallback：粗暴去除所有 HTML 标签（无依赖）
 */
function stripTagsFallback(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 截断到指定字符数（带标记） */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n\n... [content truncated]';
}