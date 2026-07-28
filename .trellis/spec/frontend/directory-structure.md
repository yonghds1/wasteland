# Directory Structure

> Current status / 当前状态：Ink + React TUI 已建立，并明确拆分视觉 theme、内容 skin 与语言 i18n。

---

## Frontend Roots / 前端根目录

```text
src/
  theme/wasteland/          # 固定 TUI 视觉：颜色、排版、间距、装饰、动画
  skins/system/             # 与角色无关的系统级内容键
  skins/roles/              # 角色 persona + 角色专属 TUI 文案键
  locales/                  # en/zh 翻译资源与运行时解析
  tui/                      # Ink React 组件、hooks、context
  ui/                       # CLI 终端 renderer 与输入/输出适配器
```

代表路径：

- `src/theme/wasteland/index.ts`：唯一视觉主题入口 `wastelandTheme`
- `src/skins/roles/index.ts`：角色 skin 注册表与默认角色 skin
- `src/tui/components/ChatMessageList.tsx`：消费 theme、role skin 和 i18n 的组件

---

## Ownership Rules / 目录职责

- `src/theme/wasteland/` 只定义 UI 怎么画，不得包含角色、用户文案或 LLM prompt。
- `src/skins/system/` 定义与角色无关的内容键；`src/skins/roles/` 定义英文 persona 与角色 TUI 文案键。
- `src/locales/` 保存可见 TUI 文案；英文 persona 不进入翻译文件。
- `src/tui/` 在渲染时通过 `t(...)` / `tArray(...)` 解析 skin 中的键，并从 `wastelandTheme` 读取视觉值。
- 不再在 `src/tui/utils/` 建立颜色常量镜像，也不在 skin 对象中保存颜色、间距或动画。

---

## Adding Content / 扩展规则

- 新增视觉 token：放到对应 `src/theme/wasteland/*.ts` 文件，并从 `index.ts` 聚合。
- 新增角色 skin：创建 `src/skins/roles/<id>/{persona,roleUi,index}.ts`，再注册到 `roles/index.ts`。
- 新增角色 TUI 文案：同时在 `src/locales/en.json` 和 `src/locales/zh.json` 添加同结构键。
