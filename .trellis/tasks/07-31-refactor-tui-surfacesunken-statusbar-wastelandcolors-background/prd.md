# refactor(tui): 回退 surfaceSunken, StatusBar 改回 wastelandColors.background

## Goal

回退 `d0f203b refactor(tui): StatusBar 暖底深化 + 加高` 中的"新设计色" 部分:

- Title (StatusBar) 背景应该是和主题主背景一样的 `wastelandColors.background = '#18140F'`,而不是 `surfaceSunken`。
- 新加的 `wastelandColors.surfaceSunken` 颜色 token 没保留必要,删除。

## What I already know

### 用户决策

- **R1** StatusBar.backgroundColor = `wastelandColors.background`(`#18140F`)
- **R2** 删除 `wastelandColors.surfaceSunken = '#2A2014'` token 整体定义(`colors.ts`)
- **R3** 删除 `.trellis/spec/frontend/theme-skin.md` 里关于 surfaceSunken 的 §3 Contracts 段落
- **R4** 不动 StatusBar `paddingY={1}`(加高保留)
- **R5** 不动 AgentTabs 聚焦/失焦边框二色方案(高度锁定保留)

### 改动文件清单

- `src/theme/wasteland/colors.ts` —— 删 `surfaceSunken: '#2A2014'` 整行 + 它上面的注释
- `src/tui/components/StatusBar.tsx` —— `backgroundColor` 切到 `wastelandColors.background`
- `.trellis/spec/frontend/theme-skin.md` —— 删除 surfaceSunken 整段(token / HSL / 对比度 / 唯一调用点)

### 不动

- AgentTabs.tsx 的 `getAgentTabsFocusBorder` 与 Box render(07-31 修复保留)
- AgentTabs.test.ts(无 surfaceSunken 引用)
- StatusBar.tsx 的 layout / 内容(`paddingY={1}` 仍保留)

## Acceptance Criteria

- [ ] `wastelandColors.surfaceSunken` 不再存在;`grep -r surfaceSunken src/ .trellis/spec/` 无结果(本任务的 grep 命中)。
- [ ] StatusBar `backgroundColor` = `wastelandColors.background`(`#18140F`)。
- [ ] `.trellis/spec/frontend/theme-skin.md` 中没有 surfaceSunken 字样。
- [ ] `npm run check:contrast` 通过(`background` 早就是 skin contrast 校验基线,无新增 token 影响)。
- [ ] `npm run typecheck && npx eslint src/theme/wasteland/colors.ts src/tui/components/StatusBar.tsx` 通过。
- [ ] AgentTabs.test.ts 39/39 仍 pass;全量 test 与 d0f203b 后基线完全一致(忽略预存在 logs.test.ts 3 失败)。
- [ ] 提交信息清晰说明这是一个修正 commit(回退 `d0f203b` 中的 surfaceSunken 部分)。

## Definition of Done

- 一次 commit 完成 3 文件回退。
- branch 上有 2 commit:`d0f203b`(引入 surfaceSunken)+ 修正 commit(本任务)。

## Out of Scope

- 不重做整个视觉设计(用户已明确决定走 background,不再考虑其他色)。
- 不撤回 d0f203b 的 AgentTabs 高度锁定部分。
- 不撤回 StatusBar paddingY 部分。

## Technical Notes

### 为什么不用 fixup commit 而是独立 commit

- 独立 commit 让 `git log` 看到"引入 → 回退"两步轨迹,而不是直接消失,符合 trellis workflow 的"备录每次变更"原则。
- commit message 会显式 `Reverts the surfaceSunken part of d0f203b; StatusBar background now uses wastelandColors.background for parity with main surface`,reviewer 能理解。

### Token 删除具体步骤

```diff
--- a/src/theme/wasteland/colors.ts
+++ b/src/theme/wasteland/colors.ts
@@
   background: '#18140F',
   backgroundSecondary: '#241D16',
   backgroundDarker: '#100D0A',
-  // 07-31 fix: StatusBar 专用 "凹表面" 主题色。hue 33° (与 wasteland 主题家族对齐)
-  // ...(共 5 行注释)
-  surfaceSunken: '#2A2014',
   text: '#DED3C4',
```

### Spec 删除具体步骤

```diff
--- a/.trellis/spec/frontend/theme-skin.md
+++ b/.trellis/spec/frontend/theme-skin.md
@@ §3 Contracts
+- **StatusBar 深表面 token** (`wastelandColors.surfaceSunken`,07-31 引入): ...
+  (整段删除)
```

### 风险

- 0 — 这是 revert,所有相关 surface 仅在本次修改的 3 个文件中出现,无第三方引用。
