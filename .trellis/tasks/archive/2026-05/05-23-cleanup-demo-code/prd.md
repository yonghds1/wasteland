# cleanup: remove demo code

## Goal

清理项目中的演示代码和空目录，保持代码库精简。

## Requirements

* 删除 `src/commands/hello.ts` 演示命令
* 删除 `src/mcp/` 空目录
* 从 `src/cli.ts` 移除 hello 命令注册
* 从 `test/cli.test.js` 删除 hello 相关测试
* 更新 help 测试，不再断言 hello 命令存在

## Acceptance Criteria

* [x] `rxc hello` 命令不再存在
* [x] `src/mcp/` 目录已删除
* [x] `npm run check` 通过

## Out of Scope

* 保留 `src/chat/reply-pipeline.ts`（被 local provider 使用）
