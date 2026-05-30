/**
 * tools-skill.ts - 工具列表技能
 *
 * 显示所有可用工具的详细信息。
 */

import { t } from '../../locales/index.js';
import type { Skill, SkillArgs, SkillExecutionContext, SkillResult } from '../skill-types.js';

/**
 * /tools 技能实现
 */
export const toolsSkill: Skill = {
  definition: {
    name: 'tools',
    description: t('skills.tools.description'),
    riskLevel: 'read',
    aliases: ['tls'],
    category: 'system',
    parameters: {
      filter: {
        type: 'string',
        description: t('skills.tools.filterDesc'),
      },
      detailed: {
        type: 'boolean',
        description: t('skills.tools.detailedDesc'),
        default: false,
      },
    },
    examples: ['/tools', '/tools --filter read', '/tools --detailed', '/tools bash'],
  },

  async execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult> {
    const filter = args.named.filter as string | undefined;
    const detailed = (args.named.detailed as boolean) ?? false;

    const toolNames = context.toolRegistry.list();

    // 应用过滤
    let filteredNames = toolNames;
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      // 检查是否是风险等级
      if (['read', 'write', 'execute'].includes(lowerFilter)) {
        filteredNames = toolNames.filter((name) => {
          const tool = context.toolRegistry.get(name);
          return tool?.riskLevel === lowerFilter;
        });
      } else {
        // 按名称前缀过滤
        filteredNames = toolNames.filter((name) => name.startsWith(lowerFilter));
      }
    }

    if (filteredNames.length === 0) {
      return {
        status: 'success',
        output: filter ? `${t('skills.tools.noMatch')}: ${filter}` : t('skills.tools.noTools'),
      };
    }

    const lines: string[] = [];
    lines.push(
      `# ${t('skills.tools.availableTools')} (${filteredNames.length} ${t('skills.tools.items')})`
    );
    lines.push('');

    // 按风险等级分组
    const byRisk = new Map<string, string[]>();
    for (const name of filteredNames) {
      const tool = context.toolRegistry.get(name);
      if (tool) {
        const level = tool.riskLevel;
        const existing = byRisk.get(level) ?? [];
        existing.push(name);
        byRisk.set(level, existing);
      }
    }

    const riskOrder = ['read', 'write', 'execute'];
    const riskLabels: Record<string, string> = {
      read: t('skills.tools.readOnly'),
      write: t('skills.tools.write'),
      execute: t('skills.tools.execute'),
    };

    for (const level of riskOrder) {
      const levelNames = byRisk.get(level);
      if (!levelNames || levelNames.length === 0) continue;

      lines.push(`## ${riskLabels[level]}`);
      lines.push('');

      for (const name of levelNames) {
        const tool = context.toolRegistry.get(name);
        if (!tool) continue;

        if (detailed) {
          lines.push(`### \`${name}\``);
          lines.push(`${t('skills.tools.riskLevel')} ${tool.riskLevel}`);
          lines.push('');

          // 检查工具是否有额外属性
          const toolAny = tool as any;
          if (toolAny.description) {
            lines.push(`${toolAny.description}`);
            lines.push('');
          }

          if (toolAny.parameters) {
            lines.push(`**${t('skills.tools.params')}**`);
            for (const [paramName, paramDef] of Object.entries(toolAny.parameters)) {
              const def = paramDef as any;
              const required = def.required ? t('skills.tools.required') : '';
              const defVal = def.default !== undefined ? ` = ${def.default}` : '';
              lines.push(
                `- \`${paramName}\`${required}${defVal}: ${def.description ?? def.type ?? 'unknown'}`
              );
            }
            lines.push('');
          }

          if (toolAny.examples?.length) {
            lines.push(`**${t('skills.tools.example')}**`);
            for (const example of toolAny.examples.slice(0, 3)) {
              lines.push(`- ${example}`);
            }
            lines.push('');
          }
        } else {
          lines.push(`- \`${name}\` (${tool.riskLevel})`);
        }
      }
      lines.push('');
    }

    if (!detailed) {
      lines.push(t('skills.tools.hint'));
    }

    return {
      status: 'success',
      output: lines.join('\n'),
    };
  },
};
