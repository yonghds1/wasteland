/**
 * skill-executor.ts - 技能执行器
 *
 * 负责技能的执行协调：
 * - 解析参数
 * - 验证参数
 * - 权限检查
 * - 执行技能
 * - 发出运行时事件
 */

import { Observable, of } from 'rxjs';

import type { SkillRegistry } from './skill-registry.js';
import type { SkillExecutionContext, Skill } from './skill-types.js';
import {
  applyDefaults,
  parseSkillArgs,
  validateSkillArgs,
  generateArgsHelp,
} from './skill-parser.js';
import { t } from '@locales/index.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';
import type { ToolRegistry } from '@tools/core/tool-registry.js';
import type { PermissionGate } from '@core/engine/permission-gate.js';
import type { SessionManager, SessionMetadata } from '@core/session/session-manager.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { SessionMessageRecord } from '@core/runtime/event-types.js';

/**
 * 技能执行器参数
 */
export type SkillExecutorParams = {
  /** 用户输入的完整命令 */
  input: string;
  /** 会话 ID */
  sessionId: string;
  /** 当前轮次 */
  turn: number;
  /** 当前工作目录 */
  cwd: string;
  /** 会话元数据 */
  session: SessionMetadata;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 权限闸门 */
  permissionGate: PermissionGate;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** Provider 实例（可选） */
  provider?: AgentProvider;
  /** 历史消息 */
  history: SessionMessageRecord[];
  /** 输出函数 */
  output: (message: string) => void;
};

/**
 * 技能执行器
 *
 * 负责技能的执行协调。
 *
 * @example
 * const executor = new SkillExecutor(skillRegistry);
 *
 * if (executor.isSkillCommand("/init --force")) {
 *   const events$ = executor.execute({
 *     input: "/init --force",
 *     sessionId: "...",
 *     ...
 *   });
 *
 *   events$.subscribe(event => {
 *     if (event.type === "skill_result") {
 *       console.log(event.result.output);
 *     }
 *   });
 * }
 */
export class SkillExecutor {
  constructor(private readonly registry: SkillRegistry) {}

  /**
   * 获取底层 SkillRegistry
   *
   * 用于跨模块同步 skill 元数据的场景（如 help-skill）。
   * 不应被业务代码直接访问。
   */
  getSkillRegistry(): SkillRegistry {
    return this.registry;
  }

  /**
   * 检查输入是否为技能命令
   */
  isSkillCommand(input: string): boolean {
    return this.registry.isSkillCommand(input);
  }

  /**
   * 执行技能命令
   *
   * @param params - 执行参数
   * @returns RuntimeEvent 的 Observable 流
   */
  execute(params: SkillExecutorParams): Observable<RuntimeEvent> {
    const { input, sessionId, turn, session } = params;

    // 解析技能名称
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const skillName = parts[0]?.slice(1) ?? ''; // 去掉 /

    // 查找技能
    const registered = this.registry.get(skillName);

    if (!registered) {
      return of<RuntimeEvent>({
        type: 'skill_result',
        sessionId,
        turn,
        skillName,
        result: {
          status: 'error',
          output: `${t('skills.common.unknownSkill')} ${skillName}`,
        },
      });
    }

    const { skill } = registered;

    // 解析参数
    const args = parseSkillArgs(input);

    // 验证参数
    const validation = validateSkillArgs(args, skill.definition);
    if (!validation.valid) {
      return of<RuntimeEvent>({
        type: 'skill_result',
        sessionId,
        turn,
        skillName,
        result: {
          status: 'error',
          output: `${t('skills.common.paramError')}\n${validation.errors.join('\n')}\n\n${this.createSkillHelp(skill)}`,
        },
      });
    }

    // 应用默认值
    const finalArgs = applyDefaults(args, skill.definition);

    // 创建执行上下文
    const context: SkillExecutionContext = {
      sessionId,
      turn,
      cwd: params.cwd,
      session,
      toolRegistry: params.toolRegistry,
      permissionGate: params.permissionGate,
      sessionManager: params.sessionManager,
      provider: params.provider,
      history: params.history,
      output: params.output,
    };

    // 发出 skill_started 事件
    const startedEvent: RuntimeEvent = {
      type: 'skill_started',
      sessionId,
      turn,
      skillName,
      args: finalArgs,
    };

    // 简化版本：先发 started，再执行
    // 使用 RxJS Observable
    return new Observable<RuntimeEvent>((subscriber) => {
      // 发送开始事件
      subscriber.next(startedEvent);

      // 执行技能
      skill
        .execute(finalArgs, context)
        .then((result) => {
          subscriber.next({
            type: 'skill_result',
            sessionId,
            turn,
            skillName,
            result,
          });
          subscriber.complete();
        })
        .catch((error) => {
          subscriber.next({
            type: 'skill_result',
            sessionId,
            turn,
            skillName,
            result: {
              status: 'error',
              output: error instanceof Error ? error.message : String(error),
            },
          });
          subscriber.complete();
        });
    });
  }

  /**
   * 创建技能帮助文本
   */
  private createSkillHelp(skill: Skill): string {
    const def = skill.definition;
    const lines: string[] = [];

    lines.push(`/${def.name} - ${def.description}`);

    if (def.aliases?.length) {
      lines.push(`${t('skills.common.alias')} ${def.aliases.map((a) => `/${a}`).join(', ')}`);
    }

    lines.push('');
    lines.push(t('skills.common.params'));
    lines.push(generateArgsHelp(def));

    if (def.examples?.length) {
      lines.push('');
      lines.push(t('skills.common.example'));
      for (const example of def.examples) {
        lines.push(`  ${example}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 创建 /skills 命令的帮助文本
   */
  createSkillsHelp(): string {
    const skills = this.registry.list();

    if (skills.length === 0) {
      return t('skills.common.noSkills');
    }

    // 按分类分组
    const byCategory = new Map<string, typeof skills>();
    for (const skill of skills) {
      const category = skill.category ?? 'general';
      const existing = byCategory.get(category) ?? [];
      existing.push(skill);
      byCategory.set(category, existing);
    }

    const lines: string[] = [t('skills.common.availableSkills'), ''];

    for (const [category, categorySkills] of byCategory) {
      lines.push(`[${category}]`);
      for (const skill of categorySkills) {
        const aliases = skill.aliases?.length
          ? ` (${skill.aliases.map((a) => `/${a}`).join(', ')})`
          : '';
        lines.push(`  /${skill.name}${aliases}`);
        lines.push(`    ${skill.description}`);
        if (skill.examples?.length) {
          lines.push(`    ${t('skills.common.example')} ${skill.examples[0]}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
