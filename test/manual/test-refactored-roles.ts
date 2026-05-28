/**
 * test-refactored-roles.ts - 验证重构后的角色系统
 *
 * 测试内容：
 * 1. listBuiltinRoles 返回 2 个角色
 * 2. role-worker 的 prompt 组装
 * 3. role-immortan-joe 的 prompt 组装（含 delegation 变量）
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

async function main() {
  console.log("=== 重构后角色系统验证 ===\n");

  // 1. 验证内置角色数量
  console.log("1. 内置角色数量:");
  const roles = listBuiltinRoles();
  assert(roles.length === 2, `应有 2 个角色，实际 ${roles.length} 个`);
  assert(roles.some(r => r.id === "role-worker"), "包含 role-worker");
  assert(roles.some(r => r.id === "role-immortan-joe"), "包含 role-immortan-joe");
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
  assert(!isBuiltinRoleId("role-orchestrator"), "role-orchestrator 已移除");
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

  // 5. 测试 role-immortan-joe prompt 组装
  console.log("5. role-immortan-joe prompt 组装:");
  const joeResult = assemblePrompt(
    "role-immortan-joe",
    { cwd: "/tmp", variables: {} },
    {},
  );
  assert(joeResult.includes("Immortan Joe"), "包含角色名");
  assert(joeResult.includes("WITNESS ME"), "包含 War Cry");
  assert(joeResult.includes("spawn_agent"), "包含 spawn_agent 工具");
  assert(joeResult.includes("Your War Boys"), "包含子 Agent 列表");
  console.log("  Joe prompt (前 300 字符):");
  console.log(`  ${joeResult.slice(0, 300)}...`);
  console.log();

  // 6. 测试 role-immortan-joe 带 delegation 变量
  console.log("6. role-immortan-joe 带 delegation 变量:");
  const customDelegation = `## Custom Deployment Protocol
1. Analyze the task
2. Deploy specialists`;
  const joeCustomResult = assemblePrompt(
    "role-immortan-joe",
    { cwd: "/tmp", variables: {} },
    { delegation: customDelegation },
  );
  assert(joeCustomResult.includes("Custom Deployment Protocol"), "委托策略被覆盖");
  console.log("  Custom Joe prompt (前 300 字符):");
  console.log(`  ${joeCustomResult.slice(0, 300)}...`);
  console.log();

  // 7. 测试 role-immortan-joe 带 backstory 变量
  console.log("7. role-immortan-joe 带 backstory 变量:");
  const customBackstory = "You are the ruler of a different wasteland.";
  const joeBackstoryResult = assemblePrompt(
    "role-immortan-joe",
    { cwd: "/tmp", variables: {} },
    { backstory: customBackstory },
  );
  assert(joeBackstoryResult.includes("different wasteland"), "背景故事被覆盖");
  console.log();

  // 8. 验证 getBuiltinRole 返回正确的模板
  console.log("8. getBuiltinRole 验证:");
  const joeTemplate = getBuiltinRole("role-immortan-joe");
  assert(joeTemplate !== undefined, "role-immortan-joe 模板存在");
  assert(joeTemplate?.id === "role-immortan-joe", "模板 ID 正确");
  assert(joeTemplate?.name === "Immortan Joe", "模板名称正确");
  const workerTemplate = getBuiltinRole("role-worker");
  assert(workerTemplate !== undefined, "role-worker 模板存在");
  assert(workerTemplate?.id === "role-worker", "模板 ID 正确");
  console.log();

  console.log("=== 所有验证通过 ===");
}

main().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});
