/**
 * skill-types.ts - 技能系统核心类型定义
 *
 * 技能（Skills）是高级工作流，可以编排多个工具（Tools）。
 * 与工具不同，技能：
 * - 可以编排多个工具调用
 * - 可以被用户在 .wasteland/skills/ 中自定义
 * - 通过 /skill-name 斜杠命令调用
 * - 支持参数和别名
 */

import type { ToolRegistry } from '@tools/tool-registry.js';
import type { PermissionGate } from '@core/engine/permission-gate.js';
import type { SessionManager, SessionMetadata } from '@core/session/session-manager.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { SessionMessageRecord } from '@core/runtime/event-types.js';

// ============================================================
// 技能风险等级
// ============================================================

/**
 * 技能风险等级
 *
 * 用于分类技能的危险程度，权限系统据此决定是否需要用户确认：
 * - "read": 只读操作，如查看信息，通常不需要确认
 * - "write": 写入操作，如创建/修改文件，可能需要确认
 * - "execute": 执行操作，如运行命令，通常需要确认
 */
export type SkillRiskLevel = 'read' | 'write' | 'execute';

// ============================================================
// 技能参数定义
// ============================================================

/**
 * 技能参数定义（JSON Schema 子集）
 *
 * 描述技能接受的参数类型和约束。
 *
 * @property type - 参数类型
 * @property description - 参数描述，用于帮助文本
 * @property required - 是否必需
 * @property default - 默认值
 * @property enum - 枚举值列表（仅 string 类型）
 * @property items - 数组元素类型（仅 array 类型）
 * @property properties - 对象属性（仅 object 类型）
 */
export type SkillParameterDef = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: SkillParameterDef;
  properties?: Record<string, SkillParameterDef>;
};

// ============================================================
// 技能定义
// ============================================================

/**
 * 技能定义元数据
 *
 * 描述一个技能的基本信息，用于注册、发现和帮助显示。
 *
 * @property name - 技能名称，用于 /name 斜杠命令
 * @property description - 技能描述，显示在 /skills 列表中
 * @property riskLevel - 风险等级，影响权限决策
 * @property parameters - 参数定义
 * @property aliases - 别名列表，如 ["i"] 表示 /i 也能触发
 * @property category - 分类，用于 /skills 输出分组
 * @property examples - 使用示例
 */
export type SkillDefinition = {
  name: string;
  description: string;
  riskLevel: SkillRiskLevel;
  parameters?: Record<string, SkillParameterDef>;
  aliases?: string[];
  category?: string;
  examples?: string[];
};

// ============================================================
// 技能参数解析结果
// ============================================================

/**
 * 解析后的技能参数
 *
 * 从斜杠命令字符串解析出的参数。
 *
 * @property positional - 位置参数列表
 * @property named - 命名参数对象
 * @property raw - 原始输入字符串
 *
 * @example
 * // 输入: /init --template minimal my-project
 * // 结果:
 * {
 *   positional: ["my-project"],
 *   named: { template: "minimal" },
 *   raw: "/init --template minimal my-project"
 * }
 */
export type SkillArgs = {
  positional: string[];
  named: Record<string, unknown>;
  raw: string;
};

// ============================================================
// 技能执行上下文
// ============================================================

/**
 * 技能执行上下文
 *
 * 提供技能执行时需要的运行环境信息。
 *
 * @property sessionId - 当前会话 ID
 * @property turn - 当前对话轮次
 * @property cwd - 当前工作目录
 * @property session - 会话元数据
 * @property toolRegistry - 工具注册表，用于调用工具
 * @property permissionGate - 权限闸门，用于权限检查
 * @property sessionManager - 会话管理器，用于持久化
 * @property provider - Provider 实例（可选）
 * @property history - 历史消息列表
 * @property output - 输出函数，用于流式输出进度
 */
export type SkillExecutionContext = {
  sessionId: string;
  turn: number;
  cwd: string;
  session: SessionMetadata;
  toolRegistry: ToolRegistry;
  permissionGate: PermissionGate;
  sessionManager: SessionManager;
  provider?: AgentProvider;
  history: SessionMessageRecord[];
  /** 输出函数，用于流式输出进度信息 */
  output: (message: string) => void;
};

// ============================================================
// 技能执行结果
// ============================================================

/**
 * 技能执行成功结果
 */
export type SkillSuccessResult = {
  status: 'success';
  /** 主要输出，显示给用户 */
  output: string;
  /** 附加结构化数据 */
  data?: unknown;
};

/**
 * 技能执行失败结果
 */
export type SkillErrorResult = {
  status: 'error';
  /** 错误信息 */
  output: string;
  /** 附加错误详情 */
  data?: unknown;
};

/**
 * 技能被取消结果
 */
export type SkillCancelledResult = {
  status: 'cancelled';
  /** 取消原因 */
  output: string;
};

/**
 * 技能执行结果（联合类型）
 */
export type SkillResult = SkillSuccessResult | SkillErrorResult | SkillCancelledResult;

// ============================================================
// 技能接口
// ============================================================

/**
 * 技能接口
 *
 * 所有技能都必须实现这个接口。
 *
 * @property definition - 技能定义元数据
 * @method execute - 执行技能
 *
 * @example
 * const mySkill: Skill = {
 *   definition: {
 *     name: "greet",
 *     description: "打招呼",
 *     riskLevel: "read",
 *   },
 *   async execute(args, context) {
 *     const name = args.positional[0] ?? "World";
 *     return { status: "success", output: `Hello, ${name}!` };
 *   },
 * };
 */
export interface Skill {
  readonly definition: SkillDefinition;
  execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult>;
}

// ============================================================
// 技能来源
// ============================================================

/**
 * 技能来源
 *
 * 标识技能来自哪里，用于显示和审计。
 */
export type SkillSource =
  | { type: 'builtin' }
  | { type: 'project'; path: string }
  | { type: 'user'; path: string };

/**
 * 注册的技能条目
 *
 * 包含技能实例和其来源信息。
 */
export type RegisteredSkill = {
  skill: Skill;
  source: SkillSource;
};

// ============================================================
// JSON 技能定义（用于模板执行）
// ============================================================

/**
 * JSON 技能步骤定义
 *
 * 描述一个工具调用步骤。
 */
export type JsonSkillStep = {
  /** 要调用的工具名称 */
  tool: string;
  /** 传递给工具的输入（支持变量插值） */
  input: Record<string, unknown>;
  /** 保存结果的变量名 */
  saveAs?: string;
};

/**
 * JSON 技能定义
 *
 * 用于 .wasteland/skills/*.json 中定义的技能。
 * 支持模板执行模式。
 */
export type JsonSkillDefinition = SkillDefinition & {
  /** 要执行的步骤列表 */
  steps?: JsonSkillStep[];
  /** 模板字符串（支持 {{variable}} 插值） */
  template?: string;
  /** 发送给 agent 的提示（执行步骤后） */
  prompt?: string;
};
