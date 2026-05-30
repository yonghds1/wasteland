/**
 * http-request.ts - HTTP 请求工具
 *
 * 发送 HTTP 请求，支持 GET/POST/PUT/DELETE 等方法。
 */

import type { AgentTool, ToolRiskLevel, ToolExecutionResult } from './tool-types.js';

type HttpRequestInput = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
};

export function createHttpRequestTool(): AgentTool {
  return {
    name: 'http-request',
    riskLevel: 'execute' as ToolRiskLevel,

    async execute(input: unknown): Promise<ToolExecutionResult> {
      const {
        url,
        method = 'GET',
        headers = {},
        body,
        timeout = 30000,
      } = input as HttpRequestInput;

      if (!url || typeof url !== 'string') {
        return {
          status: 'error',
          error: '缺少 url 参数',
        };
      }

      // 验证 URL 格式
      try {
        new URL(url);
      } catch {
        return {
          status: 'error',
          error: `无效的 URL: ${url}`,
        };
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body: method.toUpperCase() !== 'GET' ? body : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseBody = await response.text();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          status: 'success',
          output: `HTTP ${method.toUpperCase()} ${url}\n状态码: ${response.status}\n\n${responseBody}`,
          data: {
            statusCode: response.status,
            headers: responseHeaders,
            body: responseBody,
          },
        };
      } catch (error) {
        return {
          status: 'error',
          error: `HTTP 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
