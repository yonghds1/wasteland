/**
 * web-fetch.ts - 网络请求工具
 *
 * 从 URL 获取内容并返回文本响应。
 *
 * ## 功能特性
 * - 支持 HTTP/HTTPS GET 请求
 * - 支持自定义请求头
 * - 支持超时设置
 * - 自动处理 JSON 和文本响应
 *
 * ## 风险等级
 * execute - 涉及网络请求，可能有安全风险
 *
 * ## 参数
 * - url: 请求 URL（必需）
 * - method: HTTP 方法（可选，默认 GET）
 * - headers: 请求头（可选）
 * - body: 请求体（可选，POST 时使用）
 * - timeout: 超时时间（可选，默认 30000ms）
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';
import { htmlToMarkdown } from './html-to-markdown.js';

// ============================================================
// Zod Schema
// ============================================================

export const webFetchInputSchema = z.object({
  url: z.string().url().refine(u => /^https?:\/\//i.test(u), '仅支持 http/https URL').describe('请求 URL（支持 http/https）'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).default('GET').describe('HTTP 方法'),
  headers: z.record(z.string(), z.string()).optional().describe('自定义请求头'),
  body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe('请求体（POST/PUT/PATCH 时使用）'),
  timeout: z.number().int().positive().max(120000).optional().describe('超时时间（毫秒，默认 30000）'),
});

export type WebFetchInput = z.infer<typeof webFetchInputSchema>;

// ============================================================
// 配置常量
// ============================================================

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT = 30000;

/** 最大响应体大小（字节） */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB

/** 最大显示内容长度 */
const MAX_DISPLAY_LENGTH = 50000;

/** 默认请求头 */
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'wasteland/0.1.0',
  Accept: '*/*',
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 判断 IP 是否为私网/回环/链路本地/保留地址（SSRF 防护）
 *
 * 覆盖：回环、私网段、链路本地（含云元数据 169.254.169.254）、
 * CGN、未指定地址，以及 IPv6 的 ::1、fc00::/7、fe80::/10。
 */
function isDisallowedIp(ip: string): boolean {
  // IPv4-mapped IPv6（如 ::ffff:169.254.169.254）
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    ip = mapped[1];
  }

  // IPv6 特殊地址
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 私网
    if (/^fe[89ab][0-9a-f]{2}:/i.test(ip)) return true; // fe80::/10 链路本地
    return false;
  }

  // IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return false; // 无法识别，交由 fetch 自行报错
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 私网
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地（云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私网
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGN
  return false;
}

/**
 * 校验目标 URL 不指向私网/保留地址（SSRF 防护）
 *
 * 若 hostname 是 IP 直接检查；若是域名则 DNS 解析后检查所有地址。
 * 注意：DNS rebinding 不在本次防护范围内（需 fetch 层绑定 IP）。
 *
 * @throws 若目标地址被禁止访问
 */
