# PRD: 对齐 Claude Code 权限系统与状态栏指示规范

## 1. 目标与背景

在当前的 CLI 与 TUI 设计中，权限配置存在以下痛点：
1. **参数不够语义化**：缺少现代大模型命令行工具（如 Claude Code）通用的 `--dangerously-skip-permissions` 一键全自动免确认 Flag。
2. **状态可见性不足**：TUI 底部状态栏未直观显示当前的权限安全模式（`default` / `accept_edits` / `bypass_permissions`），用户在无人值守或严格模式下缺乏即时视觉感知。

本项目旨在：
- 100% 对齐 Claude Code 的命令行权限参数规范；
- 在 TUI 底部状态栏（位置 1）提供高精细的三级状态着色徽章；
- 保持向后兼容并提供严密的防误触保障。

---

## 2. 命令行参数契约（CLI Options Specification）

### 2.1 选项定义

| 参数名 | 类型 | 默认值 | 描述 |
| :--- | :--- | :--- | :--- |
| **`--dangerously-skip-permissions`** | `boolean` | `false` | 跳过所有权限检查与确认（与 Claude Code 规范一致，最高优先级） |
| **`--permission-mode <mode>`** | `enum` | `'default'` | 显式指定权限模式（`default` \| `accept_edits` \| `bypass_permissions`） |

> ⚠️ **规范约束**：绝不为 `--dangerously-skip-permissions` 提供单字母短选项（如 `-p` 或 `-s`），以防手误触发高危无人值守执行。

### 2.2 参数优先级算法

```typescript
export function resolveEffectivePermissionMode(options: {
  dangerouslySkipPermissions?: boolean;
  permissionMode?: string;
  configuredPermissionMode?: string;
}): PermissionMode {
  if (options.dangerouslySkipPermissions === true) {
    return 'bypass_permissions';
  }
  if (options.permissionMode) {
    return resolvePermissionMode(options.permissionMode);
  }
  if (options.configuredPermissionMode) {
    return resolvePermissionMode(options.configuredPermissionMode);
  }
  return 'default';
}
```

---

## 3. TUI 底部状态栏展示规范（Location 1 Specification）

### 3.1 状态栏布局

位于 `ChatInputBar.tsx` 底部元数据栏，排列在 `模式` 之后、`模型` 之前：

```text
皮肤: 不死军阀 · 模式: multi · [权限: 🛡️ default] · 模型: openai-compatible · 上下文: ──/256.0k
```

### 3.2 三级视觉映射表

| 权限模式 | 徽章文案 | Wasteland 主题色 | 视觉效果 | 语义说明 |
| :--- | :--- | :--- | :--- | :--- |
| **`default`** | `🛡️ default` | `muted` (淡灰/默认) | 沉稳安全 | 读自动放行，写与执行需弹窗确认 |
| **`accept_edits`** | `✏️ auto-edit` | `warning` (金黄) | 编程提效 | 修改文件免确认，执行 bash 需确认 |
| **`bypass_permissions`** | `⚠️ skip-all` | `error` (警告红 + Bold) | 强烈警示 | 全自动高危运行，所有工具免确认 |

---

## 4. 实施清单与模块拆解

### 任务 1：CLI 命令定义与解析
- 文件：`src/commands/chat.ts`、`src/commands/tui.ts`、`src/commands/resume.ts`
- 动作：
  - 增加 `.option('--dangerously-skip-permissions', t('commands.chat.options.dangerouslySkipPermissions'))`；
  - 在动作执行器中接入优先级解析：`options.dangerouslySkipPermissions ? 'bypass_permissions' : ...`。

### 任务 2：i18n 语言包补充
- 文件：`src/locales/zh.json`、`src/locales/en.json`
- 动作：
  - 补充 `commands.chat.options.dangerouslySkipPermissions`；
  - 补充 `tui.session.input.statusBar.permission` 及其三态徽章翻译。

### 任务 3：TUI 状态栏组件集成
- 文件：`src/tui/components/ChatInputBar.tsx`
- 动作：
  - 读取 `state.config.permissionMode`；
  - 根据权限三态映射渲染带图标和高亮色的文本徽章。

### 任务 4：单元测试与回归校验
- 覆盖：
  - CLI 参数解析测试（`--dangerously-skip-permissions` 优先级覆盖）；
  - `ChatInputBar` 状态栏渲染断言（三种模式下的颜色与文本展示）；
  - 全量 1334 测试回归。

## 收口记录（2026-09-15）

本目录无 task.json（未按 task.py 正式建过任务），故不在任务池内。目标产物已落地：src/core/shared/initialize-runtime.ts、src/commands/resume.ts 及 locale 文案均支持 dangerously-skip-permissions。
