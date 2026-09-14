/**
 * roles/default-roles.ts - 内置默认角色
 *
 * 内置角色作为「默认值」，用户可在 `.wasteland/roles.json` 中覆盖或新增。
 * 每个角色指向内置 prompt 模板 + 默认皮肤候选。
 *
 * 皮肤候选与 `skins/default-skins.json` 中的分配保持一致：
 * - orchestrator → warlord-immortal (不死老蕉)
 * - researcher → sand-scout (暴走纳克斯) / fury-vanguard (独臂弗莎)
 * - developer → v8-mechanic (巨汉瑞克) / fury-vanguard (独臂弗莎)
 * - analyst → doof-analyst (电音杜夫) / fury-vanguard (独臂弗莎)
 * - tester → bullet-tester (弹头麦哲) / fury-vanguard (独臂弗莎)
 */

import type { RoleDefinition } from './types.js';

/**
 * 内置默认角色注册表
 *
 * 键为角色名（orchestrator / researcher / developer / analyst / tester），
 * 值为可复用的完整角色定义。
 *
 * 皮肤候选与 `skins/default-skins.json` 中的分配保持一致：
 * - orchestrator → warlord-immortal (不死老蕉)
 * - researcher → sand-scout (暴走纳克斯) / fury-vanguard (独臂弗莎)
 * - developer → v8-mechanic (巨汉瑞克) / fury-vanguard (独臂弗莎)
 * - analyst → doof-analyst (电音杜夫) / fury-vanguard (独臂弗莎)
 * - tester → bullet-tester (弹头麦哲) / fury-vanguard (独臂弗莎)
 */
export const DEFAULT_ROLES: Record<string, RoleDefinition> = {
  orchestrator: {
    promptTemplate: 'role-orchestrator',
    description: '总协调者 - 拆解任务、调度子 agent、汇总结果',
    skins: ['warlord-immortal'],
  },
  researcher: {
    promptTemplate: 'role-worker',
    description: '信息收集与研究 - 搜索、发现、检索信息和资源',
    skins: ['sand-scout', 'fury-vanguard'],
  },
  developer: {
    promptTemplate: 'role-worker',
    description: '代码开发与实现 - 编写、修改、调试代码',
    skins: ['v8-mechanic', 'fury-vanguard'],
  },
  analyst: {
    promptTemplate: 'role-worker',
    description: '系统分析与架构 - 理解现有系统和代码结构',
    skins: ['doof-analyst', 'fury-vanguard'],
  },
  tester: {
    promptTemplate: 'role-worker',
    description: '测试与验证 - 运行测试、验证功能、确保质量',
    skins: ['bullet-tester', 'fury-vanguard'],
  },
};