# Implement：日志存储中央化（绿地）

## 有序清单

- [ ] 0. 对齐他人 WIP：`git diff` 检查 `paths.ts/agent-loop` 脏改动，rebase 或等对方合入后再动手。
- [ ] 1. paths.ts：`resolveDefaultDataDir` / `deriveProjectId`（纯）/ `dataDirFor` + `WASTELAND_DATA_DIR`；
  `__tests__/paths-central.test.ts`（git-hash/回退hash/env覆盖）。
- [ ] 2. data-store.ts：`logDirFor/listProjectIds/locateSession/listAllSessions`（复用 file-log-loader 指纹缓存）+ 单测。
- [ ] 3. 写侧切换：FileSink 默认 dir、transcript/session 写盘经 data-store；`data/migration=1` 落盘。
- [ ] 4. 读侧聚合：LogsPage 左栏分组 + project 标签；`logs/sessions` 命令聚合 + `--project` 收窄；
  `resume/export` 经 `locateSession`；删 `DEFAULT_EXPORT_DIR` 硬编码。
- [ ] 5. 文档：`docs/architecture/configuration.md` 存储节 + 旧目录废弃声明。
- [ ] 6. 终检：`npm run typecheck && npm run lint && npm run validate:i18n && npm run check:locale-parity && npm test`
 （仅允许此前已知的 3 个他人 WIP 失败）；grep 确认无新增 `.wasteland/logs` 裸字符串。

## Validation

```bash
npm run check:fast
node --import tsx scripts/check-locale-parity.ts
npx vitest run src/config/__tests__/paths-central.test.ts <data-store测试>
# 手工：A项目发消息 → B项目目录开TUI /logs 左栏见A（带标签）→ resume/export 可用 → 目录改名后仍可用
```

## 风险文件/回滚

- 高风险：`src/config/paths.ts`（与他人 WIP 同文件冲突概率最高，先对齐）、`LogsPage.tsx`（1281 行，只加分组逻辑不动现有分支）。
- 每个清单项独立 commit；旧数据零触碰，任何回滚安全。

## Follow-up before start

- 确认 design 无新增全局状态、无新依赖、无 HelpView/事件结构变更。
- 准备 implement.jsonl/check.jsonl（backend 路径/日志/命令契约 + frontend 列表页规范）。
