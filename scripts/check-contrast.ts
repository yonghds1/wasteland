import { getSkinContrastIssue, initSkinRegistry, listSkins } from '../src/skins/index.js';

/** 检查全部注册皮肤的 label、正文和 thinking APCA 对比度。 */
async function main(): Promise<void> {
  await initSkinRegistry();

  const skins = listSkins();
  for (const { id, skin } of skins) {
    const issue = getSkinContrastIssue(skin);
    if (issue) {
      throw new Error(`Skin "${id}" failed contrast validation: ${issue}`);
    }
  }

  console.log(`APCA contrast check passed for ${skins.length} skins.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
