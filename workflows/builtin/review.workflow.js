// 内置只读评审剧本（顶层脚本，在 workflow vm 沙箱中执行，可用全局量 agent/parallel/phase/log/args）。
// 只读：三类检查（TODO 标记 / console 残留 / 空 catch），返回汇总 JSON。
phase("collect");
const target = (args && args.target) || (Array.isArray(args) && args[0]) || ".";
const changes = await agent(
  "你是只读代码评审助手，只读、不修改任何文件。目标路径为「" + target + "」：" +
    "列出该路径下的变更文件清单并对每个文件给 1-2 句摘要。" +
    "只返回 JSON，不要多余文本，格式：{\"target\": \"...\", \"files\": [{\"path\": \"...\", \"summary\": \"...\"}]}。"
);
phase("review");
const findings = await parallel([
  async () =>
    agent(
      "你是只读评审员。基于变更摘要 " + JSON.stringify(changes) + "，" +
        "在目标路径「" + target + "」检查 TODO/FIXME/HACK 标记，给出文件路径、行号、原文片段。" +
        "只返回 JSON：{\"kind\": \"todo\", \"items\": [{\"path\": \"...\", \"line\": 0, \"text\": \"...\"}]}。"
    ),
  async () =>
    agent(
      "你是只读评审员。基于变更摘要 " + JSON.stringify(changes) + "，" +
        "在目标路径「" + target + "」检查残留 console.log/console.debug/debugger。" +
        "只返回 JSON：{\"kind\": \"console\", \"items\": [{\"path\": \"...\", \"line\": 0, \"text\": \"...\"}]}。"
    ),
  async () =>
    agent(
      "你是只读评审员。基于变更摘要 " + JSON.stringify(changes) + "，" +
        "在目标路径「" + target + "」检查空 catch / 被吞掉的异常。" +
        "只返回 JSON：{\"kind\": \"empty-catch\", \"items\": [{\"path\": \"...\", \"line\": 0, \"text\": \"...\"}]}。"
    ),
]);
log("review done", { target });
return { target, changes, findings };
