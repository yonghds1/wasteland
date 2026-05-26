/**
 * prompt-assembler.ts - 提示词组装器
 *
 * 核心组装流程：
 * 1. 配置加载 → 解析模板引用
 * 2. 模板解析 → 合并 defaults 和 promptVariables
 * 3. 内容加载 → 加载段落内容（支持文件引用）
 * 4. 变量插值 → 执行 {{variable}} 替换
 * 5. 组装输出 → 按 order 排序，用 XML 标签包裹
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import type {
  PromptAssemblyContext,
  PromptSection,
  PromptTemplate,
  PromptTemplateRef,
  ResolvedPrompt,
} from "./prompt-types.js";
import { getBuiltinRole, isBuiltinRoleId } from "./role-templates.js";
import { interpolateVariables } from "./variable-interpolator.js";

// ============================================================
// 模板引用解析
// ============================================================

/**
 * 解析模板引用
 *
 * 支持多种形式：
 * 1. 字符串 ID（内置模板）→ 查找预定义模板
 * 2. 字符串路径（文件）→ 加载 JSON 文件
 * 3. 简单字符串 → 包装成简单模板
 * 4. 内联对象 → 直接使用
 * 5. { template, variables } → 引用 + 变量覆盖
 *
 * @param ref - 模板引用
 * @param cwd - 工作目录（用于解析文件路径）
 * @returns 解析后的模板
 */
function resolveTemplateRef(
  ref: PromptTemplateRef,
  cwd: string,
): PromptTemplate {
  // 字符串引用
  if (typeof ref === "string") {
    // 检查是否为内置角色 ID
    if (isBuiltinRoleId(ref)) {
      const template = getBuiltinRole(ref);
      if (!template) {
        throw new Error(`内置角色不存在: ${ref}`);
      }
      return template;
    }

    // 检查是否为文件路径
    if (ref.endsWith(".json") || ref.endsWith(".md") || ref.endsWith(".txt")) {
      return loadTemplateFile(resolve(cwd, ref));
    }

    // 其他字符串作为简单提示词处理
    return {
      name: "simple-prompt",
      sections: [
        {
          id: "main",
          content: ref,
          order: 10,
        },
      ],
    };
  }

  // 内联定义
  if ("sections" in ref) {
    return ref;
  }

  // 引用 + 变量覆盖
  if ("template" in ref) {
    const baseTemplate = resolveTemplateRef(ref.template, cwd);
    return {
      ...baseTemplate,
      defaults: {
        ...baseTemplate.defaults,
        ...ref.variables,
      },
    };
  }

  throw new Error(`无效的模板引用: ${JSON.stringify(ref)}`);
}

/**
 * 从文件加载模板
 *
 * @param filePath - 文件路径
 * @returns 模板对象
 */
function loadTemplateFile(filePath: string): PromptTemplate {
  if (!existsSync(filePath)) {
    throw new Error(`模板文件不存在: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");

  // JSON 文件
  if (filePath.endsWith(".json")) {
    return JSON.parse(content) as PromptTemplate;
  }

  // Markdown/Text 文件 → 转为简单模板
  return {
    name: `template:${filePath}`,
    sections: [
      {
        id: "main",
        content: content.trim(),
        order: 10,
      },
    ],
  };
}

// ============================================================
// 段落内容加载
// ============================================================

/**
 * 加载段落内容
 *
 * 支持字符串内容或文件引用 { $ref: "path" }
 *
 * @param section - 段落定义
 * @param cwd - 工作目录
 * @returns 段落内容字符串
 */
function loadSectionContent(section: PromptSection, cwd: string): string {
  if (typeof section.content === "string") {
    return section.content;
  }

  // 文件引用
  const filePath = resolve(cwd, section.content.$ref);
  if (!existsSync(filePath)) {
    throw new Error(`段落文件不存在: ${filePath}`);
  }

  return readFileSync(filePath, "utf-8").trim();
}

// ============================================================
// 变量合并
// ============================================================

/**
 * 合并变量（按优先级）
 *
 * 优先级：defaults < context.variables < promptVariables
 *
 * @param template - 模板定义
 * @param context - 组装上下文
 * @param promptVariables - 角色配置的变量覆盖
 * @returns 合并后的变量对象
 */
function mergeVariables(
  template: PromptTemplate,
  context: PromptAssemblyContext,
  promptVariables?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...template.defaults,
    ...context.variables,
    ...promptVariables,
    // 添加上下文变量
    __role: context.roleName,
    __model: context.model,
    __tools: context.tools?.join(", "),
  };
}

// ============================================================
// 提示词组装
// ============================================================

/**
 * 组装提示词
 *
 * @param template - 模板定义
 * @param context - 组装上下文
 * @param promptVariables - 变量覆盖
 * @returns 组装结果
 */
function assembleTemplate(
  template: PromptTemplate,
  context: PromptAssemblyContext,
  promptVariables?: Record<string, unknown>,
): ResolvedPrompt {
  // 合并变量
  const variables = mergeVariables(template, context, promptVariables);

  // 加载并插值每个段落
  const resolvedSections: Array<{ id: string; content: string; order: number }> =
    [];

  for (const section of template.sections) {
    // 加载内容
    let content = loadSectionContent(section, context.cwd);

    // 执行插值
    content = interpolateVariables(content, variables);

    // 跳过空内容（可选）
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

  // 用 XML 标签包裹并连接
  const contentParts = resolvedSections.map(
    (s) => `<section id="${s.id}">\n${s.content}\n</section>`,
  );

  return {
    content: contentParts.join("\n\n"),
    includedSections: resolvedSections.map((s) => s.id),
    resolvedVariables: variables,
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

  /**
   * 组装提示词
   *
   * @param ref - 模板引用
   * @param context - 组装上下文
   * @param promptVariables - 变量覆盖
   * @returns 组装结果
   */
  assemble(
    ref: PromptTemplateRef,
    context: PromptAssemblyContext,
    promptVariables?: Record<string, unknown>,
  ): ResolvedPrompt {
    // 解析模板引用
    const template = resolveTemplateRef(ref, this.cwd);

    // 组装
    return assembleTemplate(template, context, promptVariables);
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 组装提示词（便捷函数）
 *
 * @param ref - 模板引用
 * @param context - 组装上下文
 * @param promptVariables - 变量覆盖
 * @returns 组装后的提示词字符串
 */
export function assemblePrompt(
  ref: PromptTemplateRef,
  context: PromptAssemblyContext,
  promptVariables?: Record<string, unknown>,
): string {
  const assembler = new PromptAssembler({ cwd: context.cwd });
  const result = assembler.assemble(ref, context, promptVariables);
  return result.content;
}
