# sidecar改道中央根

## Goal

spawn-agent 子会话 sidecar（meta.json + skeleton jsonl）不再硬编码 `<cwd>/.wasteland/logs/transcript`，
改走中央数据根 `data/logs/<projectId>/transcript/`，与 FileSink/transcript 同根，跨项目可见且尊重 `WASTELAND_DATA_DIR`。

## Requirements

- R1：`writeSubagentSidecar` 路径改为 `join(resolveDefaultDataDir({cwd}), 'logs', resolveDataProjectId(cwd, null), 'transcript', parentSid, 'subagents')`；meta 字段与写入语义零改动，失败仍静默（调用点已 catch）。
- R2：`sidecar.test.ts` 断言更新到中央路径（用 `WASTELAND_DATA_DIR` 指向 mkdtemp 隔离，与生产同解析器）。
- R3：文件头注释的路径约定同步更新。

## Acceptance Criteria

- [x] AC1：spawn 后 sidecar 落在 `$DATA/logs/<pid>/transcript/<parentSid>/subagents/`，meta.json + jsonl 齐全。
      —— 实证：`src/tools/agent/spawn-agent/index.ts:376-386` 即 `join(dataRoot,'logs',projectId,'transcript',parentSid,'subagents')`。
- [x] AC2：`WASTELAND_DATA_DIR` 覆盖生效；`sidecar.test.ts` 全绿。
      —— 实证：测试以 `WASTELAND_DATA_DIR` 指向 mkdtemp 隔离；`npx vitest run sidecar.test.ts` 2 passed。
- [x] AC3：写盘失败仍不阻塞 spawn 主流程（既有单测保持绿）。
      —— 实证：用例「writeSubagentSidecar 写盘失败时 spawn 主流程仍继续」在位。

## Out of Scope

- 完整 transcript 复制（P2 留白不动）；旧 `.wasteland/logs/transcript` 数据迁移（绿地决策）。
