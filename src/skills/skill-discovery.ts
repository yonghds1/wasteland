/**
 * skill-discovery.ts - 技能发现
 *
 * 从文件系统自动发现和加载技能：
 * - 项目级: .rxc/skills/
 * - 用户级: ~/.rxc/skills/
 *
 * 支持格式：
 * - JSON: skill.json 或 *.json
 * - TypeScript: *.ts
 * - 目录: 包含 skill.json 的目录
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import type {
  Skill,
  SkillDefinition,
  SkillSource,
  SkillArgs,
  SkillExecutionContext,
  SkillResult,
  JsonSkillDefinition,
} from "./skill-types.js";
import { SkillRegistry } from "./skill-registry.js";
import { DEFAULT_SKILLS } from "./default-skills.js";

// ============================================================
// 技能文件格式
// ============================================================

type SkillFileFormat = "json" | "typescript" | "directory";

/**
 * 检测技能文件格式
 */
function detectFormat(filePath: string): SkillFileFormat {
  const ext = extname(filePath);
  if (ext === ".json") return "json";
  if (ext === ".ts" || ext === ".js") return "typescript";
  return "directory";
}

// ============================================================
// JSON 技能解析
// ============================================================

/**
 * 解析 JSON 技能定义
 */
async function parseJsonSkill(filePath: string): Promise<Skill> {
  const content = await readFile(filePath, "utf8");
  const raw = JSON.parse(content) as JsonSkillDefinition;

  // 验证必需字段
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error(`技能 ${filePath} 缺少 'name' 字段`);
  }
  if (!raw.description || typeof raw.description !== "string") {
    throw new Error(`技能 ${filePath} 缺少 'description' 字段`);
  }

  const definition: SkillDefinition = {
    name: raw.name,
    description: raw.description,
    riskLevel: raw.riskLevel ?? "read",
    parameters: raw.parameters,
    aliases: raw.aliases,
    category: raw.category,
    examples: raw.examples,
  };

  // JSON 技能使用模板执行
  return {
    definition,
    async execute(
      args: SkillArgs,
      context: SkillExecutionContext,
    ): Promise<SkillResult> {
      return executeJsonSkill(raw, args, context);
    },
  };
}

/**
 * 执行 JSON 定义的技能（模板模式）
 */
async function executeJsonSkill(
  def: JsonSkillDefinition,
  args: SkillArgs,
  context: SkillExecutionContext,
): Promise<SkillResult> {
  // 变量存储
  const variables: Record<string, unknown> = {
    ...args.named,
    args: args.positional,
    cwd: context.cwd,
  };

  // 执行步骤
  if (def.steps) {
    for (const step of def.steps) {
      // 解析变量
      const resolvedInput = resolveVariables(step.input, variables);

      // 获取工具
      const tool = context.toolRegistry.get(step.tool);
      if (!tool) {
        return {
          status: "error",
          output: `工具不存在: ${step.tool}`,
        };
      }

      context.output(`执行: ${step.tool}\n`);

      // 执行工具
      const result = await tool.execute(resolvedInput, {
        sessionId: context.sessionId,
        turn: context.turn,
        cwd: context.cwd,
      });

      if (result.status === "error") {
        return {
          status: "error",
          output: `步骤失败: ${result.error}`,
        };
      }

      // 保存结果
      if (step.saveAs) {
        variables[step.saveAs] = result.output;
      }
    }
  }

  // 生成输出
  if (def.template) {
    const output = resolveTemplate(def.template, variables);
    return { status: "success", output };
  }

  if (def.prompt) {
    // 发送给 agent 的提示
    const resolvedPrompt = resolveTemplate(def.prompt, variables);
    return {
      status: "success",
      output: resolvedPrompt,
      data: { sendToAgent: true },
    };
  }

  return {
    status: "success",
    output: "技能执行完成",
  };
}

/**
 * 解析变量值
 */
