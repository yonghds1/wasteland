# nightowl 完善:plan 做需求分析 + 国际化

## Goal

三个诉求(全部经 brainstorm 确认):
1. **阶段语义去时间绑定** —— 技能目前被描述成"白天 plan 拆任务、晚上 run 静默执行"(CLI description + README 时间叙事),改为纯功能阶段语义:plan=交互式分析需求,run=静默执行,report=收尾。
2. **plan 增强** —— analyze(项目上下文分析)从 run 开工时前移到 plan 阶段,plan 产出 `.nightowl/context.md`;add 引导更深入的需求澄清。
3. **国际化** —— CLI 界面/命令帮助中英双语(默认中文,`NIGHTOWL_LANG=en` 切换);README 中英双版本;SKILL.md 与模板保持单一中文(通用做法:指令读者是 Claude,无需双语)。

## What I already know

- 时间叙事位置:`src/cli.ts:32` description(`夜间自主调度:白天 plan 拆任务,晚上 run 静默执行,收尾 report`)、`README.md` 多处(`夜间自主调度技能`/`白天拆任务`/`晚上静默执行`)
- SKILL.md(npm 包 skills/)已是功能阶段叙事,无时间词
- 源码 23 文件 / 1360 行;用户可见 console 输出约 112 处
- wasteland 有成熟 i18n 模式:`locales/{en,zh}.json` 分层字典 + `i18n.ts`(`initI18n/setLanguage/getLanguage/t/tObject/tArray/tRandom/getLocalizedValue`, `{{var}}` 插值),可借鉴
- plan 阶段现状:init(建池+权限) / add(拆任务) / status / schedule;analyze 命令目前是 run 开工时生成项目上下文
- 用户已确认决策链:plan 增强 → analyze 前移 plan;国际化范围 → CLI+帮助+README;默认语言 → 中文+`NIGHTOWL_LANG` 切换;SKILL → 单一中文(经"通用做法"分析后放弃双语对照)

## Requirements

- 去除 CLI description / README 中的白天/晚上/夜间时间绑定,改为 plan/run/report 功能阶段叙事
- analyze 前移:plan 阶段可运行 analyze 产出 `.nightowl/context.md`;run 开工时 context.md 已存在则复用/刷新
- add 需求澄清增强(SKILL.md 指令:add 前与用户逐项对齐验收/粒度)
- CLI 输出 + 命令帮助中英双语:默认中文,`NIGHTOWL_LANG=en` 切英文;无效值/缺失 key 回退中文
- README 中英双版本(README.md + README.en.md,顶部语言切换链接)
- SKILL.md 与 prd 模板保持单一中文
- **项目级初始化(trellis 式,用户已确认)**:`nightowl init -u <name> --claude` 一次铺完——建任务池 + 申请权限 + 铺技能到 `.claude/skills/nightowl-*`(git 跟踪) + 铺斜杠命令到 `.claude/commands/nightowl/{plan,run,report}.md`(`/nightowl:plan` 等) + `-u` 写身份 `.nightowl/.developer` + 记录模板 hash 支持更新;**移除 install-skill**(并入 init)

## Acceptance Criteria

- [x] `nightowl --help` 描述为功能阶段语义,不含时间绑定;`NIGHTOWL_LANG=en nightowl --help` 输出英文
- [x] CLI 全部 112 处用户可见输出经 i18n 字典(中英),默认中文,env 切英文
- [x] plan 阶段 `nightowl analyze` 产出 `.nightowl/nightowl.context.md`;run 开工时复用已存在 context.md
- [x] README.md + README.en.md 双语,顶部语言切换链接
- [x] SKILL.md 保持单一中文
- [x] 全部 vitest 通过(28 tests);npm pack 含 dist/locales/
- [x] **项目级初始化**:`nightowl init -u <name> --claude` 建池 + 权限 + 铺技能/斜杠命令到 `.claude/` + 身份 `.nightowl/.developer` + 模板 hash;幂等/本地定制保护/升级更新/`--force` 均验证
- [x] **install-skill 移除**:命令、cli.ts 引用、字典键、README 引用全部删除(并入 init)
- [x] bump 版本 0.1.3 + git commit + push(GitHub yonghds1/nightowl)
- [ ] 发布 npm 0.1.3 + 全局更新验证(用户放行后)
- [ ] trellis finish

## Definition of Done (team quality bar)

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes

## Out of Scope (explicit)

- SKILL.md 双语对照(已放弃,保持单一中文)
- run 调度逻辑本身的行为改动(仅 analyze 前移带来的复用)
- 任务池数据格式变更

## Technical Notes

- 目标仓库:`/home/ubuntu/workspace/nightowl`
- i18n 参考:`/home/ubuntu/workspace/wasteland/src/locales/{i18n.ts,en.json,zh.json,index.ts}`(同步加载简化为 JSON import;t() 支持 `{{var}}`;分层字典按模块分组:init/add/status/next/done/block/schedule/verify/analyze/review/sweep/push/report/resume/checkpoint/install-skill/cli)
- 配置语言读取:`process.env.NIGHTOWL_LANG`,未设置/无效 → 中文;缺失 key → 中文 + 开发期 warn
- 迁移方式:console.log/error/warn 文案逐一替换为 `t('模块.key')`,字典先建 zh(现文案)→ 再译 en
- README 双语:README.md 中文版 + README.en.md 英文版,顶部链接互指

## Decision (ADR-lite)

- **Context**:SKILL.md 是否双语,取决于读者。SKILL 读者是 Claude(全语言理解),双语对照只增加 token 与维护成本,无功能收益 → 单一中文。CLI 读者是人 → i18n 双语。README 读者是人(GitHub 访客)→ 多语言版本。
- **Decision**:SKILL/模板单中文;CLI i18n 双语;README 双语。
- **Consequences**:英语用户可用 CLI 与文档,但无法直接读中文 SKILL 指令(Claude 翻译执行无碍,人工维护中文指令)。
