# 会话存储格式设计文档

## 概述

本文档定义了 wasteland 项目中会话数据的存储格式，支持会话的持久化、恢复和管理。

## 存储位置

```
~/.wasteland/data/sessions/<projectId>/
├── index.json                    # 会话索引文件
├── <session-id>/
│   ├── metadata.json            # 会话元数据
│   ├── history.json             # 对话历史
│   ├── context-stats.json       # Context 使用统计
│   └── memory-extracts.json     # 提取的 Memory 信息
```

## JSON Schema 定义

### 1. 会话索引 (index.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "索引格式版本"
    },
    "sessions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "会话唯一标识符"
          },
          "name": {
            "type": "string",
            "description": "会话名称（用户可选）"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "创建时间"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time",
            "description": "最后更新时间"
          },
          "turnCount": {
            "type": "integer",
            "description": "对话轮次数"
          },
          "status": {
            "type": "string",
            "enum": ["active", "paused", "completed", "archived"],
            "description": "会话状态"
          },
          "preview": {
            "type": "string",
            "description": "会话预览（最后一条消息的前100字符）"
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "会话标签"
          }
        },
        "required": ["id", "createdAt", "updatedAt", "status"]
      }
    }
  },
  "required": ["version", "sessions"]
}
```

### 2. 会话元数据 (metadata.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "会话唯一标识符"
    },
    "name": {
      "type": "string",
      "description": "会话名称"
    },
    "description": {
      "type": "string",
      "description": "会话描述"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "completedAt": {
      "type": "string",
      "format": "date-time",
      "description": "完成时间"
    },
    "status": {
      "type": "string",
      "enum": ["active", "paused", "completed", "archived"]
    },
    "turnCount": {
      "type": "integer"
    },
    "userId": {
      "type": "string",
      "description": "用户标识"
    },
    "projectId": {
      "type": "string",
      "description": "项目标识"
    },
    "cwd": {
      "type": "string",
      "description": "工作目录"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "metadata": {
      "type": "object",
      "description": "自定义元数据"
    }
  },
  "required": ["id", "createdAt", "updatedAt", "status"]
}
```

### 3. 对话历史 (history.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "历史格式版本"
    },
    "records": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "message"
              },
              "id": {
                "type": "string"
              },
              "role": {
                "type": "string",
                "enum": ["user", "assistant", "system"]
              },
              "content": {
                "type": "string"
              },
              "timestamp": {
                "type": "string",
                "format": "date-time"
              },
              "tokenCount": {
                "type": "integer",
                "description": "估算的 token 数"
              }
            },
            "required": ["type", "id", "role", "content", "timestamp"]
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "tool_call"
              },
              "id": {
                "type": "string"
              },
              "toolName": {
                "type": "string"
              },
              "input": {
                "type": "object"
              },
              "timestamp": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": ["type", "id", "toolName", "timestamp"]
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "tool_result"
              },
              "id": {
                "type": "string"
              },
              "toolCallId": {
                "type": "string"
              },
              "toolName": {
                "type": "string"
              },
              "status": {
                "type": "string",
                "enum": ["success", "error"]
              },
              "output": {
                "type": "string"
              },
              "error": {
                "type": "string"
              },
              "timestamp": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": ["type", "id", "toolCallId", "toolName", "status", "timestamp"]
          },
          {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "const": "summary"
              },
              "id": {
                "type": "string"
              },
              "content": {
                "type": "string",
                "description": "摘要内容"
              },
              "summarizedCount": {
                "type": "integer",
                "description": "被摘要的消息数"
              },
              "timestamp": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": ["type", "id", "content", "timestamp"]
          }
        ]
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "totalTokens": {
          "type": "integer",
          "description": "总 token 使用量"
        },
        "compactionCount": {
          "type": "integer",
          "description": "压缩次数"
        },
        "lastCompactionAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  },
  "required": ["version", "records"]
}
```

### 4. Context 使用统计 (context-stats.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string"
    },
    "context_window": {
      "type": "integer",
      "description": "Context window 大小"
    },
    "usage_history": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "turn": {
            "type": "integer"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "prompt_tokens": {
            "type": "integer"
          },
          "completion_tokens": {
            "type": "integer"
          },
          "total_tokens": {
            "type": "integer"
          },
          "cached_tokens": {
            "type": "integer"
          }
        },
        "required": ["turn", "timestamp", "total_tokens"]
      }
    },
    "compaction_history": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "timestamp": {
            "type": "string",
            "format": "date-time"
          },
          "removed_count": {
            "type": "integer"
          },
          "tokens_saved": {
            "type": "integer"
          },
          "reason": {
            "type": "string",
            "enum": ["threshold", "summarization", "manual"]
          }
        },
        "required": ["timestamp", "removed_count", "tokens_saved"]
      }
    },
    "message_distribution": {
      "type": "object",
      "properties": {
        "user_messages": {
          "type": "integer"
        },
        "assistant_messages": {
          "type": "integer"
        },
        "tool_calls": {
          "type": "integer"
        },
        "tool_results": {
          "type": "integer"
        },
        "summaries": {
          "type": "integer"
        }
      }
    }
  },
  "required": ["session_id", "context_window", "usage_history"]
}
```

