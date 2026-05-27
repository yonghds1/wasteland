/**
 * test-refactored-roles.ts - 验证重构后的角色系统
 *
 * 测试内容：
 * 1. listBuiltinRoles 返回 2 个角色
 * 2. role-worker 的 prompt 组装
 * 3. role-orchestrator 的 prompt 组装（含 delegation 变量）
 * 4. promptVariables 覆盖默认值
 */

import { assemblePrompt, listBuiltinRoles, isBuiltinRoleId, getBuiltinRole } from "../../src/prompts/index.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✔ ${message}`);
}

// 委托策略模板
const DELEGATION_STRATEGIES: Record<string, string> = {
  route: `## 委托策略

### 路由模式
1. 将用户任务分类为以下类别之一：coding, review, research, planning, chat
2. 选择最合适的 agent
3. 使用 spawn_agent 委托任务：
\`\`\`
spawn_agent({
  name: "selected-agent",
  task: "detailed task description with full context"
})
\`\`\`
4. 直接返回 agent 的结果，不要修改或补充

如果无法确定使用哪个 agent，默认使用最通用的 agent。`,

  sequential: `## 委托策略

### 顺序编排模式
1. 分析复杂任务，分解为多个子任务
2. 识别子任务之间的依赖关系
3. 按依赖顺序逐个委托执行：
\`\`\`
spawn_agent({
  name: "agent-name",
  task: "detailed task description with context from previous steps"
})
\`\`\`
4. 等待每个 agent 完成后再执行下一个依赖任务
5. 收集所有结果`,

  parallel: `## 委托策略

### 并行编排模式
1. 分析任务，识别可以并行执行的独立子任务
2. 在同一个 response 中同时启动多个 agent：
\`\`\`
spawn_agent({ name: "agent1", task: "independent task 1" })
spawn_agent({ name: "agent2", task: "independent task 2" })
spawn_agent({ name: "agent3", task: "independent task 3" })
\`\`\`
3. 等待所有 agent 完成
4. 聚合结果`,

  loop: `## 委托策略

### 循环迭代模式（Plan-Code-Verify-Review）

按以下步骤循环执行，直到审查通过或达到最大迭代次数（{{maxIterations}} 次）：

**阶段 1：规划**
- 分析任务需求，读取相关代码
- 制定详细的实施计划

**阶段 2：编码委托**
- 使用 spawn_agent 委托编码任务：
\`\`\`
spawn_agent({
  name: "coder",
  task: "implement the following plan: [plan details]"
})
\`\`\`

**阶段 3：验证**
- 检查编码结果是否符合预期
- 如果有明显错误，直接修正或重新委托

**阶段 4：审查委托**
- 使用 spawn_agent 委托代码审查：
\`\`\`
spawn_agent({
  name: "reviewer",
  task: "review the following changes: [changes]"
})
\`\`\`

**阶段 5：决策**
- 如果审查通过 → 输出最终结果
- 如果审查不通过 → 分析问题，更新计划，返回阶段 2
- 当前迭代: {{currentIteration}} / {{maxIterations}}`,
};

