#!/usr/bin/env node

/**
 * get-role-aliases.js - 获取当前皮肤的角色别名
 *
 * 用法: node scripts/get-role-aliases.js [skin-id]
 *
 * 输出 JSON 格式的角色别名列表
 *
 * 读取逻辑：
 * 1. 优先读取外部皮肤文件: .wasteland/.skins/<skin-id>/skin.json
 * 2. 如果不存在，使用内置默认值
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const skinId = process.argv[2] || "immortan-joe";
const cwd = process.cwd();

// 内置默认角色别名
const DEFAULT_ALIASES = ["joe"];

/**
 * 尝试从外部皮肤文件读取角色别名
 */
async function loadAliasesFromSkinFile(skinId) {
  const skinPath = join(cwd, ".wasteland", ".skins", skinId, "skin.json");

  try {
    const content = await readFile(skinPath, "utf8");
    const skin = JSON.parse(content);

    if (skin?.roles?.main?.aliases) {
      return skin.roles.main.aliases;
    }
  } catch (error) {
    // 文件不存在或解析失败，使用默认值
  }

  return null;
}

/**
 * 获取角色别名
 */
async function getAliases(skinId) {
  // 1. 尝试从外部皮肤文件读取
  const aliases = await loadAliasesFromSkinFile(skinId);
  if (aliases) {
    return aliases;
  }

  // 2. 使用内置默认值
  return DEFAULT_ALIASES;
}

// 主函数
const aliases = await getAliases(skinId);
console.log(JSON.stringify(aliases));
