/**
 * validate-i18n.js - 翻译完整性校验脚本
 *
 * 检查所有语言文件的键结构是否一致
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const localesDir = join(__dirname, "..", "src", "locales");

/**
 * 获取嵌套对象的所有键路径
 */
function getNestedKeys(obj, prefix = "") {
  const keys = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...getNestedKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

/**
 * 主函数
 */
function main() {
  console.log("🔍 正在检查翻译完整性...\n");

  // 读取所有语言文件
  const files = readdirSync(localesDir).filter(file => file.endsWith(".json") && file !== "package.json");

  if (files.length === 0) {
    console.log("❌ 没有找到翻译文件");
    process.exit(1);
  }

  console.log(`📁 找到 ${files.length} 个翻译文件: ${files.join(", ")}\n`);

  // 解析所有翻译文件
  const translations = {};

  for (const file of files) {
    const lang = file.replace(".json", "");
    try {
      const content = readFileSync(join(localesDir, file), "utf8");
      translations[lang] = JSON.parse(content);
    } catch (error) {
      console.error(`❌ 解析 ${file} 失败:`, error.message);
      process.exit(1);
    }
  }

  // 获取所有语言的键路径
  const langKeys = {};

  for (const [lang, data] of Object.entries(translations)) {
    langKeys[lang] = getNestedKeys(data);
  }

  // 检查键完整性
  const allLangs = Object.keys(langKeys);
  const baseLang = allLangs[0];
  const baseKeys = langKeys[baseLang];

  console.log(`📋 基准语言: ${baseLang}`);
  console.log(`📋 基准键数量: ${baseKeys.length}\n`);

  let hasErrors = false;

  for (const lang of allLangs.slice(1)) {
    const currentKeys = langKeys[lang];
    const missingInCurrent = baseKeys.filter(key => !currentKeys.includes(key));
    const extraInCurrent = currentKeys.filter(key => !baseKeys.includes(key));

    if (missingInCurrent.length > 0 || extraInCurrent.length > 0) {
      console.log(`❌ ${lang}:`);
      hasErrors = true;

      if (missingInCurrent.length > 0) {
        console.log(`   缺少 ${missingInCurrent.length} 个键:`);
        for (const key of missingInCurrent.slice(0, 10)) {
          console.log(`     - ${key}`);
        }
        if (missingInCurrent.length > 10) {
          console.log(`     ... 及其他 ${missingInCurrent.length - 10} 个键`);
        }
      }

      if (extraInCurrent.length > 0) {
        console.log(`   多余 ${extraInCurrent.length} 个键:`);
        for (const key of extraInCurrent.slice(0, 10)) {
          console.log(`     - ${key}`);
        }
        if (extraInCurrent.length > 10) {
          console.log(`     ... 及其他 ${extraInCurrent.length - 10} 个键`);
        }
      }

      console.log("");
    } else {
      console.log(`✅ ${lang}: 键结构一致\n`);
    }
  }

  if (hasErrors) {
    console.log("❌ 翻译完整性检查失败");
    process.exit(1);
  } else {
    console.log("✅ 翻译完整性检查通过");
  }
}

main();
