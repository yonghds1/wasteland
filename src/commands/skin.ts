/**
 * skin.ts - 内置角色 skin 管理命令
 *
 * Skin 现在只承载系统/角色内容；视觉样式由固定 wasteland theme 管理。
 */

import { Command } from 'commander';
import { getCurrentSkin, listSkins, loadSkin } from '../skins/index.js';
import { loadWastelandSettings } from '../config/load-settings.js';
import { initI18n, t } from '../locales/index.js';

/** 初始化命令使用的语言。 */
async function initializeCommandLanguage(): Promise<void> {
  const loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
  await initI18n(loadedSettings.settings.runtime.language);
}

/** 创建 skin 命令。 */
export function createSkinCommand(): Command {
  const skinCommand = new Command('skin').description(t('commands.skin.list.title'));

  skinCommand
    .command('list')
    .description(t('commands.skin.list.title'))
    .action(async () => {
      await initializeCommandLanguage();
      const current = getCurrentSkin();
      const skins = await listSkins();

      console.log(`\n${t('commands.skin.list.title')}:\n`);
      for (const skin of skins) {
        console.log(`  ${current.id === skin.id ? '●' : '○'} ${skin.id}`);
        console.log(`    ${t('commands.skin.list.name')}: ${t(skin.roleUi.labelKey)}`);
        console.log(`    ${t('commands.skin.list.description')}: ${skin.persona.style}`);
        console.log('');
      }
    });

  skinCommand
    .command('show')
    .description(t('commands.skin.show.title'))
    .action(async () => {
      await initializeCommandLanguage();
      console.log(`\n${t('commands.skin.show.title')}:\n`);
      console.log(JSON.stringify(getCurrentSkin(), null, 2));
    });

  skinCommand
    .command('load <skinId>')
    .description(t('commands.skin.load.success', { name: '', id: '' }))
    .action(async (skinId: string) => {
      try {
        await initializeCommandLanguage();
        const skin = await loadSkin(skinId);
        console.log(
          t('commands.skin.load.success', {
            name: t(skin.roleUi.labelKey),
            id: skin.id,
          })
        );
      } catch (error) {
        console.error(
          t('commands.skin.load.error', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

  skinCommand
    .command('info <skinId>')
    .description(t('commands.skin.info.title', { name: '' }))
    .action(async (skinId: string) => {
      try {
        await initializeCommandLanguage();
        const skin = await loadSkin(skinId);
        const displayName = t(skin.roleUi.labelKey);

        console.log(`\n${t('commands.skin.info.title', { name: displayName })}\n`);
        console.log(`${t('commands.skin.info.id')}: ${skin.id}`);
        console.log(`${t('commands.skin.info.description')}: ${skin.persona.style}`);
        console.log(`${t('commands.skin.info.mainRole')}: ${skin.persona.role}`);
        console.log(`${t('commands.skin.info.roleConfig')}: ${skin.persona.voice}`);
        console.log(`${t('commands.skin.info.tags')}: ${skin.persona.constraints.join('; ')}`);
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
