/**
 * skin.ts - 皮肤管理命令
 *
 * 管理 CLI 皮肤：列出、切换、创建
 */

import { Command } from 'commander';
import { listSkins, loadSkin, getCurrentSkin } from '../skins/index.js';
import { switchSkin } from '../utils/symlink-manager.js';
import { loadWastelandSettings } from '../config/load-settings.js';
import { initI18n, t } from '../locales/index.js';

/**
 * 创建 skin 命令
 */
export function createSkinCommand(): Command {
  const skinCommand = new Command('skin').description(t('commands.skin.list.description'));

  // skin list - 列出所有皮肤
  skinCommand
    .command('list')
    .description(t('commands.skin.list.description'))
    .action(async () => {
      // 初始化 i18n
      const loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
      const language = loadedSettings.settings.runtime.language;
      await initI18n(language);

      const skins = await listSkins(undefined, language);

      if (skins.length === 0) {
        console.log(t('commands.skin.list.empty'));
        console.log(t('commands.skin.list.emptyHint'));
        return;
      }

      console.log(`\n${t('commands.skin.list.title')}:\n`);
      for (const skin of skins) {
        const current = getCurrentSkin();
        const isCurrent = current?.id === skin.id;
        console.log(`  ${isCurrent ? '●' : '○'} ${skin.id}`);
        console.log(`    ${t('commands.skin.list.name')}: ${skin.name}`);
        console.log(`    ${t('commands.skin.list.description')}: ${skin.description}`);
        console.log(`    ${t('commands.skin.list.version')}: ${skin.version}`);
        console.log(`    ${t('commands.skin.list.command')}: ${skin.cli.commandName}`);
        console.log(`    ${t('commands.skin.list.aliases')}: ${skin.cli.aliases.join(', ')}`);
        console.log('');
      }
    });

  // skin show - 显示当前皮肤
  skinCommand
    .command('show')
    .description(t('commands.skin.show.title'))
    .action(async () => {
      // 初始化 i18n
      const loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
      const language = loadedSettings.settings.runtime.language;
      await initI18n(language);

      const skin = getCurrentSkin();

      if (!skin) {
        console.log(t('commands.skin.show.empty'));
        console.log(t('commands.skin.show.emptyHint'));
        return;
      }

      console.log(`\n${t('commands.skin.show.title')}:\n`);
      console.log(JSON.stringify(skin, null, 2));
    });

  // skin load - 加载指定皮肤
  skinCommand
    .command('load <skinId>')
    .description(
      t('commands.skin.load.success', { name: '', id: '' }).replace('Loaded skin:  ()', 'Load skin')
    )
    .action(async (skinId: string) => {
      try {
        // 获取当前语言设置
        const loadedSettings = await loadWastelandSettings({
          cwd: process.cwd(),
          env: process.env,
        });
        const language = loadedSettings.settings.runtime.language;
        await initI18n(language);

        const skin = await loadSkin(skinId, undefined, language);
        console.log(t('commands.skin.load.success', { name: skin.name, id: skin.id }));
        console.log(t('commands.skin.load.command', { command: skin.cli.commandName }));
        console.log(t('commands.skin.load.aliases', { aliases: skin.cli.aliases.join(', ') }));

        // 切换皮肤时更新符号链接
        await switchSkin(skinId);
        console.log(t('commands.skin.load.symlinks'));
      } catch (error) {
        console.error(
          t('commands.skin.load.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

  // skin info - 显示皮肤详细信息
  skinCommand
    .command('info <skinId>')
    .description(
      t('commands.skin.info.title', { name: '' }).replace('Skin details: ', 'Show skin details')
    )
    .action(async (skinId: string) => {
      try {
        // 获取当前语言设置
        const loadedSettings = await loadWastelandSettings({
          cwd: process.cwd(),
          env: process.env,
        });
        const language = loadedSettings.settings.runtime.language;
        await initI18n(language);

        const skin = await loadSkin(skinId, undefined, language);

        console.log(`\n${t('commands.skin.info.title', { name: skin.name })}\n`);
        console.log(`${t('commands.skin.info.id')}: ${skin.id}`);
        console.log(`${t('commands.skin.info.description')}: ${skin.description}`);
        console.log(`${t('commands.skin.info.author')}: ${skin.author}`);
        console.log(`${t('commands.skin.info.version')}: ${skin.version}`);
        console.log('');
        console.log(`${t('commands.skin.info.cliConfig')}:`);
        console.log(`  ${t('commands.skin.info.commandName')}: ${skin.cli.commandName}`);
        console.log(`  ${t('commands.skin.info.aliases')}: ${skin.cli.aliases.join(', ')}`);
        console.log(`  ${t('commands.skin.info.cliVersion')}: ${skin.cli.version}`);
        console.log(`  ${t('commands.skin.info.cliDescription')}: ${skin.cli.description}`);
        console.log('');
        console.log(`${t('commands.skin.info.roleConfig')}:`);
        const mainName = skin.roles.main.name ?? skin.roles.main.id ?? 'Unknown';
        const mainTitle = skin.roles.main.title ?? '';
        console.log(
          `  ${t('commands.skin.info.mainRole')}: ${mainName} ${mainTitle ? `(${mainTitle})` : ''}`
        );
        console.log(
          `  ${t('commands.skin.info.subRoles')}: ${Object.keys(skin.roles.workers).join(', ')}`
        );
        console.log('');
        console.log(`${t('commands.skin.info.metadata')}:`);
        console.log(`  ${t('commands.skin.info.createdAt')}: ${skin.metadata.createdAt}`);
        console.log(`  ${t('commands.skin.info.updatedAt')}: ${skin.metadata.updatedAt}`);
        console.log(`  ${t('commands.skin.info.tags')}: ${skin.metadata.tags.join(', ')}`);
      } catch (error) {
        console.error(
          t('commands.skin.info.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

  return skinCommand;
}
