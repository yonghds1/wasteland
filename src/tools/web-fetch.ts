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

import type { AgentTool, ToolExecutionResult } from "./tool-types.js";

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
  "User-Agent": "rxc/0.1.0",
  Accept: "*/*",
};

// ============================================================
// 辅助函数
// ============================================================

/**
 * 验证 URL 格式
 *
 * @param value - 输入 URL 值
 * @returns 有效 URL，或 null 表示无效
 */
function validateUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value);
    // 只允许 HTTP 和 HTTPS
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * 解析请求头
 *
 * @param value - 输入请求头值
 * @returns 请求头对象
 */
function parseHeaders(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_HEADERS };
  }

  const headers: Record<string, string> = { ...DEFAULT_HEADERS };

  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") {
      headers[key] = val;
    }
  }

  return headers;
}

/**
 * 解析超时时间
 *
 * @param value - 输入超时值
 * @returns 超时时间（毫秒）
 */
function parseTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT;
  }
  return Math.min(Math.floor(value), 120000); // 最大 120 秒
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
  return content.slice(0, maxLength) + "\n\n... [content truncated]";
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
  return contentType.includes("application/json");
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
  duration: number,
): string {
  const statusEmoji = status >= 200 && status < 300 ? "✅" : "❌";
  const header = `${statusEmoji} web-fetch "${url}" — ${status} ${statusText} (${duration}ms)\n${"─".repeat(48)}`;

  const contentType = headers.get("content-type") || "unknown";
  const contentLength = headers.get("content-length") || `${content.length}`;

  const meta = `Content-Type: ${contentType}\nContent-Length: ${contentLength}`;

  const body = truncateContent(content, MAX_DISPLAY_LENGTH);

  return `${header}\n${meta}\n\n${body}`;
}

// ============================================================
// 工具实现
// ============================================================

export function createWebFetchTool(): AgentTool {
  return {
    name: "web-fetch",
    riskLevel: "execute",

    async execute(input): Promise<ToolExecutionResult> {
      // 验证 URL
      const url = validateUrl(input.url);

      if (url === null) {
        return {
          status: "error",
          error: "web-fetch 工具需要有效的 HTTP/HTTPS URL。示例：{ \"url\": \"https://api.example.com/data\" }",
        };
      }

      // 解析参数
      const method =
        typeof input.method === "string" &&
        ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"].includes(
          input.method.toUpperCase(),
        )
          ? input.method.toUpperCase()
          : "GET";

      const headers = parseHeaders(input.headers);
      const timeout = parseTimeout(input.timeout);

      // 请求体（仅用于 POST/PUT/PATCH）
      let body: string | undefined;
      if (["POST", "PUT", "PATCH"].includes(method)) {
        if (typeof input.body === "string") {
          body = input.body;
        } else if (typeof input.body === "object" && input.body !== null) {
          body = JSON.stringify(input.body);
          // 自动设置 Content-Type
          if (!headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
          }
        }
      }

      try {
        const startTime = Date.now();

        // 创建 AbortController 用于超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          method,
          headers,
          body,
          signal: controller.signal,
          redirect: "follow",
        });

        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;

        // 检查响应大小
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
          return {
            status: "error",
            error: `响应体过大 (${contentLength} 字节)，最大允许 ${MAX_RESPONSE_SIZE} 字节。`,
          };
        }

        // 解析响应内容
        let content: string;
        const contentType = response.headers.get("content-type");

        if (isJsonContent(contentType)) {
          const json = await response.json();
          content = JSON.stringify(json, null, 2);
        } else {
          content = await response.text();
        }

        // 检查实际响应大小
        if (content.length > MAX_RESPONSE_SIZE) {
          content = truncateContent(content, MAX_RESPONSE_SIZE);
        }

        return {
          status: "success",
          output: formatResponse(
            url.toString(),
            response.status,
            response.statusText,
            response.headers,
            content,
            duration,
          ),
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === "AbortError") {
            return {
              status: "error",
              error: `请求超时 (${timeout}ms)。`,
            };
          }
          return {
            status: "error",
            error: `请求失败: ${error.message}`,
          };
        }
        return {
          status: "error",
          error: `请求失败: ${String(error)}`,
        };
      }
    },
  };
}
