/**
 * skin.ts - 皮肤管理命令
 *
 * 管理 CLI 皮肤：列出、切换、创建
 */

import { Command } from "commander";
import { listSkins, loadSkin, getCurrentSkin } from "../skins/index.js";
import { switchSkin } from "../utils/symlink-manager.js";

/**
 * 创建 skin 命令
 */
export function createSkinCommand(): Command {
  const skinCommand = new Command("skin")
    .description("管理 CLI 皮肤");

  // skin list - 列出所有皮肤
  skinCommand
    .command("list")
    .description("列出所有可用皮肤")
    .action(async () => {
      const skins = await listSkins();

      if (skins.length === 0) {
        console.log("没有找到皮肤。");
        console.log("请在 .wasteland/.skins/immortan-joe/ 目录中创建皮肤配置文件。");
        return;
      }

      console.log("\n可用皮肤:\n");
      for (const skin of skins) {
        const current = getCurrentSkin();
        const isCurrent = current?.id === skin.id;
        console.log(`  ${isCurrent ? "●" : "○"} ${skin.id}`);
        console.log(`    名称: ${skin.name}`);
        console.log(`    描述: ${skin.description}`);
        console.log(`    版本: ${skin.version}`);
        console.log(`    命令: ${skin.cli.commandName}`);
        console.log(`    别名: ${skin.cli.aliases.join(", ")}`);
        console.log("");
      }
    });

  // skin show - 显示当前皮肤
  skinCommand
    .command("show")
    .description("显示当前皮肤配置")
    .action(async () => {
      const skin = getCurrentSkin();

      if (!skin) {
        console.log("当前没有加载皮肤。");
        console.log("使用 'joe skin list' 查看可用皮肤。");
        return;
      }

      console.log("\n当前皮肤:\n");
      console.log(JSON.stringify(skin, null, 2));
    });

  // skin load - 加载指定皮肤
  skinCommand
    .command("load <skinId>")
    .description("加载指定皮肤")
    .action(async (skinId: string) => {
      try {
        const skin = await loadSkin(skinId);
        console.log(`已加载皮肤: ${skin.name} (${skin.id})`);
        console.log(`命令名: ${skin.cli.commandName}`);
        console.log(`别名: ${skin.cli.aliases.join(", ")}`);

        // 切换皮肤时更新符号链接
        await switchSkin(skinId);
        console.log(`已更新角色别名符号链接`);
      } catch (error) {
        console.error(`加载皮肤失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  // skin info - 显示皮肤详细信息
  skinCommand
    .command("info <skinId>")
    .description("显示指定皮肤的详细信息")
    .action(async (skinId: string) => {
      try {
        const skin = await loadSkin(skinId);

        console.log(`\n皮肤详情: ${skin.name}\n`);
        console.log(`ID: ${skin.id}`);
        console.log(`描述: ${skin.description}`);
        console.log(`作者: ${skin.author}`);
        console.log(`版本: ${skin.version}`);
        console.log("");
        console.log("CLI 配置:");
        console.log(`  命令名: ${skin.cli.commandName}`);
        console.log(`  别名: ${skin.cli.aliases.join(", ")}`);
        console.log(`  版本: ${skin.cli.version}`);
        console.log(`  描述: ${skin.cli.description}`);
        console.log("");
        console.log("角色配置:");
        const mainName = skin.roles.main.name ?? skin.roles.main.id ?? "Unknown";
        const mainTitle = skin.roles.main.title ?? "";
        console.log(`  主角色: ${mainName} ${mainTitle ? `(${mainTitle})` : ""}`);
        console.log(`  子角色: ${Object.keys(skin.roles.workers).join(", ")}`);
        console.log("");
        console.log("元数据:");
        console.log(`  创建时间: ${skin.metadata.createdAt}`);
        console.log(`  更新时间: ${skin.metadata.updatedAt}`);
        console.log(`  标签: ${skin.metadata.tags.join(", ")}`);
      } catch (error) {
        console.error(`获取皮肤信息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  return skinCommand;
}