function resolveVariables(
  input: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      resolved[key] = resolveTemplate(value, variables);
    } else if (typeof value === "object" && value !== null) {
      resolved[key] = resolveVariables(
        value as Record<string, unknown>,
        variables,
      );
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * 解析模板字符串
 *
 * 支持 {{variable}} 语法
 */
function resolveTemplate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const value = variables[name];
    if (value === undefined) {
      return `{{${name}}}`; // 保留未定义的变量
    }
    if (Array.isArray(value)) {
      return value.join("\n");
    }
    return String(value);
  });
}

// ============================================================
// TypeScript 技能加载
// ============================================================

/**
 * 加载 TypeScript 技能模块
 */
async function loadTypeScriptSkill(filePath: string): Promise<Skill> {
  // 动态导入 (ESM)
  // 注意：需要确保文件是有效的 ESM 模块
  const module = await import(filePath);

  if (!module.default || typeof module.default !== "object") {
    throw new Error(`技能模块 ${filePath} 必须有默认导出`);
  }

  const skill = module.default as Skill;

  // 验证
  if (!skill.definition || !skill.execute) {
    throw new Error(`技能模块 ${filePath} 必须导出 Skill 对象`);
  }

  return skill;
}

// ============================================================
// 目录技能加载
// ============================================================

/**
 * 加载目录形式的技能
 */
async function loadDirectorySkill(dirPath: string): Promise<Skill> {
  const manifestPath = join(dirPath, "skill.json");

  // 检查是否有 handler 文件
  const handlerTsPath = join(dirPath, "handler.ts");
  const handlerJsPath = join(dirPath, "handler.js");

  let hasHandler = false;
  let handlerPath = "";

  try {
    await stat(handlerTsPath);
    hasHandler = true;
    handlerPath = handlerTsPath;
  } catch {
    try {
      await stat(handlerJsPath);
      hasHandler = true;
      handlerPath = handlerJsPath;
    } catch {
      // 没有 handler
    }
  }

  if (hasHandler) {
    return loadTypeScriptSkill(handlerPath);
  }

  // 否则使用 JSON manifest
  return parseJsonSkill(manifestPath);
}

// ============================================================
// 技能发现
// ============================================================

/**
 * 从目录发现技能
 */
export async function discoverSkills(
  skillsDir: string,
): Promise<Array<{ skill: Skill; source: SkillSource }>> {
  const results: Array<{ skill: Skill; source: SkillSource }> = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(skillsDir, entry.name);
      let skill: Skill;

      try {
        if (entry.isDirectory()) {
          skill = await loadDirectorySkill(fullPath);
        } else if (entry.isFile()) {
          const format = detectFormat(fullPath);
          if (format === "json") {
            skill = await parseJsonSkill(fullPath);
          } else if (format === "typescript") {
            skill = await loadTypeScriptSkill(fullPath);
          } else {
            continue; // 跳过不支持的格式
          }
        } else {
          continue;
        }

        results.push({
          skill,
          source: { type: "project", path: fullPath },
        });
      } catch (error) {
        console.error(
          `加载技能失败 ${fullPath}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } catch (error) {
    // 目录不存在，返回空
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return results;
}

// ============================================================
// 创建技能注册表
// ============================================================

/**
 * 创建包含发现技能的技能注册表
 *
 * @param params - 发现参数
 * @returns 初始化好的技能注册表
 */
export async function createSkillRegistry(params: {
  projectSkillsDir?: string;
  userSkillsDir?: string;
}): Promise<SkillRegistry> {
  const skills: Array<{ skill: Skill; source: SkillSource }> = [];

  // 加载内置技能
  for (const skill of DEFAULT_SKILLS) {
    skills.push({ skill, source: { type: "builtin" } });
  }

  // 加载项目技能
  if (params.projectSkillsDir) {
    const projectSkills = await discoverSkills(params.projectSkillsDir);
    skills.push(...projectSkills);
  }

  // 加载用户技能
  if (params.userSkillsDir) {
    const userSkills = await discoverSkills(params.userSkillsDir);
    skills.push(...userSkills);
  }

  return new SkillRegistry(skills);
}
