/**
 * project-rules-loader.ts - 工作区项目规则与架构记忆自动装配器
 *
 * 优先兼容生态标准（CLAUDE.md / PROJECT.md / .wasteland/*），
 * 自动提取工作区架构约束与项目级规范，注入 Agent 核心上下文。
 *
 * 特性：
 * - 规则文件探测：按标准优先级链探测当前工作区
 * - 安全长度上限：超长文本安全截断并提示，防止上下文恶性膨胀
 * - 提示词段落构造：生成高优先级 PromptSection（order: 5）
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PromptSection } from './prompt-types.js';

// ============================================================
// 常量与配置
// ============================================================

/**
 * 候选规则文件列表（按探测优先级依序排列）
 *
 * 1. CLAUDE.md - 业界标准生态约定
 * 2. PROJECT.md - 通用项目规范
 * 3. .wasteland/rules.md - Wasteland 专属规则
 * 4. .wasteland/CLAUDE.md - Wasteland 局部约定
 */
export const PROJECT_RULES_CANDIDATES = [
  'CLAUDE.md',
  'PROJECT.md',
  '.wasteland/rules.md',
  '.wasteland/CLAUDE.md',
] as const;

/**
 * 规则内容最大字符数限制（15,000 字符，约 3k Token）
 */
export const MAX_PROJECT_RULES_LENGTH = 15000;

/**
 * 超长截断后的追加提示语
 */
export const RULES_TRUNCATION_NOTICE =
  `\n\n[Project rules truncated: exceeded ${MAX_PROJECT_RULES_LENGTH} characters]`;

// ============================================================
// 类型定义
// ============================================================

/**
 * 项目规则探测结果
 */
export type ProjectRulesResult = {
  /** 是否探测到有效的项目规则 */
  found: boolean;
  /** 探测到的规则文件绝对路径 */
  filePath?: string;
  /** 规则文件内容（已截断与去除首尾空白） */
  content?: string;
};

// ============================================================
// 核心逻辑
// ============================================================

/**
 * 探测工作区项目规则文件
 *
 * 按优先级依序探测当前工作区文件：
 * 1. CLAUDE.md
 * 2. PROJECT.md
 * 3. .wasteland/rules.md
 * 4. .wasteland/CLAUDE.md
 *
 * 若存在且可读，读取内容并去除两端空白；
 * 限制最大长度（最多 15,000 字符），超过部分安全截断并追加提示；
 * 若均不存在或读取失败，返回 { found: false }。
 *
 * @param cwd - 工作区根目录
 * @returns 探测结果
 */
export function detectProjectRules(cwd: string): ProjectRulesResult {
  if (!cwd || typeof cwd !== 'string') {
    return { found: false };
  }

  for (const candidate of PROJECT_RULES_CANDIDATES) {
    const fullPath = resolve(cwd, candidate);

    try {
      if (!existsSync(fullPath)) {
        continue;
      }

      const stat = statSync(fullPath);
      if (!stat.isFile()) {
        continue;
      }

      const raw = readFileSync(fullPath, 'utf-8');
      const trimmed = raw.trim();

      if (!trimmed) {
        continue;
      }

      let content = trimmed;
      if (content.length > MAX_PROJECT_RULES_LENGTH) {
        content = content.slice(0, MAX_PROJECT_RULES_LENGTH) + RULES_TRUNCATION_NOTICE;
      }

      return {
        found: true,
        filePath: fullPath,
        content,
      };
    } catch {
      // 文件不可读或无权限时，平滑降级探测下一候选项
      continue;
    }
  }

  return { found: false };
}

/**
 * 获取提示词组装用的项目规则段落
 *
 * 若发现规则文件，构造返回 PromptSection：
 * - id: 'project-rules'
 * - content: content
 * - order: 5（高优先级，排在通用系统 prompt 之后、具体任务之前）
 * 若未发现返回 null。
 *
 * @param cwd - 工作区根目录
 * @returns PromptSection 或 null
 */
export function getProjectRulesSection(cwd: string): PromptSection | null {
  const result = detectProjectRules(cwd);
  if (!result.found || !result.content) {
    return null;
  }

  return {
    id: 'project-rules',
    content: result.content,
    order: 5,
  };
}
