/**
 * roles/types.ts - 角色定义类型
 *
 * 角色（role）是「可复用的完整定义」，与皮肤（skin）正交：
 * - 角色定义在 `.wasteland/roles.json`（与 skins.json 对称）
 * - `settings.json multiAgent[name]` 通过 `{ role, skin }` 引用角色
 * - 加载时把角色定义展开合并进 multiAgent 条目，消费方拿到完整 SubAgentSettings
 *
 * 角色定义包含 promptTemplate / model / tools / skins 候选列表 / permissionMode
 * 等字段，结构与 SubAgentSettings 一致（见 settings-types.ts）。
 */

import type { PermissionMode } from '@core/engine/permission-gate.js';
import type { PromptTemplateRef } from '../prompts/prompt-types.js';

/**
 * 角色定义
 *
 * 每个角色是一份可复用的完整配置，可被多个 multiAgent 条目引用。
 * 字段与 SubAgentSettings 对齐（避免循环依赖，这里独立声明）。
 */
export interface RoleDefinition {
  /** 提示词模板（内置模板 ID 或自定义模板） */
  promptTemplate?: PromptTemplateRef;
  /** 角色描述（供 orchestrator 清单与配置页面显示） */
  description?: string;
  /** 模型选择（模型名，对应 settings.models） */
  model?: string;
  /** 权限模式 */
  permissionMode?: PermissionMode;
  /** 皮肤候选列表（spawn 时随机选一个可用） */
  skins?: string[];
  /** 单值皮肤（向后兼容，加入候选） */
  skin?: string;
  /** 可用工具白名单（逗号分隔字符串或数组） */
  tools?: string | string[];
  /** 子 agent 失败时自动重试次数 */
  maxRetries?: number;
  /** 重试间隔（毫秒） */
  retryDelayMs?: number;
  /** 失败时切换的备用模型 */
  fallbackModel?: string;
  [key: string]: unknown;
}

/** roles.json 文件格式：角色名 → 角色定义 */
export type RolesDefinition = Record<string, RoleDefinition>;

/** roles.json 完整文件结构 */
export interface RolesFile {
  roles: RolesDefinition;
}

/** 加载结果 */
export interface LoadedRoles {
  roles: RolesDefinition;
}