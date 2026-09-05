# PRD: Wasteland 统一键盘分发系统（Unified Keymap & Shortcut System）

## 1. 目标与背景

### 1.1 现状与痛点
1. **监听扁平分散**：当前全工程各组件独立调用 Ink `useInput`，缺乏统一的键盘事件分发器，依靠局部状态防守，存在按键穿透风险；
2. **缺乏配置化扩展**：无法像 Claude Code 那样通过 `~/.wasteland/keybindings.json` 自定义快捷键；
3. **快捷键文档与提示硬编码**：底部 shortcuts 提示分散在各组件中，难以动态维护与展示。

### 1.2 建设目标
1. 构建分层级、带优先级的统一键盘分发调度器（`KeymapDispatcher`）；
2. 建立 `KeybindingRegistry`，支持声明式注册、冲突检测与快捷键帮助提取；
3. 支持用户级 `~/.wasteland/keybindings.json` 覆盖与自定义。

---

## 2. 系统架构设计

```
┌────────────────────────────────────────────────────────┐
│  Tier 1: Global Interceptors (Ctrl+C, Modals, Help)    │ ➔ 绝对最高优先级
├────────────────────────────────────────────────────────┤
│  Tier 2: Focus Context (InputBar / Tabs / LogsPage)     │ ➔ 焦点独占处理 (preventDefault)
├────────────────────────────────────────────────────────┤
│  Tier 3: Navigation Shortcuts (T: 换页, Shift+Tab: 权限)│ ➔ 上下文通用快捷键
└────────────────────────────────────────────────────────┘
```

---

## 3. 规划里程碑

- [ ] **M1**: 设计 `KeybindingRegistry` 与 `useKeymap` Hook；
- [ ] **M2**: 重构 `App.tsx`、`ChatInputBar.tsx`、`LogsPage.tsx` 等组件，接入统一分发；
- [ ] **M3**: 支持 `~/.wasteland/keybindings.json` 配置文件与 `/keybindings` 命令。
