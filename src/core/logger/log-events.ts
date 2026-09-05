/**
 * log-events.ts - 结构化事件模板
 *
 * 为常见事件（tool / skill / permission / provider）提供类型安全的事件模板，
 * 自动归类 `kind` 字段、统一 message 格式、注入 scope。
 *
 * 设计动机：
 * - 标准化事件命名（kind 字段）：便于聚合查询 / 仪表盘分析
 * - 减少重复样板：调用方只需传业务字段
 * - 类型安全：每个事件有明确的入参 shape
 *
 * 用法：
 * ```ts
 * const log = Logger.child({ sessionId, turn, scope: 'tool' });
 * const events = createLogEvents(log);
 *
 * events.toolStart({ toolName: 'bash', input: { command: 'ls' } });
 * events.toolEnd({ toolName: 'bash', durationMs: 100, success: true });
 * events.toolError({ toolName: 'bash', error: new Error('boom'), durationMs: 50 });
 *
 * events.permissionGranted({ kind: 'bash', sessionId });
 * events.permissionDenied({ kind: 'bash', sessionId, reason: 'user denied' });
 * ```
 */

import type { ChildLogger } from './child-logger.js';
import { Logger } from './logger.js';

// ============================================================
// Tool 事件
// ============================================================

/**
 * Tool 事件模板。
 *
 * 标准化 tool 调用的生命周期事件：
 * - tool.start: 工具调用开始
 * - tool.end: 工具调用成功结束
 * - tool.error: 工具调用失败
 */
export type ToolEvents = {
  /** 工具调用开始 */
  toolStart: (params: {
    toolName: string;
    input?: Record<string, unknown>;
  }) => void;
  /** 工具调用成功结束 */
  toolEnd: (params: {
    toolName: string;
    durationMs: number;
    output?: Record<string, unknown>;
  }) => void;
  /** 工具调用失败 */
  toolError: (params: {
    toolName: string;
    durationMs: number;
    error: Error | { name: string; message: string; top_frame?: string; stack?: string };
  }) => void;
};

// ============================================================
// Skill 事件
// ============================================================

/**
 * Skill 事件模板。
 */
export type SkillEvents = {
  /** 技能调用开始 */
  skillStart: (params: { skillName: string; args?: Record<string, unknown> }) => void;
  /** 技能调用成功 */
  skillEnd: (params: { skillName: string; durationMs: number }) => void;
  /** 技能调用失败 */
  skillError: (params: { skillName: string; error: Error | { name: string; message: string } }) => void;
};

// ============================================================
// Permission 事件
// ============================================================

/**
 * Permission 事件模板。
 */
export type PermissionEvents = {
  /** 权限授予 */
  permissionGranted: (params: { kind: string; [key: string]: unknown }) => void;
  /** 权限拒绝 */
  permissionDenied: (params: { kind: string; reason: string; [key: string]: unknown }) => void;
};

// ============================================================
// Provider 事件
// ============================================================

/**
 * Provider 事件模板。
 */
export type ProviderEvents = {
  /** Provider 调用开始 */
  providerRequest: (params: { provider: string; model?: string; [key: string]: unknown }) => void;
  /** Provider 响应成功 */
  providerResponse: (params: {
    provider: string;
    durationMs: number;
    usage?: { inputTokens?: number; outputTokens?: number };
  }) => void;
  /** Provider 调用失败 */
  providerError: (params: {
    provider: string;
    error: Error | { name: string; message: string };
  }) => void;
};

// ============================================================
// LogEvents 总入口
// ============================================================

/**
 * 事件模板集合。
 *
 * 通过 `createLogEvents(childLogger)` 创建，所有事件自动写入该 child logger。
 */
export type LogEvents = {
  tool: ToolEvents;
  skill: SkillEvents;
  permission: PermissionEvents;
  provider: ProviderEvents;
};

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建事件模板集合。
 *
 * @param log - 子 logger 实例，事件写入此 logger
 * @returns 事件模板集合
 */
export function createLogEvents(log: ChildLogger): LogEvents {
  return {
    tool: createToolEvents(log),
    skill: createSkillEvents(log),
    permission: createPermissionEvents(log),
    provider: createProviderEvents(log),
  };
}

function createToolEvents(log: ChildLogger): ToolEvents {
  return {
    toolStart({ toolName, input }) {
      log.info({
        message: 'tool.start',
        data: {
          kind: 'tool_start',
          toolName,
          input,
        },
      });
    },
    toolEnd({ toolName, durationMs, output }) {
      log.info({
        message: 'tool.end',
        data: {
          kind: 'tool_end',
          toolName,
          durationMs,
          output,
        },
      });
    },
    toolError({ toolName, durationMs, error }) {
      log.error({
        message: 'tool.error',
        error,
        data: {
          kind: 'tool_error',
          toolName,
          durationMs,
        },
      });
    },
  };
}

function createSkillEvents(log: ChildLogger): SkillEvents {
  return {
    skillStart({ skillName, args }) {
      log.info({
        message: 'skill.start',
        data: {
          kind: 'skill_start',
          skillName,
          args,
        },
      });
    },
    skillEnd({ skillName, durationMs }) {
      log.info({
        message: 'skill.end',
        data: {
          kind: 'skill_end',
          skillName,
          durationMs,
        },
      });
    },
    skillError({ skillName, error }) {
      log.error({
        message: 'skill.error',
        error,
        data: {
          kind: 'skill_error',
          skillName,
        },
      });
    },
  };
}

function createPermissionEvents(log: ChildLogger): PermissionEvents {
  return {
    permissionGranted(params) {
      const { kind, ...rest } = params;
      log.info({
        message: 'permission.granted',
        data: { kind: 'permission_granted', permissionKind: kind, ...rest },
      });
    },
    permissionDenied(params) {
      const { kind, reason, ...rest } = params;
      log.warn({
        message: 'permission.denied',
        data: { kind: 'permission_denied', permissionKind: kind, reason, ...rest },
      });
    },
  };
}

function createProviderEvents(log: ChildLogger): ProviderEvents {
  return {
    providerRequest(params) {
      const { provider, ...rest } = params;
      log.debug({
        message: 'provider.request',
        data: { kind: 'provider_request', provider, ...rest },
      });
    },
    providerResponse({ provider, durationMs, usage }) {
      log.info({
        message: 'provider.response',
        data: {
          kind: 'provider_response',
          provider,
          durationMs,
          usage,
        },
      });
    },
    providerError({ provider, error }) {
      log.error({
        message: 'provider.error',
        error,
        data: { kind: 'provider_error', provider },
      });
    },
  };
}

// ============================================================
// logError helper
// ============================================================

/**
 * 一行记录错误（替代 try/catch 中的多行样板代码）。
 *
 * @param error - 错误实例或结构体
 * @param ctx - 错误上下文（sessionId/turn/scope 等）
 *
 * @example
 * ```ts
 * try { await tool.execute() }
 * catch (err) {
 *   logError(err, { scope: 'tool', sessionId, turn, message: 'execute failed', data: { toolName: 'bash' } });
 * }
 * ```
 */
export function logError(
  error: Error | { name: string; message: string; top_frame?: string; stack?: string },
  ctx: {
    sessionId: string;
    turn?: number;
    scope?: import('./types.js').LogScope;
    message: string;
    data?: Record<string, unknown>;
  },
): void {
  Logger.error({
    sessionId: ctx.sessionId,
    turn: ctx.turn,
    scope: ctx.scope ?? 'session',
    message: ctx.message,
    error,
    data: ctx.data,
  });
}