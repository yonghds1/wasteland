/**
 * prompt-assembler.ts - 提示词组装器
 *
 * 核心组装流程：
 * 1. 配置加载 → 解析模板引用
 * 2. 模板解析 → 获取模板定义
 * 3. 内容加载 → 加载段落内容（支持文件引用）
 * 4. 组装输出 → 按 order 排序，用 markdown 或 XML 格式包裹
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import type {
  PromptAssemblyContext,
  PromptSection,
  PromptTemplate,
  PromptTemplateRef,
  ResolvedPrompt,
} from './prompt-types.js';
import { getProjectRulesSection } from './project-rules-loader.js';
import { getBuiltinRole, isBuiltinRoleId } from './role-templates.js';
import { t } from '@locales/index.js';

// ============================================================
// 模板引用解析
// ============================================================

/**
 * 解析模板引用
 */
function resolveTemplateRef(ref: PromptTemplateRef, cwd: string): PromptTemplate {
  if (typeof ref === 'string') {
    if (isBuiltinRoleId(ref)) {
      const template = getBuiltinRole(ref);
      if (!template) {
        throw new Error(t('prompts.builtinRoleNotFound', { ref }));
      }
      return template;
    }

    if (ref.endsWith('.json') || ref.endsWith('.md') || ref.endsWith('.txt')) {
      return loadTemplateFile(resolve(cwd, ref));
    }

    return {
      name: 'simple-prompt',
      sections: [{ id: 'main', content: ref, order: 10 }],
    };
  }

  if ('sections' in ref) {
    return ref;
  }

  throw new Error(t('prompts.invalidTemplateRef', { ref: JSON.stringify(ref) }));
}

/**
 * 从文件加载模板
 */
function loadTemplateFile(filePath: string): PromptTemplate {
  if (!existsSync(filePath)) {
    throw new Error(t('prompts.templateFileNotFound', { filePath }));
  }

  const content = readFileSync(filePath, 'utf-8');

  if (filePath.endsWith('.json')) {
    return JSON.parse(content) as PromptTemplate;
  }

  return {
    name: `template:${filePath}`,
    sections: [{ id: 'main', content: content.trim(), order: 10 }],
  };
}

// ============================================================
// 段落内容加载
// ============================================================

/**
 * 加载段落内容（支持字符串内容或文件引用 { $ref: "path" }）
 */
function loadSectionContent(section: PromptSection, cwd: string): string {
  if (typeof section.content === 'string') {
    return section.content;
  }

  const filePath = resolve(cwd, section.content.$ref);
  if (!existsSync(filePath)) {
    throw new Error(t('prompts.sectionFileNotFound', { filePath }));
  }

  return readFileSync(filePath, 'utf-8').trim();
}

// ============================================================
// 提示词组装
// ============================================================

/**
 * 组装提示词
 */
function assembleTemplate(
  template: PromptTemplate,
  context: PromptAssemblyContext,
  format: 'markdown' | 'xml' = 'markdown'
): ResolvedPrompt {
  const sectionsToAssemble = [...template.sections];

  // 自动探测并注入工作区项目规则（若工作区存在规则且模板未显式定义 project-rules）
  if (context.cwd && !sectionsToAssemble.some((s) => s.id === 'project-rules')) {
    const rulesSection = getProjectRulesSection(context.cwd);
    if (rulesSection) {
      sectionsToAssemble.push(rulesSection);
    }
  }

  const resolvedSections: Array<{ id: string; content: string; order: number }> = [];

  for (const section of sectionsToAssemble) {
    const content = loadSectionContent(section, context.cwd);
    if (!content.trim()) {
      continue;
    }
    resolvedSections.push({
      id: section.id,
      content,
      order: section.order ?? 50,
    });
  }

  // 按 order 排序
  resolvedSections.sort((a, b) => a.order - b.order);

  // 按格式包裹并连接
  const contentParts = resolvedSections.map((s) => {
    if (format === 'xml') {
      return `<${s.id}>\n${s.content}\n</${s.id}>`;
    }
    const title = s.id
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${title}\n${s.content}`;
  });

  return {
    content: contentParts.join('\n\n'),
    includedSections: resolvedSections.map((s) => s.id),
    resolvedVariables: {},
  };
}

// ============================================================
// PromptAssembler 类
// ============================================================

/**
 * 提示词组装器
 */
export class PromptAssembler {
  private cwd: string;

  constructor(params: { cwd: string }) {
    this.cwd = params.cwd;
  }

  assemble(
    ref: PromptTemplateRef,
    context: PromptAssemblyContext,
    format: 'markdown' | 'xml' = 'markdown'
  ): ResolvedPrompt {
    const template = resolveTemplateRef(ref, this.cwd);
    return assembleTemplate(template, context, format);
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 组装提示词（便捷函数）
 */
export function assemblePrompt(
  ref: PromptTemplateRef,
  context: PromptAssemblyContext,
  format: 'markdown' | 'xml' = 'markdown'
): string {
  const assembler = new PromptAssembler({ cwd: context.cwd });
  const result = assembler.assemble(ref, context, format);
  return result.content;
}
