/**
 * http-request.ts - HTTP 请求工具
 *
 * 发送 HTTP 请求，支持 GET/POST/PUT/DELETE 等方法。
 *
 * @deprecated 建议使用 web-fetch 工具替代
 */

import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import type { AgentTool, ToolExecutionResult } from './tool-types.js';
import type { JsonSchema } from './tool-types.js';

// ============================================================
// Zod Schema
// ============================================================

export const httpRequestInputSchema = z.object({
  url: z.string().url().describe('请求 URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).default('GET').describe('HTTP 方法'),
  headers: z.record(z.string(), z.string()).optional().describe('请求头'),
  body: z.string().optional().describe('请求体'),
  timeout: z.number().int().positive().max(120000).default(30000).describe('超时时间（毫秒）'),
});

export type HttpRequestInput = z.infer<typeof httpRequestInputSchema>;

export function createHttpRequestTool(): AgentTool {
  return {
    name: 'http-request',
    riskLevel: 'execute',
    description: '发送 HTTP 请求（建议使用 web-fetch 替代）',
    inputSchema: zodToJsonSchema(httpRequestInputSchema) as JsonSchema,

    async execute(input): Promise<ToolExecutionResult> {
      const parsed = httpRequestInputSchema.safeParse(input);
      if (!parsed.success) {
        return { status: 'error', error: parsed.error.issues.map(i => i.message).join(', ') };
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), parsed.data.timeout);

        const response = await fetch(parsed.data.url, {
          method: parsed.data.method,
          headers: (parsed.data.headers ?? {}) as Record<string, string>,
          body: parsed.data.method !== 'GET' ? parsed.data.body : undefined,
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
          output: `HTTP ${parsed.data.method} ${parsed.data.url}\n状态码: ${response.status}\n\n${responseBody}`,
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
