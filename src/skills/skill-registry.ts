/**
 * skill-registry.ts - 技能注册表
 *
 * 提供技能的注册、查找和列表功能。
 * 支持名称和别名查找。
 */

import type { Skill, SkillDefinition, SkillSource, RegisteredSkill } from './skill-types.js';

/**
 * 技能注册表
 *
 * 管理所有已注册的技能，支持：
 * - 按名称查找
 * - 按别名查找
 * - 列表和过滤
 * - 检测是否为技能命令
 *
 * @example
 * const registry = new SkillRegistry();
 * registry.register(mySkill, { type: "builtin" });
 *
 * // 查找
 * const entry = registry.get("init"); // 按名称
 * const entry = registry.get("i");    // 按别名
 *
 * // 检测
 * if (registry.isSkillCommand("/init --template minimal")) {
 *   // 执行技能
 * }
 */
export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly aliases = new Map<string, string>();

  constructor(skills: Array<{ skill: Skill; source: SkillSource }> = []) {
    for (const { skill, source } of skills) {
      this.register(skill, source);
    }
  }

  /**
   * 注册一个技能
   *
   * @param skill - 技能实例
   * @param source - 技能来源
   */
  register(skill: Skill, source: SkillSource): void {
    const entry: RegisteredSkill = { skill, source };
    this.skills.set(skill.definition.name, entry);

    // 注册别名
    for (const alias of skill.definition.aliases ?? []) {
      this.aliases.set(alias, skill.definition.name);
    }
  }

  /**
   * 按名称或别名获取技能
   *
   * @param nameOrAlias - 技能名称或别名
   * @returns 注册的技能条目，如果不存在返回 undefined
   */
  get(nameOrAlias: string): RegisteredSkill | undefined {
    // 先尝试直接名称查找
    const direct = this.skills.get(nameOrAlias);
    if (direct) return direct;

    // 再尝试别名查找
    const realName = this.aliases.get(nameOrAlias);
    if (realName) return this.skills.get(realName);

    return undefined;
  }

  /**
   * 获取技能定义列表
   *
   * @param filter - 可选的过滤条件
   * @returns 技能定义数组
   */
  list(filter?: { category?: string; source?: SkillSource['type'] }): SkillDefinition[] {
    const entries = Array.from(this.skills.values());

    return entries
      .filter(({ skill, source }) => {
        // 分类过滤
        if (filter?.category && skill.definition.category !== filter.category) {
          return false;
        }
        // 来源过滤
        if (filter?.source && source.type !== filter.source) {
          return false;
        }
        return true;
      })
      .map(({ skill }) => skill.definition);
  }

  /**
   * 检查输入是否为有效的技能命令
   *
   * @param input - 用户输入字符串
   * @returns 如果是技能命令返回 true
   *
   * @example
   * registry.isSkillCommand("/init")          // true
   * registry.isSkillCommand("/init --force")  // true
   * registry.isSkillCommand("/help")          // false (本地命令)
   * registry.isSkillCommand("hello")          // false
   */
  isSkillCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return false;

    // 提取命令名称（第一个空格之前，去掉 /）
    const name = trimmed.slice(1).split(/\s/)[0];
    if (!name) return false;

    return this.get(name) !== undefined;
  }

  /**
   * 获取所有技能名称（包括别名）
   *
   * @returns 名称和别名的数组
   */
  getAllNames(): string[] {
    const names = new Set<string>();

    for (const name of this.skills.keys()) {
      names.add(name);
    }

    for (const alias of this.aliases.keys()) {
      names.add(alias);
    }

    return Array.from(names);
  }

  /**
   * 获取技能数量
   */
  get size(): number {
    return this.skills.size;
  }
}
