/**
 * web-search.ts - 网络搜索工具
 *
 * 使用搜索 API 搜索网络信息，返回结构化搜索结果。
 *
 * ## 功能特性
 * - 支持 DuckDuckGo 搜索（默认，无需 API 密钥）
 * - 使用 cheerio 进行 HTML 解析（稳定可靠）
 * - 内存 LRU 缓存（避免重复搜索）
 * - 返回结构化结果（标题、摘要、URL）
 * - 支持结果数量限制
 * - 超时处理
 *
 * ## 风险等级
 * read - 只读操作，不修改任何数据
 *
 * ## 参数
 * - query: 搜索关键词（必需）
 * - maxResults: 最大结果数量（可选，默认 5，最大 20）
 * - engine: 搜索引擎（可选，默认 "duckduckgo"）
 */

import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';
import * as cheerio from 'cheerio';

import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';
import { LRUCache } from './lru-cache.js';

// ============================================================
// Zod Schema
// ============================================================

export const webSearchInputSchema = z.object({
  query: z.string().min(1).describe('搜索关键词'),
  maxResults: z.number().int().positive().max(20).default(5).describe('最大结果数量（默认 5，最大 20）'),
  engine: z.enum(['duckduckgo']).default('duckduckgo').describe('搜索引擎（默认 duckduckgo）'),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

// ============================================================
// 配置常量
// ============================================================

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT = 15000;

/** 默认 User-Agent */
const USER_AGENT = 'wasteland/0.1.0 (CLI Tool)';

/** 缓存最大容量 */
const CACHE_MAX_SIZE = 100;

/** 搜索结果缓存（模块级别，全局共享） */
const searchCache = new LRUCache<SearchResult[]>(CACHE_MAX_SIZE);

// ============================================================
// 类型定义
// ============================================================

/** 搜索结果项 */
type SearchResult = {
  /** 标题 */
  title: string;
  /** 摘要 */
  snippet: string;
  /** URL */
  url: string;
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * DuckDuckGo 搜索
 *
 * 使用 DuckDuckGo Instant Answer API 进行搜索
 *
 * @param query - 搜索关键词
 * @param maxResults - 最大结果数量
 * @returns 搜索结果数组
 */
async function searchDuckDuckGo(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  // 生成缓存键（基于查询和结果数量）
  const cacheKey = `${query}:${maxResults}`;

  // 检查缓存
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // DuckDuckGo HTML 搜索端点
  const searchUrl = new URL('https://html.duckduckgo.com/html/');
  searchUrl.searchParams.set('q', query);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoHTML(html, maxResults);

    // 缓存结果
    searchCache.set(cacheKey, results);

    return results;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Search request timed out', { cause: error });
      }
      throw error;
    }
    throw new Error(String(error), { cause: error });
  }
}

/**
 * 解析 DuckDuckGo HTML 响应
 *
 * 使用 cheerio 解析 HTML，提取搜索结果
 *
 * @param html - HTML 内容
 * @param maxResults - 最大结果数量
 * @returns 解析后的搜索结果
 */
function parseDuckDuckGoHTML(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // 使用 cheerio 解析 HTML
  const $ = cheerio.load(html);

  // DuckDuckGo HTML 结果格式：
  // <div class="result">
  //   <a class="result__a" href="...">title</a>
  //   <a class="result__snippet">snippet</a>
  // </div>

  // 提取所有结果
  $('.result').each((index, element) => {
    if (results.length >= maxResults) {
      return false; // 停止遍历
    }

    const $element = $(element);
    const $titleLink = $element.find('.result__a');
    const $snippet = $element.find('.result__snippet');

    const title = $titleLink.text().trim();
    const rawUrl = $titleLink.attr('href') || '';
    const snippet = $snippet.text().trim();

    // DuckDuckGo 的 URL 可能是重定向 URL，提取实际 URL
    const url = extractActualUrl(rawUrl);

    if (title && url) {
      results.push({
        title: title || 'Untitled',
        url,
        snippet: snippet || '',
      });
    }
  });

  return results;
}

