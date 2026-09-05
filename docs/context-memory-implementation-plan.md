# Context 和 Memory 管理功能实现计划

## 项目目标
实现 P0 和 P1 优先级的 context 管理和 memory 管理功能。

## Implementation Tasks

### P0 功能（高优先级）

- [x] **设计会话存储格式** `priority:1` `phase:design` ✅
  - files: docs/session-storage-format.md
  - 确定会话数据的存储格式（JSON）
  - 包括：会话元数据、对话历史、token 使用统计
  - [x] 定义 JSON schema
  - [x] 确定存储位置和文件命名规则
  - [x] 设计压缩和加密策略

- [x] **实现会话存储服务** `priority:2` `phase:implementation` `deps:设计会话存储格式` ✅
  - files: src/core/runtime/session-storage.ts
  - 创建 SessionStorage 类，支持保存/加载会话到磁盘
  - [x] 实现 saveSession 方法
  - [x] 实现 loadSession 方法
  - [x] 实现 deleteSession 方法
  - [x] 实现 listSessions 方法
  - [x] 添加错误处理和日志

- [x] **集成到现有会话管理器** `priority:3` `phase:implementation` `deps:实现会话存储服务` ✅
  - files: src/core/runtime/unified-session-manager.ts
  - 修改 UnifiedSessionManager，支持自动保存和恢复会话
  - [x] 在会话结束时自动保存
  - [x] 在会话开始时检查可恢复的会话
  - [x] 添加恢复提示
  - [x] 处理并发保存冲突

- [x] **添加会话恢复命令** `priority:4` `phase:implementation` `deps:集成到现有会话管理器` ✅
  - files: src/commands/resume.ts
  - 添加 /resume 命令，支持恢复最近或指定会话
  - [x] 实现 /resume 命令解析
  - [x] 显示可恢复的会话列表
  - [x] 支持选择特定会话恢复
  - [x] 处理会话状态验证

- [x] **设计 Memory 提取策略** `priority:5` `phase:design` ✅
  - files: docs/memory-extraction-strategy.md
  - 确定从对话中提取哪些信息：用户偏好、项目知识、决策记录、代码规范
  - [x] 定义提取内容类型
  - [x] 设计提取时机和频率
  - [x] 制定合并策略

- [x] **实现 Memory 提取器** `priority:6` `phase:implementation` `deps:设计 Memory 提取策略` ✅
  - files: src/config/memory/extractor.ts
  - 创建 MemoryExtractor 类，使用 LLM 从对话中提取关键信息
  - [x] 实现 extractFromConversation 方法
  - [x] 设计提取 prompt
  - [x] 添加提取结果验证
  - [x] 支持增量提取

- [x] **实现 Memory 更新器** `priority:7` `phase:implementation` `deps:实现 Memory 提取器` ✅
  - files: src/config/memory/updater.ts
  - 创建 MemoryUpdater 类，将提取的信息合并到 memory.md
  - [x] 实现 mergeMemory 方法
  - [x] 实现去重逻辑
  - [x] 支持用户级/项目级记忆
  - [x] 添加冲突解决策略

- [x] **添加自动提取触发器** `priority:8` `phase:implementation` `deps:实现 Memory 更新器` ✅
  - files: src/core/runtime/memory-trigger.ts
  - 在对话结束或达到一定轮次时自动触发 Memory 提取
  - [x] 实现轮次计数器
  - [x] 添加对话结束检测
  - [x] 实现异步提取
  - [x] 添加提取状态跟踪

### P1 功能（中优先级）

- [x] **设计会话列表数据结构** `priority:9` `phase:design` ✅
  - files: docs/session-list-format.md
  - 确定会话列表的存储格式和元数据（名称、时间、预览等）
  - [x] 定义会话元数据 schema
  - [x] 设计索引文件格式
  - [x] 确定排序和过滤规则

- [x] **实现会话列表服务** `priority:10` `phase:implementation` `deps:设计会话列表数据结构` ✅
  - files: src/core/runtime/session-list.ts
  - 创建 SessionListService 类，支持列出、切换、删除会话
  - [x] 实现 listSessions 方法
  - [x] 实现 switchSession 方法
  - [x] 实现 deleteSession 方法
  - [x] 实现 renameSession 方法

- [x] **添加会话管理命令** `priority:11` `phase:implementation` `deps:实现会话列表服务` ✅
  - files: src/commands/sessions.ts
  - 添加 /sessions、/switch、/delete 命令
  - [x] 实现 /sessions 命令
  - [x] 实现 /switch 命令
  - [x] 实现 /delete 命令
  - [x] 添加交互式选择界面

- [x] **实现会话命名功能** `priority:12` `phase:implementation` `deps:实现会话列表服务` ✅
  - files: src/commands/rename.ts
  - 支持为会话添加名称，便于识别和管理
  - [x] 实现 /rename 命令
  - [x] 支持自动生成名称
  - [x] 添加名称验证

- [x] **设计 Context 统计数据结构** `priority:13` `phase:design` ✅
  - files: docs/context-stats-format.md
  - 确定需要展示的统计信息：token 使用、消息分布、压缩历史
  - [x] 定义统计数据 schema
  - [x] 设计存储格式
  - [x] 确定展示方式

- [x] **实现 Context 统计收集器** `priority:14` `phase:implementation` `deps:设计 Context 统计数据结构` ✅
  - files: src/core/runtime/context-stats.ts
  - 创建 ContextStatsCollector 类，收集和计算 context 使用统计
  - [x] 实现 collectStats 方法
  - [x] 实现 calculateTokenUsage 方法
  - [x] 实现 trackCompactionHistory 方法
  - [x] 添加统计持久化

- [x] **实现 Context 可视化渲染器** `priority:15` `phase:implementation` `deps:实现 Context 统计收集器` ✅
  - files: src/ui/context-visualizer.ts
  - 创建 ContextVisualizer 类，以图表/表格形式展示 context 使用情况
  - [x] 实现 renderStatsTable 方法
  - [x] 实现 renderTokenProgress 方法
  - [x] 实现 renderCompactionHistory 方法
  - [x] 支持多种输出格式

- [x] **添加 Context 查看命令** `priority:16` `phase:implementation` `deps:实现 Context 可视化渲染器` ✅
  - files: src/commands/context.ts
  - 添加 /context 命令，展示当前 context 使用情况
  - [x] 实现 /context 命令解析
  - [x] 集成可视化渲染器
  - [x] 添加实时更新
  - [x] 支持历史查看
