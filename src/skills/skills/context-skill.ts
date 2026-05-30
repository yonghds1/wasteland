/**
 * context-skill.ts - 项目上下文概览技能
 *
 * 显示项目的基本信息、结构和关键文件。
 */

import { join, relative } from 'node:path';
import { t } from '../../locales/index.js';
import type { Skill, SkillArgs, SkillExecutionContext, SkillResult } from '../skill-types.js';

/**
 * 获取项目基本信息
 */
async function getProjectInfo(
  context: SkillExecutionContext
): Promise<{ name: string; version: string; description: string }> {
  const readTool = context.toolRegistry.get('read-file');
  const packageJsonPath = join(context.cwd, 'package.json');

  if (!readTool) {
    return { name: 'Unknown', version: '', description: '' };
  }

  const result = await readTool.execute(
    { path: packageJsonPath },
    {
      sessionId: context.sessionId,
      turn: context.turn,
      cwd: context.cwd,
    }
  );

  if (result.status === 'success') {
    try {
      const pkg = JSON.parse(result.output);
      return {
        name: pkg.name ?? 'Unknown',
        version: pkg.version ?? '',
        description: pkg.description ?? '',
      };
    } catch {
      // JSON 解析失败
    }
  }

  return { name: 'Unknown', version: '', description: '' };
}

/**
 * 获取项目结构
 */
async function getProjectStructure(context: SkillExecutionContext): Promise<string[]> {
  const bashTool = context.toolRegistry.get('bash');
  if (!bashTool) {
    return [];
  }

  // 获取目录树（限制深度）
  const result = await bashTool.execute(
    {
      command:
        "find . -maxdepth 2 -type d -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | sort",
    },
    {
      sessionId: context.sessionId,
      turn: context.turn,
      cwd: context.cwd,
    }
  );

  if (result.status === 'success') {
    return result.output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => relative(context.cwd, line.trim()) || '.');
  }

  return [];
}

/**
 * 获取关键文件
 */
async function getKeyFiles(context: SkillExecutionContext): Promise<string[]> {
  const bashTool = context.toolRegistry.get('bash');
  if (!bashTool) {
    return [];
  }

  const result = await bashTool.execute(
    { command: "ls -la *.md *.json *.ts *.js 2>/dev/null | awk '{print $NF}' | head -20" },
    {
      sessionId: context.sessionId,
      turn: context.turn,
      cwd: context.cwd,
    }
  );

  if (result.status === 'success') {
    return result.output.split('\n').filter((line) => line.trim());
  }

  return [];
}

/**
 * /context 技能实现
 */
export const contextSkill: Skill = {
  definition: {
    name: 'context',
    description: t('skills.context.description'),
    riskLevel: 'read',
    aliases: ['ctx', 'info'],
    category: 'project',
    parameters: {
      detailed: {
        type: 'boolean',
        description: t('skills.context.detailedDesc'),
        default: false,
      },
    },
    examples: ['/context', '/ctx', '/context --detailed'],
  },

  async execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult> {
    const detailed = (args.named.detailed as boolean) ?? false;

    context.output(`${t('skills.context.collecting')}\n`);

    // 获取基本信息
    const info = await getProjectInfo(context);
    context.output(`${t('skills.context.project')} ${info.name}\n`);

    // 获取结构
    const structure = await getProjectStructure(context);
    context.output(
      `${t('skills.context.directory')} ${structure.length} ${t('skills.context.items')}\n`
    );

    // 获取关键文件
    const keyFiles = await getKeyFiles(context);
    context.output(
      `${t('skills.context.files')} ${keyFiles.length} ${t('skills.context.items')}\n`
    );

    // 构建输出
    const lines: string[] = [];

    // 基本信息部分
    lines.push(`## ${t('skills.context.overview')}`);
    lines.push('');
    lines.push(`**${t('skills.context.name')}**: ${info.name}`);
    if (info.version) {
      lines.push(`**${t('skills.context.version')}**: ${info.version}`);
    }
    if (info.description) {
      lines.push(`**${t('skills.context.description')}**: ${info.description}`);
    }
    lines.push('');

    // 目录结构部分
    lines.push(`## ${t('skills.context.structure')}`);
    lines.push('');
    if (detailed) {
      lines.push('```');
      for (const dir of structure) {
        lines.push(dir);
      }
      lines.push('```');
    } else {
      // 只显示顶层目录
      const topLevel = structure.filter((d) => !d.includes('/') && d !== '.');
      lines.push(topLevel.join(', '));
    }
    lines.push('');

    // 关键文件部分
    if (keyFiles.length > 0) {
      lines.push(`## ${t('skills.context.keyFiles')}`);
      lines.push('');
      const displayFiles = detailed ? keyFiles : keyFiles.slice(0, 10);
      for (const file of displayFiles) {
        lines.push(`- ${file}`);
      }
      if (!detailed && keyFiles.length > 10) {
        lines.push(
          `- ... ${t('skills.context.otherFiles', { count: String(keyFiles.length - 10) })}`
        );
      }
    }

    // 常用命令部分（从 package.json scripts）
    const readTool = context.toolRegistry.get('read-file');
    if (readTool) {
      const pkgResult = await readTool.execute(
        { path: join(context.cwd, 'package.json') },
        {
          sessionId: context.sessionId,
          turn: context.turn,
          cwd: context.cwd,
        }
      );

      if (pkgResult.status === 'success') {
        try {
          const pkg = JSON.parse(pkgResult.output);
          if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
            lines.push('');
            lines.push(`## ${t('skills.context.commonCommands')}`);
            lines.push('');
            for (const [name, cmd] of Object.entries(pkg.scripts).slice(0, 6)) {
              lines.push(`- \`npm run ${name}\` - ${cmd}`);
            }
          }
        } catch {
          // 忽略
        }
      }
    }

    return {
      status: 'success',
      output: lines.join('\n'),
    };
  },
};
