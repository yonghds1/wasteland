# 清理 wasteland 内嵌 nightowl 技能,改用 npm 全局技能

## Goal

nightowl 已 npm 化(TypeScript 重写 + `@yonghds1/nightowl@0.1.2` 已发布,`install-skill` 已装全局技能)。wasteland 项目内嵌的旧技能体系是过渡期遗留,清理掉,统一走全局技能,避免双份维护和权限规则指向失效路径。

## What I already know

- 内嵌 4 个目录,全部被 git 跟踪:
  - `.claude/skills/nightowl/`(旧 Python 版:scripts/nightowl.py 1093 行 + templates + tests + memory)
  - `.claude/skills/nightowl-{plan,run,report}/SKILL.md`(命令仍引用 `python3 .claude/skills/nightowl/scripts/nightowl.py`)
- `.claude/settings.json` 有 4 条指向旧脚本的权限规则(line 75-77 裸名形态 + line 106-107 完整相对路径)
- 全局技能 `~/.claude/skills/nightowl-{plan,run,report}` 已装,命令路径为新版 `nightowl`,wasteland 清理后可用
- `.nightowl/` 已 gitignore,无需处理

## Requirements

- 删除 `.claude/skills/nightowl{,-plan,-run,-report}` 4 个目录
- 从 `.claude/settings.json` 移除指向旧脚本的 4 条权限规则,补 `Bash(nightowl *)`
- 确认无其他文件引用被删路径(README/CLAUDE.md/hooks)

## Acceptance Criteria

- [ ] `git ls-files .claude/skills/ | grep nightowl` 为空(旧技能全部移出版本库)
- [ ] settings.json 不再含 `nightowl.py` 相关权限,含 `Bash(nightowl *)`
- [ ] `git grep "skills/nightowl"` 无命中
- [ ] 清理提交推送到 GitHub,trellis 任务 finish

## Out of Scope

- 全局 `~/.claude/skills/` 下的技能不动(由 install-skill 管理)
- `.nightowl/` 运行数据不动(gitignore 中)

## Technical Notes

- 目标仓库:`/home/ubuntu/workspace/wasteland`
- settings.json 修改点:permissions.allow 中删除 `Bash(python3 nightowl.py *)`、`Bash(python nightowl.py *)`、`Bash(./nightowl.py *)`、`Bash(python3 .claude/skills/nightowl/scripts/nightowl.py *)`、`Bash(./.claude/skills/nightowl/scripts/nightowl.py *)`,新增 `Bash(nightowl *)`
