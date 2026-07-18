#!/usr/bin/env node

/**
 * get-role-aliases.js - 获取当前皮肤的命令别名
 *
 * 用法: node scripts/get-role-aliases.js [skin-id]
 *
 * 输出 JSON 格式的别名列表
 *
 * 皮肤内置化：别名由内置映射提供（不再读外部 skin.json）。
 */

const skinId = process.argv[2] || "immortan-joe";

// 内置皮肤命令别名映射（与 skin.cli.aliases 保持一致）
const BUILTIN_ALIASES = {
  "immortan-joe": ["wasteland", "joe"],
};

const aliases = BUILTIN_ALIASES[skinId] ?? ["wasteland"];
console.log(JSON.stringify(aliases));