async function main() {
  console.log("=== 重构后角色系统验证 ===\n");

  // 1. 验证内置角色数量
  console.log("1. 内置角色数量:");
  const roles = listBuiltinRoles();
  assert(roles.length === 2, `应有 2 个角色，实际 ${roles.length} 个`);
  assert(roles.some(r => r.id === "role-worker"), "包含 role-worker");
  assert(roles.some(r => r.id === "role-orchestrator"), "包含 role-orchestrator");
  console.log();

  // 2. 验证旧角色 ID 不再存在
  console.log("2. 旧角色 ID 已移除:");
  assert(!isBuiltinRoleId("role-chat"), "role-chat 已移除");
  assert(!isBuiltinRoleId("role-coder"), "role-coder 已移除");
  assert(!isBuiltinRoleId("role-planner"), "role-planner 已移除");
  assert(!isBuiltinRoleId("role-reviewer"), "role-reviewer 已移除");
  assert(!isBuiltinRoleId("role-researcher"), "role-researcher 已移除");
  assert(!isBuiltinRoleId("role-architect"), "role-architect 已移除");
  assert(!isBuiltinRoleId("role-router"), "role-router 已移除");
  assert(!isBuiltinRoleId("role-supervisor"), "role-supervisor 已移除");
  console.log();

  // 3. 测试 role-worker prompt 组装
  console.log("3. role-worker prompt 组装:");
  const workerResult = assemblePrompt(
    "role-worker",
    { cwd: "/tmp", variables: {} },
    {},
  );
  assert(workerResult.includes("Senior Software Developer"), "包含默认角色名");
  assert(workerResult.includes("Available tools:"), "包含工具段落");
  assert(workerResult.includes("Constraints:"), "包含约束段落");
  console.log("  Worker prompt (前 200 字符):");
  console.log(`  ${workerResult.slice(0, 200)}...`);
  console.log();

  // 4. 测试 role-worker 带 promptVariables
  console.log("4. role-worker 带 promptVariables:");
  const customWorkerResult = assemblePrompt(
    "role-worker",
    { cwd: "/tmp", variables: {} },
    { role: "Code Reviewer", tools: "read, grep, glob" },
  );
  assert(customWorkerResult.includes("Code Reviewer"), "角色名被覆盖");
  assert(customWorkerResult.includes("read, grep, glob"), "工具被覆盖");
  assert(!customWorkerResult.includes("Senior Software Developer"), "默认角色名已替换");
  console.log("  Custom Worker prompt (前 200 字符):");
  console.log(`  ${customWorkerResult.slice(0, 200)}...`);
  console.log();

  // 5. 测试 role-orchestrator prompt 组装（默认 sequential 模式）
  console.log("5. role-orchestrator prompt 组装（sequential 模式）:");
  const orchResult = assemblePrompt(
    "role-orchestrator",
    { cwd: "/tmp", variables: {} },
    { delegation: DELEGATION_STRATEGIES.sequential },
  );
  assert(orchResult.includes("顺序编排模式"), "包含 sequential 策略");
  assert(orchResult.includes("spawn_agent"), "包含 spawn_agent 工具");
  console.log("  Orchestrator prompt (前 300 字符):");
  console.log(`  ${orchResult.slice(0, 300)}...`);
  console.log();

  // 6. 测试 role-orchestrator loop 模式
  console.log("6. role-orchestrator prompt 组装（loop 模式）:");
  const loopResult = assemblePrompt(
    "role-orchestrator",
    { cwd: "/tmp", variables: {} },
    {
      mode: "loop",
      maxIterations: 3,
      delegation: DELEGATION_STRATEGIES.loop,
    },
  );
  assert(loopResult.includes("循环迭代模式"), "包含 loop 策略");
  assert(loopResult.includes("Plan-Code-Verify-Review"), "包含迭代工作流");
  assert(loopResult.includes("3"), "最大迭代次数被覆盖");
  console.log("  Loop Orchestrator prompt (前 300 字符):");
  console.log(`  ${loopResult.slice(0, 300)}...`);
  console.log();

  // 7. 测试 role-orchestrator parallel 模式
  console.log("7. role-orchestrator prompt 组装（parallel 模式）:");
  const parallelResult = assemblePrompt(
    "role-orchestrator",
    { cwd: "/tmp", variables: {} },
    { delegation: DELEGATION_STRATEGIES.parallel },
  );
  assert(parallelResult.includes("并行编排模式"), "包含 parallel 策略");
  console.log();

  // 8. 测试 role-orchestrator route 模式
  console.log("8. role-orchestrator prompt 组装（route 模式）:");
  const routeResult = assemblePrompt(
    "role-orchestrator",
    { cwd: "/tmp", variables: {} },
    { delegation: DELEGATION_STRATEGIES.route },
  );
  assert(routeResult.includes("路由模式"), "包含 route 策略");
  console.log();

  console.log("=== 所有验证通过 ===");
}

main().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});
