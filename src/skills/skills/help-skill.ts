/**
 * help-skill.ts - 帮助技能
 *
 * 显示系统帮助信息,包括可用命令、工具和技能列表。
 *
 * 命令列表(commands 段)从 CommandManager 单一来源读取,确保:
 * - 自动包含所有已注册 skill(/help /status /tools /init /ctx ...)
 * - 不漏列(/sessions /logs /clear /exit 等)
 * - 不重复(/clear /exit 只在 local 段出现 1 次)
 */

import { t } from '@locales/index.js';
import type { Skill, SkillArgs, SkillExecutionContext, SkillResult } from '../skill-types.js';
import { getCommandManager } from '@core/shared/command-manager.js';

/**
 * /help 技能实现
 */
export const helpSkill: Skill = {
  definition: {
    name: 'help',
    get description() { return t('skills.help.description'); },
    riskLevel: 'read',
    aliases: ['h'],
    category: 'system',
    parameters: {
      topic: {
        type: 'string',
        get description() { return t('skills.help.topicDesc'); },
        default: 'all',
        enum: ['commands', 'tools', 'skills', 'all'],
      },
    },
    examples: ['/help', '/help commands', '/help tools', '/help skills'],
  },

  async execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult> {
    const topic = (args.named.topic as string) ?? 'all';
    const lines: string[] = [];

    lines.push(`# ${t('skills.help.title')}`);
    lines.push('');

    if (topic === 'all' || topic === 'commands') {
      lines.push(`## ${t('skills.help.commands')}`);
      lines.push('');

      // 从 CommandManager 单一来源读取命令,按 category 分组。
      // 涵盖 skill / local / session / exit 全部分类,自动包含所有已注册 skill。
      const manager = getCommandManager();
      const categories = ['skill', 'session', 'local', 'exit'] as const;
      for (const cat of categories) {
        const entries = manager.getByCategory(cat);
        if (entries.length === 0) continue;
        lines.push(`### ${t(`skills.help.categories.${cat}`)}`);
        for (const entry of entries) {
          const aliases =
            entry.aliases.length > 0
              ? `, ${entry.aliases.map((a) => `\`${a}\``).join(', ')}`
              : '';
          lines.push(`- \`${entry.name}\`${aliases} - ${t(entry.description)}`);
        }
        lines.push('');
      }

      lines.push(`### ${t('skills.help.shortcuts')}`);
      lines.push(`- \`Tab\` - ${t('skills.help.switchFocus')}`);
      lines.push(`- \`Enter\` - ${t('skills.help.sendMessage')}`);
      lines.push(`- \`Esc\` - ${t('skills.help.cancelInput')}`);
      lines.push(`- \`Ctrl+C\` - ${t('skills.help.exit')}`);
      lines.push('');
    }

    if (topic === 'all' || topic === 'tools') {
      lines.push(`## ${t('skills.help.builtInTools')}`);
      lines.push('');
      const toolNames = context.toolRegistry.list();

      // 按风险等级分组
      const readTools: string[] = [];
      const writeTools: string[] = [];
      const executeTools: string[] = [];

      for (const name of toolNames) {
        const tool = context.toolRegistry.get(name);
        if (tool) {
          switch (tool.riskLevel) {
            case 'read':
              readTools.push(name);
              break;
            case 'write':
              writeTools.push(name);
              break;
            case 'execute':
              executeTools.push(name);
              break;
          }
        }
      }

      if (readTools.length > 0) {
        lines.push(`### ${t('skills.help.readOnlyTools')}`);
        for (const name of readTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push('');
      }

      if (writeTools.length > 0) {
        lines.push(`### ${t('skills.help.writeTools')}`);
        for (const name of writeTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push('');
      }

      if (executeTools.length > 0) {
        lines.push(`### ${t('skills.help.executeTools')}`);
        for (const name of executeTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push('');
      }
    }

    if (topic === 'all' || topic === 'skills') {
      lines.push(`## ${t('skills.help.skillSystem')}`);
      lines.push('');
      lines.push(t('skills.help.skillDescription'));
      lines.push('');
      lines.push(t('skills.help.usage'));
      lines.push('```');
      lines.push(
        `/<${t('skills.help.skillName')}> [${t('skills.help.params')}] [${t('skills.help.options')}]`
      );
      lines.push('```');
      lines.push('');
      lines.push(t('skills.help.example'));
      lines.push('```');
      lines.push(`/init              # ${t('skills.help.initContext')}`);
      lines.push(`/ctx               # ${t('skills.help.showOverview')}`);
      lines.push(`/help              # ${t('skills.help.showHelp')}`);
      lines.push('```');
      lines.push('');
      lines.push(t('skills.help.runSkillsHint'));
      lines.push('');
    }

    lines.push('---');
    lines.push(`${t('skills.help.currentSession')} ${context.sessionId}`);
    lines.push(`${t('skills.help.workDir')} ${context.cwd}`);

    return {
      status: 'success',
      output: lines.join('\n'),
    };
  },
};
