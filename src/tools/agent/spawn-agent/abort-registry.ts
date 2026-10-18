import { Subject } from 'rxjs';

/**
 * AgentAbortRegistry - 子 Agent 中止信号注册中枢
 *
 * 管理各子 Agent 的独立 abort 信号流，支持单独中止指定子任务。
 */
export class AgentAbortRegistry {
  private static instance: AgentAbortRegistry | null = null;
  private readonly abortMap = new Map<string, Subject<void>>();

  static getInstance(): AgentAbortRegistry {
    if (!AgentAbortRegistry.instance) {
      AgentAbortRegistry.instance = new AgentAbortRegistry();
    }
    return AgentAbortRegistry.instance;
  }

  /**
   * 为指定的 agentId 注册独立的中止 Subject
   */
  register(agentId: string, abort$: Subject<void>): void {
    this.abortMap.set(agentId, abort$);
  }

  /**
   * 中止指定的 Agent 进程/循环
   */
  abort(agentId: string): boolean {
    const subject = this.abortMap.get(agentId);
    if (subject) {
      subject.next();
      subject.complete();
      this.abortMap.delete(agentId);
      return true;
    }
    return false;
  }

  /**
   * 注销并清理指定 Agent
   */
  unregister(agentId: string): void {
    this.abortMap.delete(agentId);
  }

  /**
   * 检查指定 Agent 是否处于可中止状态
   */
  has(agentId: string): boolean {
    return this.abortMap.has(agentId);
  }
}
