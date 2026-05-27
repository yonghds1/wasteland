/**
 * prompt-types.ts - 提示词组装系统核心类型定义
 *
 * 采用业界通用的三层结构：
 * - 身份层 (Identity): role + goal + backstory
 * - 能力层 (Capabilities): tools + constraints
 * - 行为层 (Behavior): workflow + outputFormat
 *
 * 参考：
 * - CrewAI: role/goal/backstory 三元组
 * - AutoGPT: tools/constraints/resources 结构
 * - LangChain: 模板化变量注入
 */

// ============================================================
// 角色定义（核心）
// ============================================================

/**
 * 角色定义 - 定义一个 Agent 的身份、能力和行为
 *
 * @property name - 角色名称（用于引用），如 "coder", "reviewer"
 * @property role - 角色描述，如 "Senior Software Developer"
 * @property goal - 目标，如 "Write clean, maintainable code"
 * @property backstory - 背景故事，定义行为模式和专长
 * @property tools - 可用工具列表
 * @property constraints - 约束条件
 * @property workflow - 工作流程
 * @property outputFormat - 输出格式要求
 *
 * @example
 * const coderRole: RoleDefinition = {
 *   name: "coder",
 *   role: "Senior Software Developer",
 *   goal: "Write clean, efficient, and maintainable code",
 *   backstory: "You are an experienced developer with 10 years of experience...",
 *   tools: ["bash", "read", "edit", "write"],
 *   constraints: ["Always test your changes", "Follow existing code style"],
 *   workflow: "1. Understand → 2. Plan → 3. Implement → 4. Test"
 * };
 */
export type RoleDefinition = {
  // === 身份层 ===
  name: string;
  role: string;
  goal: string;
  backstory?: string;

  // === 能力层 ===
  tools?: string[];
  constraints?: string[];

  // === 行为层 ===
  workflow?: string;
  outputFormat?: string;
};

// ============================================================
// 提示词段落
// ============================================================

/**
 * 提示词段落 - 可组合的最小单元
 *
 * @property id - 段落标识符，用于调试和覆盖
 * @property content - 段落内容（字符串）或文件引用
 * @property order - 排序权重（数字小的在前）
 */
export type PromptSection = {
  id: string;
  content: string | { $ref: string };
  order?: number;
};

// ============================================================
// 提示词模板
// ============================================================

/**
 * 变量定义
 */
export type PromptVariableDef = {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
  default?: unknown;
};

/**
 * 提示词模板定义
 *
 * @property name - 模板名称（显示用）
 * @property id - 模板 ID（引用用）
 * @property description - 模板描述
 * @property sections - 段落列表
 * @property variables - 变量定义
 * @property defaults - 默认变量值
 */
export type PromptTemplate = {
  name: string;
  id?: string;
  description?: string;
  sections: PromptSection[];
  variables?: Record<string, PromptVariableDef>;
  defaults?: Record<string, unknown>;
};

// ============================================================
// 模板引用
// ============================================================

/**
 * 提示词模板引用
 *
 * 支持三种形式：
 * 1. 字符串：模板 ID 或文件路径
 * 2. 内联定义：直接提供 PromptTemplate 对象
 * 3. 引用 + 覆盖：引用模板并覆盖变量
 *
 * @example
 * // 字符串引用（内置角色）
 * promptTemplate: "role-coder"
 *
 * // 字符串引用（文件路径）
 * promptTemplate: "./prompts/my-template.json"
 *
 * // 内联定义
 * promptTemplate: { name: "custom", sections: [...] }
 *
 * // 引用 + 变量覆盖
 * promptTemplate: { template: "role-coder", variables: { role: "Reviewer" } }
 */
export type PromptTemplateRef =
  | string
  | PromptTemplate
  | {
      template: string;
      variables?: Record<string, unknown>;
    };

// ============================================================
// 组装上下文
// ============================================================

/**
 * 提示词组装上下文
 *
 * @property cwd - 当前工作目录
 * @property roleName - 当前角色名称
 * @property model - 当前模型名称
 * @property variables - 运行时变量
 */
export type PromptAssemblyContext = {
  cwd: string;
  roleName?: string;
  model?: string;
  tools?: string[];
  variables: Record<string, unknown>;
};

// ============================================================
// 组装结果
// ============================================================

/**
 * 已解析的提示词
 */
export type ResolvedPrompt = {
  content: string;
  includedSections: string[];
  resolvedVariables: Record<string, unknown>;
};

// ============================================================
// 内置模板 ID
// ============================================================

/**
 * 内置角色模板 ID
 *
 * - role-worker: 通用执行角色（编码、审查、规划、研究、对话）
 * - role-orchestrator: 多 agent 编排（路由、顺序、并行、循环迭代）
 */
export type BuiltinRoleId =
  | "role-worker"
  | "role-orchestrator";