/**
 * 提取 DuckDuckGo 重定向 URL 中的实际 URL
 *
 * @param redirectUrl - 重定向 URL
 * @returns 实际 URL
 */
function extractActualUrl(redirectUrl: string): string {
  try {
    // DuckDuckGo 重定向格式: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
    if (redirectUrl.includes('duckduckgo.com/l/')) {
      const url = new URL(redirectUrl.startsWith('//') ? `https:${redirectUrl}` : redirectUrl);
      const uddg = url.searchParams.get('uddg');
      if (uddg) {
        return decodeURIComponent(uddg);
      }
    }
    return redirectUrl;
  } catch {
    return redirectUrl;
  }
}

/**
 * 格式化搜索结果
 *
 * @param query - 搜索关键词
 * @param results - 搜索结果
 * @param engine - 搜索引擎
 * @param duration - 耗时（毫秒）
 * @returns 格式化后的输出
 */
function formatResults(
  query: string,
  results: SearchResult[],
  engine: string,
  duration: number
): string {
  if (results.length === 0) {
    return `🔍 web-search "${query}" — no results found (${duration}ms)\n${'─'.repeat(48)}`;
  }

  const header = `🔍 web-search "${query}" — ${results.length} ${results.length === 1 ? 'result' : 'results'} via ${engine} (${duration}ms)\n${'─'.repeat(48)}`;

  const body = results
    .map((result, index) => {
      const num = String(index + 1).padStart(2);
      return `${num}. ${result.title}\n    ${result.url}\n    ${result.snippet}`;
    })
    .join('\n\n');

  return `${header}\n\n${body}`;
}

/**
 * 清空搜索缓存
 *
 * 用于测试或手动缓存失效
 */
export function clearSearchCache(): void {
  searchCache.clear();
}

/**
 * 获取缓存大小
 *
 * 用于监控和调试
 */
export function getCacheSize(): number {
  return searchCache.size;
}

// ============================================================
// 工具实现
// ============================================================

/**
 * 创建 web-search 工具
 *
 * ## 功能
 *
 * 使用搜索 API 搜索网络信息，返回结构化搜索结果。
 *
 * ## 参数
 *
 * - `query`: 搜索关键词（必需）
 * - `maxResults`: 最大结果数量（可选，默认 5，最大 20）
 * - `engine`: 搜索引擎（可选，默认 "duckduckgo"）
 *
 * ## 输出格式
 *
 * ```
 * 🔍 web-search "TypeScript best practices" — 5 results via duckduckgo (1234ms)
 * ────────────────────────────────────────────────────────
 *
 * 1. TypeScript Best Practices
 *    https://example.com/typescript-best-practices
 *    Learn the best practices for writing TypeScript code...
 *
 * 2. Getting Started with TypeScript
 *    https://example.com/getting-started
 *    A comprehensive guide to TypeScript...
 * ```
 *
 * @example
 * // 基本搜索
 * web-search({ query: "TypeScript best practices" })
 *
 * // 指定结果数量
 * web-search({ query: "Node.js tutorials", maxResults: 10 })
 */
export function createWebSearchTool(): AgentTool {
  return {
    name: 'web-search',
    riskLevel: 'read',
    description: '使用搜索引擎搜索网络信息',
    inputSchema: zodToJsonSchema(webSearchInputSchema) as JsonSchema,

    async execute(input): Promise<ToolExecutionResult> {
      const parsed = webSearchInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const startTime = Date.now();
        const results = await searchDuckDuckGo(parsed.data.query, parsed.data.maxResults);
        const duration = Date.now() - startTime;

        return {
          status: 'success',
          output: formatResults(parsed.data.query, results, parsed.data.engine, duration),
          data: {
            query: parsed.data.query,
            engine: parsed.data.engine,
            results,
            duration,
          },
        };
      } catch (error) {
        return {
          status: 'error',
          error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
