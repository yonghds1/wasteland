/**
 * skin.ts - 皮肤管理命令
 *
 * 管理 TUI 皮肤：列出、查看、加载、重置皮肤。
 * 皮肤数据从 `.wasteland/skins/*.json` 动态加载。
 *
 * ## 命令
 *
 * - `/skin list` - 列出所有可用皮肤
 * - `/skin show` - 显示当前皮肤详情
 * - `/skin load <skinId>` - 加载指定皮肤
 * - `/skin info <skinId>` - 显示皮肤详情
 * - `/skin reset` - 重置到默认皮肤
 */

import { Command } from 'commander';
import {
  getSkin,
  initSkinRegistry,
  listSkins,
  validateSkinId,
  type SkinEntry,
} from '@skins/index.js';
import {
  loadWastelandSettings,
} from '@config/load-settings.js';
import { updateRuntimeSkinId } from '@config/config-writer.js';
import { resolvePalette } from '@theme/palette.js';

async function loadSettingsAndInitSkins() {
  const loaded = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
  const userConfigDir = `${process.env.HOME ?? '~'}/.wasteland`;
  const projectConfigDir = loaded.projectConfigDir ?? undefined;
  await initSkinRegistry(userConfigDir, projectConfigDir);
  return loaded;
}

/** 读取当前持久化的 skinId */
async function readPersistedSkinId(): Promise<string> {
  const loaded = await loadSettingsAndInitSkins();
  return loaded.settings.runtime.skinId ?? '';
}

/** 创建 skin 命令 */
export function createSkinCommand(): Command {
  const skinCommand = new Command('skin').description('皮肤管理');

  // /skin list
  skinCommand
    .command('list')
    .description('列出所有可用皮肤')
    .action(async () => {
      const persistedSkinId = await readPersistedSkinId();
      const skins: SkinEntry[] = listSkins();

      console.log('\n可用皮肤:\n');
      for (const entry of skins) {
        const marker = persistedSkinId === entry.id ? '●' : '○';
        console.log(`  ${marker} ${entry.id}`);
        console.log(`    名称: ${entry.skin.label}`);
        if (entry.skin.colors?.label) {
          console.log(`    颜色: ${resolvePalette(entry.skin).label}`);
        }
        console.log('');
      }
    });

  // /skin show
  skinCommand
    .command('show')
    .description('显示当前皮肤详情')
    .action(async () => {
      const persistedSkinId = await readPersistedSkinId();
      const skin = getSkin(persistedSkinId);
      console.log(`\n当前皮肤: ${persistedSkinId}\n`);
      console.log(`名称: ${skin.label}`);
      if (skin.colors) {
        console.log(`颜色: ${JSON.stringify(resolvePalette(skin))}`);
      }
    });

  // /skin load <skinId>
  skinCommand
    .command('load <skinId>')
    .description('加载指定皮肤')
    .action(async (skinId: string) => {
      try {
        await loadSettingsAndInitSkins();
        if (!validateSkinId(skinId)) {
          console.error(`错误: 皮肤 "${skinId}" 不存在`);
          process.exitCode = 1;
          return;
        }

        await updateRuntimeSkinId(skinId, { cwd: process.cwd(), env: process.env });

        const skin = getSkin(skinId);
        console.log(`已加载皮肤: ${skin.label} (${skinId})`);
      } catch (error) {
        console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  // /skin info <skinId>
  skinCommand
    .command('info <skinId>')
    .description('显示皮肤详情')
    .action(async (skinId: string) => {
      try {
        await loadSettingsAndInitSkins();
        const skin = getSkin(skinId);
        console.log(`\n皮肤详情: ${skin.label}\n`);
        console.log(`ID: ${skinId}`);
        console.log(`思考文案: ${skin.thinking.length} 条`);
        console.log(`欢迎语: ${skin.greeting.length} 条`);
        console.log(`口头禅: ${skin.catchphrases.length} 条`);
        if (skin.colors) {
          console.log(`颜色: ${JSON.stringify(resolvePalette(skin))}`);
        }
      } catch (error) {
        console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  return skinCommand;
}
