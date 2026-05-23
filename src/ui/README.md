# UI 层

本目录当前已经承载终端输入与渲染边界：

- `readline-input.ts`：单次输入、stdin 读取、交互式 turn 流
- `terminal-renderer.ts`：消费 `RuntimeEvent` 并渲染终端输出
- `terminal-theme.ts`：交互模式的终端样式辅助

交互模式下，UI 层当前还直接处理本地会话命令：

- `/help`
- `/tools`
- `/clear`
- `/exit`

这些命令不会进入 runtime/provider。

UI 层只负责输入/输出边界，不负责 provider 调用和 session 落盘。
