/**
 * 工具风险等级
 *
 * 用于分类工具的危险程度，权限系统据此决定是否需要用户确认：
 * - "read": 只读操作，如读取文件，通常不需要确认
 * - "write": 写入操作，如修改文件，可能需要确认
 * - "execute": 执行操作，如运行命令，通常需要确认
 */
export type ToolRiskLevel = 'read' | 'write' | 'execute';

/**
 * 工具输入参数
 *
 * 一个通用的对象类型，用于表示任意工具的输入参数。
 * 使用 Record<string, unknown> 表示键是字符串，值可以是任意类型。
 *
 * @example
 * // read-file 工具的输入
 * const input: ToolInput = { path: "/home/user/file.txt" };
 *
 * // bash 工具的输入
 * const input: ToolInput = { command: "ls -la" };
 */
export type ToolInput = Record<string, unknown>;

/**
 * 工具调用请求
 *
 * 表示 AI 请求执行某个工具的完整信息。
 * 当 AI 决定调用工具时，会生成一个 ToolCall 对象。
 *
 * @property id - 调用的唯一标识符，用于追踪整个工具执行生命周期
 * @property toolName - 要调用的工具名称，如 "read-file"、"bash"
 * @property input - 传递给工具的参数
 */
export type ToolCall = {
  id: string;
  toolName: string;
  input: ToolInput;
};

/**
 * 工具执行上下文
 *
 * 提供工具执行时需要的运行环境信息。
 * 这些信息帮助工具了解当前会话状态。
 *
 * @property sessionId - 当前会话 ID，用于日志和追踪
 * @property turn - 当前对话轮次编号
 * @property cwd - 当前工作目录，工具可能需要在此目录下执行
 */
export type ToolExecutionContext = {
  sessionId: string;
  turn: number;
  cwd: string;
};

/**
 * 工具执行成功结果
 *
 * 当工具执行成功时返回此类型。
 *
 * @property status - 固定为 "success"，用于类型守卫
 * @property output - 工具执行的输出文本，将展示给用户
 * @property data - 可选的附加数据，用于传递结构化结果
 */
export type ToolSuccessResult = {
  status: 'success';
  output: string;
  data?: unknown;
};

/**
 * 工具执行失败结果
 *
 * 当工具执行失败时返回此类型。
 *
 * @property status - 固定为 "error"，用于类型守卫
 * @property error - 错误信息，描述失败原因
 * @property data - 可选的附加数据，用于传递错误详情
 */
export type ToolErrorResult = {
  status: 'error';
  error: string;
  data?: unknown;
};

/**
 * 工具执行结果（联合类型）
 *
 * 工具执行的最终结果，可能是成功或失败。
 * 使用联合类型配合 status 字段进行类型守卫：
 *
 * @example
 * function handleResult(result: ToolExecutionResult) {
 *   if (result.status === "success") {
 *     // TypeScript 知道这里是 ToolSuccessResult
 *     console.log(result.output);
 *   } else {
 *     // TypeScript 知道这里是 ToolErrorResult
 *     console.log(result.error);
 *   }
 * }
 */
export type ToolExecutionResult = ToolSuccessResult | ToolErrorResult;

/**
 * 工具运行状态
 *
 * 表示工具调用的最终状态，包括：
 * - "success": 执行成功
 * - "error": 执行失败
 * - "blocked": 被权限系统阻止，未执行
 *
 * 使用 ToolExecutionResult["status"] 提取联合类型的 status 字段类型。
 */
export type ToolRunStatus = ToolExecutionResult['status'] | 'blocked';

/**
 * JSON Schema 类型（用于工具参数描述）
 *
 * 符合 JSON Schema 规范的子集，用于描述工具参数结构。
 * 可通过 zod-to-json-schema 从 Zod Schema 自动生成。
 */
export type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  default?: unknown;
  [key: string]: unknown;
};

/**
 * Agent 工具接口
 *
 * 定义一个工具必须实现的方法和属性。
 * 所有工具（如 read-file、bash）都必须实现这个接口。
 *
 * @property name - 工具名称，用于识别和调用
 * @property riskLevel - 风险等级，影响权限决策
 * @property description - 工具描述（展示给 LLM）
 * @property inputSchema - 参数 Schema（展示给 LLM，通过 zodToJsonSchema 生成）
 * @method execute - 执行工具，返回 Promise 包含执行结果
 */
export interface AgentTool {
  readonly name: string;
  readonly riskLevel: ToolRiskLevel;
  readonly description?: string;
  readonly inputSchema?: JsonSchema;
  execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
