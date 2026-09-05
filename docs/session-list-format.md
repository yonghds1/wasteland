# 会话列表数据结构设计文档

## 概述

本文档定义了 wasteland 项目中会话列表的数据结构、索引文件格式、排序和过滤规则。

## 目标

1. **快速查询**: 支持快速列出、搜索和过滤会话
2. **内存高效**: 索引文件大小可控，加载快速
3. **并发安全**: 支持多进程并发访问
4. **易于维护**: 清晰的数据结构，便于扩展

## 会话元数据 Schema

### 完整元数据

```typescript
interface SessionMetadata {
  /** 会话唯一标识符 */
  id: string;
  
  /** 会话名称（用户可选） */
  name?: string;
  
  /** 会话描述 */
  description?: string;
  
  /** 创建时间 (ISO 8601) */
  createdAt: string;
  
  /** 最后更新时间 (ISO 8601) */
  updatedAt: string;
  
  /** 完成时间 (ISO 8601) */
  completedAt?: string;
  
  /** 会话状态 */
  status: SessionStatus;
  
  /** 对话轮次数 */
  turnCount: number;
  
  /** 用户标识 */
  userId?: string;
  
  /** 项目标识 */
  projectId?: string;
  
  /** 工作目录 */
  cwd: string;
  
  /** 会话标签 */
  tags: string[];
  
  /** 会话预览（最后一条消息的前100字符） */
  preview?: string;
  
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  
  /** 文件大小（字节） */
  fileSize?: number;
  
  /** Token 使用统计 */
  tokenStats?: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
}
```

### 会话状态

```typescript
type SessionStatus = 
  | 'active'    // 活跃状态，可恢复
  | 'paused'    // 已暂停，可恢复
  | 'completed' // 已完成，可恢复
  | 'archived'  // 已归档，不可恢复
  | 'deleted';  // 已删除，可恢复
```

## 索引文件格式

### 索引结构

```typescript
interface SessionIndex {
  /** 索引格式版本 */
  version: string;
  
  /** 索引更新时间 */
  updatedAt: string;
  
  /** 会话列表 */
  sessions: SessionIndexEntry[];
  
  /** 索引统计 */
  stats: IndexStats;
}

interface SessionIndexEntry {
  /** 会话 ID */
  id: string;
  
  /** 会话名称 */
  name?: string;
  
  /** 创建时间 */
  createdAt: string;
  
  /** 最后更新时间 */
  updatedAt: string;
  
  /** 对话轮次数 */
  turnCount: number;
  
  /** 会话状态 */
  status: SessionStatus;
  
  /** 会话预览 */
  preview?: string;
  
  /** 会话标签 */
  tags: string[];
  
  /** 文件路径 */
  path: string;
  
  /** 文件大小（字节） */
  fileSize?: number;
}

interface IndexStats {
  /** 总会话数 */
  totalSessions: number;
  
  /** 活跃会话数 */
  activeSessions: number;
  
  /** 已完成会话数 */
  completedSessions: number;
  
  /** 已归档会话数 */
  archivedSessions: number;
  
  /** 索引文件大小（字节） */
  indexSize: number;
}
```

### 索引文件示例

```json
{
  "version": "1.0.0",
  "updatedAt": "2026-08-08T01:45:00.000Z",
  "sessions": [
    {
      "id": "20260808-143052-a3b8c9d0",
      "name": "重构认证模块",
      "createdAt": "2026-08-08T14:30:52.000Z",
      "updatedAt": "2026-08-08T15:45:00.000Z",
      "turnCount": 25,
      "status": "active",
      "preview": "用户: 帮我重构认证模块...",
      "tags": ["refactor", "auth"],
      "path": "~/.wasteland/sessions/20260808-143052-a3b8c9d0",
      "fileSize": 102400
    }
  ],
  "stats": {
    "totalSessions": 15,
    "activeSessions": 3,
    "completedSessions": 10,
    "archivedSessions": 2,
    "indexSize": 5120
  }
}
```

## 排序规则

### 默认排序

1. **按更新时间降序**: 最近更新的会话排在前面
2. **按状态分组**: active > paused > completed > archived
3. **按名称排序**: 相同状态下按名称字母顺序

### 排序优先级

```typescript
type SortField = 
  | 'updatedAt'   // 最后更新时间
  | 'createdAt'   // 创建时间
  | 'turnCount'   // 对话轮次数
  | 'name'        // 会话名称
  | 'status'      // 会话状态
  | 'fileSize';   // 文件大小

type SortOrder = 'asc' | 'desc';

interface SortOptions {
  field: SortField;
  order: SortOrder;
}
```

### 排序示例

```typescript
// 默认排序：按更新时间降序
const defaultSort: SortOptions[] = [
  { field: 'status', order: 'asc' },      // active 在前
  { field: 'updatedAt', order: 'desc' },  // 最近更新在前
];

// 按名称排序
const nameSort: SortOptions[] = [
  { field: 'name', order: 'asc' },
];

// 按大小排序
const sizeSort: SortOptions[] = [
  { field: 'fileSize', order: 'desc' },
];
```

## 过滤规则

### 状态过滤

```typescript
interface StatusFilter {
  /** 包含的状态 */
  include?: SessionStatus[];
  
  /** 排除的状态 */
  exclude?: SessionStatus[];
}
```

### 时间过滤

