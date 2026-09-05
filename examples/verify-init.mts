// Manual E2E: write config → reload → resolve runtime
import { writeInitialConfig } from '../src/config/config-writer.js';
import { loadWastelandSettings } from '../src/config/load-settings.js';
import { resolveChatRuntime } from '../src/config/resolve-chat-runtime.js';
import { initI18n } from '../src/locales/index.js';

async function main() {
  await initI18n('zh');

  const paths = await writeInitialConfig({
    providerName: 'deepseek',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test-1234',
    modelId: 'deepseek-chat',
  });
  console.log('written:', paths);

  const loaded = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
  console.log('loaded models:', Object.keys(loaded.settings.models));
  console.log('loaded providers:', Object.keys(loaded.settings.providers));

  const runtime = resolveChatRuntime({ settings: loaded.settings });
  console.log('resolved model:', runtime.model?.name, 'provider:', runtime.providerName);
  const key = runtime.providerConfig.apiKey;
  console.log('apiKey resolved to:', typeof key === 'string' ? key : JSON.stringify(key));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