async function assertPublicUrl(target: URL): Promise<void> {
  const host = target.hostname;

  if (isIP(host)) {
    if (isDisallowedIp(host)) {
      throw new Error(`目标地址 ${host} 为私网/保留地址，禁止访问（SSRF 防护）。`);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (error) {
    throw new Error(`域名解析失败: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  for (const addr of addresses) {
    if (isDisallowedIp(addr.address)) {
      throw new Error(`目标域名 ${host} 解析到私网/保留地址 ${addr.address}，禁止访问（SSRF 防护）。`);
    }
  }
}

/**
 * 截断响应内容
 *
 * @param content - 原始内容
 * @param maxLength - 最大长度
 * @returns 截断后的内容
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength) + '\n\n... [content truncated]';
}

/**
 * 检测内容类型是否为 JSON
 *
 * @param contentType - Content-Type 头
 * @returns 是否为 JSON
 */
function isJsonContent(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  return contentType.includes('application/json');
}

/**
 * 检测内容类型是否为 HTML
 *
 * @param contentType - Content-Type 头（可能含 charset 如 "text/html; charset=utf-8"）
 * @returns 是否为 HTML
 */
function isHtmlContent(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  return contentType.includes('text/html');
}

/**
 * 格式化响应输出
 *
 * @param url - 请求 URL
 * @param status - HTTP 状态码
 * @param statusText - 状态文本
 * @param headers - 响应头
 * @param content - 响应内容
 * @param duration - 请求耗时（毫秒）
 * @returns 格式化后的输出文本
 */
function formatResponse(
  url: string,
  status: number,
  statusText: string,
  headers: Headers,
  content: string,
  duration: number
): string {
  const statusEmoji = status >= 200 && status < 300 ? '✅' : '❌';
  const header = `${statusEmoji} web-fetch "${url}" — ${status} ${statusText} (${duration}ms)\n${'─'.repeat(48)}`;

  const contentType = headers.get('content-type') || 'unknown';
  const contentLength = headers.get('content-length') || `${content.length}`;

  const meta = `Content-Type: ${contentType}\nContent-Length: ${contentLength}`;

  const body = truncateContent(content, MAX_DISPLAY_LENGTH);

  return `${header}\n${meta}\n\n${body}`;
}

// ============================================================
// 工具实现
// ============================================================

export function createWebFetchTool(): AgentTool {
  return {
    name: 'web-fetch',
    riskLevel: 'execute',
    description: '从 URL 获取内容并返回文本响应',
    inputSchema: zodToJsonSchema(webFetchInputSchema) as JsonSchema,

    async execute(input): Promise<ToolExecutionResult> {
      const parsed = webFetchInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      const url = new URL(parsed.data.url);
      const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...parsed.data.headers };
      const timeout = parsed.data.timeout ?? DEFAULT_TIMEOUT;

      // 请求体（仅用于 POST/PUT/PATCH）
      let body: string | undefined;
      if (['POST', 'PUT', 'PATCH'].includes(parsed.data.method)) {
        if (typeof parsed.data.body === 'string') {
          body = parsed.data.body;
        } else if (typeof parsed.data.body === 'object' && parsed.data.body !== null) {
          body = JSON.stringify(parsed.data.body);
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
      }

      try {
        const startTime = Date.now();

        // 手动跟随重定向，每一跳都做 SSRF 校验，防止通过重定向绕过私网限制
        const MAX_REDIRECTS = 5;
        let currentUrl = url;
        let response: Response | undefined;

        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          await assertPublicUrl(currentUrl);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          try {
            response = await fetch(currentUrl.toString(), {
              method: hop === 0 ? parsed.data.method : 'GET',
              headers,
              body: hop === 0 ? body : undefined,
              signal: controller.signal,
              redirect: 'manual',
            });
          } finally {
            clearTimeout(timeoutId);
          }

          // 3xx 重定向：校验 Location 并继续下一跳
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) break;
            const nextUrl = new URL(location, currentUrl);
            if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
              return {
                status: 'error',
                error: `重定向到不允许的协议: ${nextUrl.protocol}`,
              };
            }
            currentUrl = nextUrl;
            continue;
          }
          break;
        }

        if (!response) {
          return { status: 'error', error: '请求未返回响应。' };
        }

        const duration = Date.now() - startTime;

        // 检查响应大小
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
          return {
            status: 'error',
            error: `响应体过大 (${contentLength} 字节)，最大允许 ${MAX_RESPONSE_SIZE} 字节。`,
          };
        }

        // 解析响应内容
        let content: string;
        const contentType = response.headers.get('content-type');

        if (isJsonContent(contentType)) {
          const json = await response.json();
          content = JSON.stringify(json, null, 2);
        } else if (isHtmlContent(contentType)) {
          // HTML：转换为 Markdown（去掉 script/style/nav 等噪声，保留正文结构），
          // 让 LLM 拿到可读文本而非 raw HTML 源码。htmlToMarkdown 内部已做异常 fallback。
          const rawHtml = await response.text();
          content = htmlToMarkdown(rawHtml);
        } else {
          content = await response.text();
        }

        // 检查实际响应大小
        if (content.length > MAX_RESPONSE_SIZE) {
          content = truncateContent(content, MAX_RESPONSE_SIZE);
        }

        return {
          status: 'success',
          output: formatResponse(
            currentUrl.toString(),
            response.status,
            response.statusText,
            response.headers,
            content,
            duration
          ),
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            return {
              status: 'error',
              error: `请求超时 (${timeout}ms)。`,
            };
          }
          return {
            status: 'error',
            error: `请求失败: ${error.message}`,
          };
        }
        return {
          status: 'error',
          error: `请求失败: ${String(error)}`,
        };
      }
    },
  };
}