```typescript
interface TimeFilter {
  /** 创建时间范围 */
  createdAt?: {
    start?: string;  // ISO 8601
    end?: string;    // ISO 8601
  };
  
  /** 更新时间范围 */
  updatedAt?: {
    start?: string;
    end?: string;
  };
}
```

### 标签过滤

```typescript
interface TagFilter {
  /** 包含的标签（AND 逻辑） */
  include?: string[];
  
  /** 排除的标签 */
  exclude?: string[];
  
  /** 包含任一标签（OR 逻辑） */
  includeAny?: string[];
}
```

### 搜索过滤

```typescript
interface SearchFilter {
  /** 搜索关键词 */
  query?: string;
  
  /** 搜索字段 */
  fields?: ('name' | 'description' | 'preview' | 'tags')[];
  
  /** 是否区分大小写 */
  caseSensitive?: boolean;
}
```

### 组合过滤

```typescript
interface SessionFilter {
  /** 状态过滤 */
  status?: StatusFilter;
  
  /** 时间过滤 */
  time?: TimeFilter;
  
  /** 标签过滤 */
  tags?: TagFilter;
  
  /** 搜索过滤 */
  search?: SearchFilter;
  
  /** 用户过滤 */
  userId?: string;
  
  /** 项目过滤 */
  projectId?: string;
  
  /** 最小轮次数 */
  minTurnCount?: number;
  
  /** 最大轮次数 */
  maxTurnCount?: number;
}
```

## 查询选项

```typescript
interface SessionQueryOptions {
  /** 过滤条件 */
  filter?: SessionFilter;
  
  /** 排序选项 */
  sort?: SortOptions[];
  
  /** 分页 */
  pagination?: {
    offset?: number;
    limit?: number;
  };
  
  /** 是否包含统计信息 */
  includeStats?: boolean;
  
  /** 是否包含详细信息 */
  includeDetails?: boolean;
}
```

## 存储位置

### 索引文件

```
~/.wasteland/sessions/
├── index.json              # 会话索引
├── index.json.backup       # 索引备份
└── <session-id>/           # 会话目录
    ├── metadata.json       # 完整元数据
    ├── history.json        # 对话历史
    └── ...
```

### 索引更新策略

1. **实时更新**: 每次会话变更时更新索引
2. **批量更新**: 多个变更合并更新
3. **异步更新**: 后台线程更新，不阻塞主流程

## 并发控制

### 锁机制

```typescript
interface IndexLock {
  /** 锁文件路径 */
  lockFile: string;
  
  /** 锁超时时间（毫秒） */
  timeout: number;
  
  /** 重试次数 */
  retryAttempts: number;
  
  /** 重试延迟（毫秒） */
  retryDelay: number;
}
```

### 乐观锁

```typescript
interface OptimisticLock {
  /** 版本号 */
  version: number;
  
  /** 更新时间 */
  updatedAt: string;
}
```

## 性能优化

### 索引缓存

```typescript
interface IndexCache {
  /** 是否启用缓存 */
  enabled: boolean;
  
  /** 缓存过期时间（毫秒） */
  ttl: number;
  
  /** 最大缓存大小 */
  maxSize: number;
}
```

### 延迟加载

- **元数据**: 按需加载完整元数据
- **历史记录**: 只在需要时加载
- **统计信息**: 缓存计算结果

## 示例实现

### 查询会话

```typescript
async function querySessions(options: SessionQueryOptions): Promise<SessionSummary[]> {
  // 1. 加载索引
  const index = await loadIndex();
  
  // 2. 应用过滤
  let sessions = index.sessions;
  if (options.filter) {
    sessions = applyFilter(sessions, options.filter);
  }
  
  // 3. 应用排序
  if (options.sort) {
    sessions = applySort(sessions, options.sort);
  } else {
    sessions = applySort(sessions, defaultSort);
  }
  
  // 4. 应用分页
  if (options.pagination) {
    sessions = applyPagination(sessions, options.pagination);
  }
  
  // 5. 返回结果
  return sessions;
}
```

### 更新索引

```typescript
async function updateIndex(session: SessionMetadata): Promise<void> {
  // 1. 获取锁
  await acquireLock();
  
  try {
    // 2. 加载索引
    const index = await loadIndex();
    
    // 3. 查找或创建条目
    const entryIndex = index.sessions.findIndex(s => s.id === session.id);
    
    const entry: SessionIndexEntry = {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
      status: session.status,
      preview: session.preview,
      tags: session.tags,
      path: `~/.wasteland/sessions/${session.id}`,
      fileSize: session.fileSize,
    };
    
    if (entryIndex >= 0) {
      // 更新现有条目
      index.sessions[entryIndex] = entry;
    } else {
      // 添加新条目
      index.sessions.push(entry);
    }
    
    // 4. 更新统计
    index.stats = calculateStats(index.sessions);
    index.updatedAt = new Date().toISOString();
    
    // 5. 保存索引
    await saveIndex(index);
    
  } finally {
    // 6. 释放锁
    await releaseLock();
  }
}
```

## 总结

本设计文档定义了 wasteland 项目中会话列表的完整数据结构，包括：

1. **元数据 Schema**: 清晰的会话元数据定义
2. **索引格式**: 高效的索引结构
3. **排序规则**: 多种排序方式
4. **过滤规则**: 灵活的过滤条件
5. **并发控制**: 安全的并发访问
6. **性能优化**: 缓存和延迟加载

这个设计支持快速、灵活的会话查询和管理。