### 5. Memory 提取信息 (memory-extracts.json)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string"
    },
    "extracted_at": {
      "type": "string",
      "format": "date-time"
    },
    "extracts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": ["user_preference", "project_knowledge", "decision", "code_convention", "error_pattern"]
          },
          "content": {
            "type": "string",
            "description": "提取的内容"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "置信度"
          },
          "source_turn": {
            "type": "integer",
            "description": "来源轮次"
          },
          "context": {
            "type": "string",
            "description": "上下文信息"
          }
        },
        "required": ["type", "content", "confidence"]
      }
    },
    "merged_into_memory": {
      "type": "boolean",
      "description": "是否已合并到 memory.md"
    },
    "merged_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": ["session_id", "extracted_at", "extracts"]
}
```

## 文件命名规则

### 会话 ID 生成

```typescript
// 格式: {timestamp}-{random}
// 示例: 20260808-143052-a3b8c9d0

function generateSessionId(): string {
  const timestamp = new Date().toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}
```

### 文件大小限制

| 文件类型 | 最大大小 | 说明 |
|----------|----------|------|
| index.json | 1MB | 索引文件，包含所有会话摘要 |
| metadata.json | 10KB | 单个会话元数据 |
| history.json | 100MB | 对话历史，支持压缩 |
| context-stats.json | 5MB | Context 使用统计 |
| memory-extracts.json | 1MB | Memory 提取信息 |

## 压缩策略

### 历史记录压缩

当 `history.json` 超过 50MB 时，自动执行压缩：

1. **摘要压缩**: 使用 LLM 生成早期对话的摘要
2. **工具输出截断**: 截断超大的工具输出
3. **归档旧记录**: 将旧记录移动到归档文件

```typescript
interface CompactionOptions {
  maxFileSize: number;          // 最大文件大小（字节）
  summaryThreshold: number;     // 摘要阈值（token 数）
  keepRecentCount: number;      // 保留最近的记录数
  archiveOldRecords: boolean;   // 是否归档旧记录
}
```

### 归档策略

```
~/.wasteland/data/sessions/<projectId>/<session-id>/
├── history.json              # 当前历史（最近 N 条）
├── history-archive-1.json    # 归档文件 1
├── history-archive-2.json    # 归档文件 2
└── ...
```

## 加密策略

### 敏感数据加密

对于包含敏感信息的会话，支持可选加密：

```typescript
interface EncryptionOptions {
  algorithm: 'aes-256-gcm';
  keyDerivation: 'pbkdf2';
  iterations: 100000;
  saltLength: 16;
}
```

### 加密范围

- ✅ 对话历史 (history.json)
- ✅ Memory 提取信息 (memory-extracts.json)
- ❌ 会话元数据 (metadata.json) - 便于索引和搜索
- ❌ Context 统计 (context-stats.json) - 便于分析

## 性能优化

### 写入优化

1. **增量保存**: 只保存变更的部分
2. **批量写入**: 合并多次写入操作
3. **异步写入**: 使用后台线程写入

### 读取优化

1. **懒加载**: 按需加载历史记录
2. **缓存**: 缓存频繁访问的会话
3. **索引**: 使用索引快速查找会话

## 错误处理

### 文件损坏恢复

```typescript
interface RecoveryOptions {
  validateOnLoad: boolean;      // 加载时验证
  backupOnWrite: boolean;       // 写入时备份
  maxBackups: number;           // 最大备份数
  autoRepair: boolean;          // 自动修复
}
```

### 并发控制

```typescript
interface ConcurrencyControl {
  lockFile: string;             // 锁文件路径
  lockTimeout: number;          // 锁超时时间
  retryAttempts: number;        // 重试次数
  retryDelay: number;           // 重试延迟
}
```

## 迁移策略

### 版本升级

```typescript
interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: (data: any) => any;
}
```

### 向后兼容

- 保留旧版本的读取能力
- 新版本写入时自动迁移
- 提供手动迁移工具

## 示例实现

### 保存会话

```typescript
async function saveSession(session: Session): Promise<void> {
  const sessionDir = join(SESSIONS_DIR, session.id);

  // 创建目录
  await mkdir(sessionDir, { recursive: true });

  // 保存元数据
  await writeFile(
    join(sessionDir, 'metadata.json'),
    JSON.stringify(session.metadata, null, 2)
  );

  // 保存历史（支持压缩）
  const historyData = await compressHistory(session.history);
  await writeFile(
    join(sessionDir, 'history.json'),
    JSON.stringify(historyData, null, 2)
  );

  // 更新索引
  await updateIndex(session);
}
```

### 加载会话

```typescript
async function loadSession(sessionId: string): Promise<Session> {
  const sessionDir = join(SESSIONS_DIR, sessionId);

  // 加载元数据
  const metadata = JSON.parse(
    await readFile(join(sessionDir, 'metadata.json'), 'utf-8')
  );

  // 加载历史（支持解压）
  const historyData = JSON.parse(
    await readFile(join(sessionDir, 'history.json'), 'utf-8')
  );
  const history = await decompressHistory(historyData);

  return { id: sessionId, metadata, history };
}
```

## 总结

本设计文档定义了 wasteland 项目中会话存储的完整格式，包括：

1. **存储结构**: 清晰的目录和文件组织
2. **JSON Schema**: 严格的数据格式定义
3. **压缩策略**: 高效的存储空间利用
4. **加密策略**: 敏感数据保护
5. **性能优化**: 快速的读写操作
6. **错误处理**: 可靠的数据恢复
7. **迁移策略**: 平滑的版本升级

这个设计支持会话的持久化、恢复、管理和分析，为长时间运行的任务提供了坚实的基础。
