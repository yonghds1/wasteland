/**
 * a2a-types.ts - A2A (Agent-to-Agent) Protocol 类型定义
 *
 * 基于 Google A2A 协议规范，定义核心数据模型。
 *
 * ## 协议概述
 *
 * A2A 是一个开放标准，用于 AI Agent 之间的通信。
 * 核心概念：
 * - Agent Card: Agent 能力描述
 * - Task: 任务执行单元
 * - Message: 消息 (包含多个 Part)
 * - Artifact: 任务输出
 */

// ============================================================
// Agent Card (能力描述)
// ============================================================

/**
 * Agent Card - Agent 能力描述
 *
 * 用于 Agent 发现，其他 Agent 可以通过这个描述了解你的能力。
 * 端点: GET /.well-known/agent.json
 */
export type AgentCard = {
  /** Agent 名称 (唯一标识) */
  name: string;
  /** Agent 描述 */
  description: string;
  /** Agent API 端点 URL */
  url: string;
  /** 版本 */
  version?: string;
  /** 能力声明 */
  capabilities: {
    /** 是否支持流式响应 */
    streaming: boolean;
    /** 是否支持推送通知 */
    pushNotifications: boolean;
    /** 是否支持状态转换历史 */
    stateTransitionHistory: boolean;
  };
  /** 技能列表 */
  skills: Array<{
    /** 技能 ID */
    id: string;
    /** 技能名称 */
    name: string;
    /** 技能描述 */
    description: string;
    /** 标签 (用于能力匹配) */
    tags: string[];
    /** 使用示例 */
    examples?: string[];
  }>;
  /** 认证方式 (可选) */
  authentication?: {
    /** 支持的认证方案 */
    schemes: string[];
    /** 认证信息 */
    credentials?: string;
  };
  /** 默认输入模式 */
  defaultInputModes?: string[];
  /** 默认输出模式 */
  defaultOutputModes?: string[];
};

// ============================================================
// Task (任务)
// ============================================================

/**
 * Task 状态
 */
export type TaskState =
  | 'submitted'     // 已提交
  | 'working'       // 执行中
  | 'input-required' // 需要输入
  | 'completed'     // 已完成
  | 'failed'        // 失败
  | 'canceled'      // 已取消
  | 'rejected'      // 已拒绝
  | 'auth-required' // 需要认证
  | 'unknown';      // 未知

/**
 * Task 状态对象
 */
export type TaskStatus = {
  /** 当前状态 */
  state: TaskState;
  /** 状态消息 (可选) */
  message?: Message;
  /** 状态更新时间 */
  timestamp?: string;
};

/**
 * Task - 任务
 *
 * 任务是 A2A 的核心执行单元。
 * 端点: POST /tasks/send, GET /tasks/{id}
 */
export type Task = {
  /** 任务 ID */
  id: string;
  /** 会话 ID (可选，用于关联多轮对话) */
  sessionId?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 任务历史 (消息列表) */
  history?: Message[];
  /** 任务输出 (Artifact 列表) */
  artifacts?: Artifact[];
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
};

// ============================================================
// Message (消息)
// ============================================================

/**
 * Message Part 类型
 */
export type MessagePartType = 'text' | 'file' | 'data';

/**
 * Message Part - 消息部分
 *
 * 消息可以包含多个 Part，支持多模态内容。
 */
export type MessagePart = {
  /** Part 类型 */
  type: 'text';
  /** 文本内容 */
  text: string;
} | {
  /** Part 类型 */
  type: 'file';
  /** 文件名 */
  name?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 文件内容 (base64) 或 URL */
  uri?: string;
  bytes?: string;
} | {
  /** Part 类型 */
  type: 'data';
  /** 数据名称 */
  name?: string;
  /** 结构化数据 */
  data: Record<string, unknown>;
};

/**
 * Message - 消息
 *
 * 消息是 Agent 间通信的基本单位。
 */
export type Message = {
  /** 消息角色 */
  role: 'user' | 'agent';
  /** 消息内容 (Part 列表) */
  parts: MessagePart[];
  /** 消息元数据 */
  metadata?: Record<string, unknown>;
};

// ============================================================
// Artifact (输出)
// ============================================================

/**
 * Artifact - 任务输出
 *
 * Agent 执行任务后生成的输出。
 */
export type Artifact = {
  /** Artifact 名称 */
  name?: string;
  /** Artifact 描述 */
  description?: string;
  /** Artifact 内容 (Part 列表) */
  parts: MessagePart[];
  /** Artifact 元数据 */
  metadata?: Record<string, unknown>;
};

// ============================================================
// Request/Response 类型
// ============================================================

/**
 * TaskSendRequest - 发送任务请求
 *
 * 端点: POST /tasks/send
 */
export type TaskSendRequest = {
  /** 任务 ID (可选，不传则自动生成) */
  id?: string;
  /** 会话 ID (可选) */
  sessionId?: string;
  /** 消息内容 */
  message: Message;
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
  /** 配置 */
  configuration?: {
    /** 是否阻塞等待完成 */
    blocking?: boolean;
    /** 推送通知配置 */
    pushNotifications?: {
      url: string;
      token?: string;
    };
    /** 过期时间 (秒) */
    acceptedOutputModes?: string[];
    /** 超时时间 (秒) */
    timeoutSeconds?: number;
  };
};

/**
 * TaskGetQuery - 查询任务请求
 *
 * 端点: GET /tasks/{id}
 */
export type TaskGetQuery = {
  /** 任务 ID */
  id: string;
  /** 会话 ID (可选) */
  sessionId?: string;
};

/**
 * TaskCancelRequest - 取消任务请求
 *
 * 端点: POST /tasks/{id}/cancel
 */
export type TaskCancelRequest = {
  /** 任务 ID */
  id: string;
  /** 会话 ID (可选) */
  sessionId?: string;
};

/**
 * TaskResubscribeRequest - 重新订阅任务请求
 *
 * 端点: GET /tasks/{id}/subscribe
 */
export type TaskResubscribeRequest = {
  /** 任务 ID */
  id: string;
  /** 会话 ID (可选) */
  sessionId?: string;
};

// ============================================================
// SSE Event 类型 (流式响应)
// ============================================================

/**
 * TaskStatusUpdateEvent - 任务状态更新事件
 */
export type TaskStatusUpdateEvent = {
  /** 事件类型 */
  type: 'status';
  /** 任务 ID */
  taskId: string;
  /** 会话 ID */
  sessionId?: string;
  /** 状态 */
  status: TaskStatus;
  /** 最终事件标志 */
  final?: boolean;
};

/**
 * TaskArtifactUpdateEvent - 任务 Artifact 更新事件
 */
export type TaskArtifactUpdateEvent = {
  /** 事件类型 */
  type: 'artifact';
  /** 任务 ID */
  taskId: string;
  /** 会话 ID */
  sessionId?: string;
  /** Artifact */
  artifact: Artifact;
};

/**
 * SSE Event - 流式事件
 */
export type SSEEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ============================================================
// 错误类型
// ============================================================

/**
 * A2A 错误
 */
export type A2AError = {
  /** 错误代码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 错误数据 */
  data?: unknown;
};
