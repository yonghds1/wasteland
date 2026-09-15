# brainstorm: Fix alias link creation

## Goal

在创建角色别名的符号链接时，允许覆盖已存在的软链接。目前在 `scripts/create-aliases.sh` 中使用的是 `ln -s`，当链接已存在时会报错 `File exists` 并导致构建或脚本执行中断。将其修改为 `ln -sf` 可以避免该问题。

## What I already know

* 脚本 `scripts/create-aliases.sh` 在本地开发创建符号链接时使用了 `ln -s`（主命令 wasteland 以及循环创建角色别名）。
* 报错信息为 `ln: failed to create symbolic link '/home/fzyhccg/workspacekk/rx-cli/bin/links/wasteland': File exists`。

## Assumptions (temporary)

* 使用 `-f` (force) 覆盖已有的软链接在 Linux 和 MacOS 环境下是标准且安全的。

## Open Questions

无。

## Requirements (evolving)

* 将 `scripts/create-aliases.sh` 中主命令符号链接的创建命令由 `ln -s` 改为 `ln -sf`。
* 将 `scripts/create-aliases.sh` 中角色别名本地软链接的创建命令由 `ln -s` 改为 `ln -sf`。

## Acceptance Criteria (evolving)

* [ ] 再次运行 `npm run postinstall` 或别名创建脚本时，即使 `bin/links/wasteland` 已存在，也不会报错中断。
* [ ] 确保在没有管理员权限时，本地软链创建成功。

## Definition of Done (team quality bar)

* 符号链接可以被无缝覆盖创建。
* Lint / typecheck 通过。

## Out of Scope (explicit)

* 全局安装软链接逻辑的重构（那部分已经在使用 `ln -sf`）。

## Technical Notes

* 受影响文件: `scripts/create-aliases.sh`

## 收口记录（2026-09-15）

scripts/create-aliases.sh 已改用 ln -sf（L68、L104），不再因已存在链接中断。
