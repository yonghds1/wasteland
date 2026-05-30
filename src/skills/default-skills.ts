/**
 * default-skills.ts - 内置技能注册
 *
 * 导出所有内置技能，供 SkillRegistry 注册使用。
 */

import type { Skill } from './skill-types.js';
import { initSkill } from './skills/init-skill.js';
import { contextSkill } from './skills/context-skill.js';
import { helpSkill } from './skills/help-skill.js';
import { statusSkill } from './skills/status-skill.js';
import { toolsSkill } from './skills/tools-skill.js';

/**
 * 内置技能列表
 *
 * 包含所有随 rx-cli 发布的内置技能。
 */
export const DEFAULT_SKILLS: Skill[] = [
  // 系统技能
  helpSkill,
  statusSkill,
  toolsSkill,

  // 项目技能
  initSkill,
  contextSkill,

  // 未来可以添加更多内置技能:
  // reviewSkill,    // 代码审查
  // testSkill,      // 测试运行
  // refactorSkill,  // 重构辅助
  // docSkill,       // 文档生成
];

/**
 * 获取内置技能名称列表
 */
export function getBuiltinSkillNames(): string[] {
  return DEFAULT_SKILLS.map((skill) => skill.definition.name);
}
