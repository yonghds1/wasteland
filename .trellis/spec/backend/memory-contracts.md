# 通用智能体记忆引擎契约 (Memory Contracts)

> **版本定位**: 这是指导 `src/core/memory/` 与 `src/core/session/` 重构的权威契约文件。

## Scenario: Generic Agent Memory Architecture

### 1. Scope / Trigger
- **Trigger**: 项目从单体 CLI 演进为多智能体架构（Multi-Agent），旧有的全局单例 `session-manager` 无法支持多角色、多会话并发。因此需要引入支持“多租户隔离”和“存储解耦”的通用记忆契约。

### 2. Signatures

**核心驱动层 (`IMemoryStore`)**
```typescript
export interface IMemoryStore {
  appendRecord(agentId: string, sessionId: string, record: SessionRecord): Promise<void>;
  getHistory(agentId: string, sessionId: string, options?: { limit?: number }): Promise<SessionRecord[]>;
  storeFact?(agentId: string, fact: string): Promise<void>;
  searchFacts?(agentId: string, query: string): Promise<string[]>;
}
```

**领域服务层 (`IAgentMemory`)**
```typescript
export interface IAgentMemory {
  getWorkingContext(): Message[];
  addMessage(msg: Message, usage?: UsageReport): Promise<void>;
  triggerCompaction(): Promise<CompactionResult>;
}
```

### 3. Contracts
- **Request Fields**:
  - `agentId` (string, required): 标识具体的智能体角色（如 `coder`, `researcher`）。
  - `sessionId` (string, required): 标识当前对话会话。
- **Environment Keys**:
  - `WASTELAND_SESSION_DIR` (optional): 若使用本地文件系统实现 `IMemoryStore`，需以此为基准路径。

### 4. Validation & Error Matrix
- `agentId` 为空 -> 抛出 `MemoryValidationError("agentId is required")`
- `sessionId` 为空 -> 抛出 `MemoryValidationError("sessionId is required")`
- `addMessage` 触发 Token 上限但 `triggerCompaction` 失败 -> 抛出 `CompactionFailedError`，但不应阻断消息返回，只应记录 Error Log。

### 5. Good/Base/Bad Cases
- **Good**: 传入合法的 `agentId` 和 `sessionId`，成功落盘并维护正确的 Token 窗口。
- **Base**: `getWorkingContext()` 在没有历史时返回空数组 `[]`。
- **Bad**: 传入未知的 `agentId`，尝试读取不存在的会话历史（应返回空数组，而非崩溃）。

### 6. Tests Required
- **Unit**: 验证 `IAgentMemory.getWorkingContext()` 是否能正确执行滑动窗口截断（Assertion point: 返回数组的 Token 总数 <= `contextWindow * compactionThreshold`）。
- **Integration**: 验证多租户隔离。向 `agentA` 写入消息，断言从 `agentB` 读取不到。

### 7. Wrong vs Correct
#### Wrong
```typescript
// 错误：依赖全局单例和隐式上下文
import { sessionManager } from '../session-manager.js';
await sessionManager.appendRecord(msg);
```
#### Correct
```typescript
// 正确：通过依赖注入，显式传递命名空间
export class AgentLoop {
  constructor(private readonly memory: IAgentMemory) {}
  async tick(msg: Message) {
    await this.memory.addMessage(msg);
  }
}
```
