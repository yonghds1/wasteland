import { Command } from 'commander';

import { loadWastelandSettings } from '@config/load-settings.js';
import { redactSensitiveConfig, resolveChatRuntime } from '@config/resolve-chat-runtime.js';
import { initI18n, t } from '@locales/index.js';

type ConfigCurrentOptions = {
  role?: string;
};

async function runCurrentConfig(options: ConfigCurrentOptions): Promise<void> {
  const cwd = process.cwd();
  const loadedSettings = await loadWastelandSettings({
    cwd,
    env: process.env,
  });

  // 初始化 i18n
  const language = loadedSettings.settings.runtime.language;
  await initI18n(language);

  const resolved = resolveChatRuntime({
    settings: loadedSettings.settings,
    roleName: options.role,
    cwd,
    memory: loadedSettings.memory,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        cwd,
        sources: loadedSettings.sources,
        defaults: {
          provider: loadedSettings.settings.defaultProvider,
          role: loadedSettings.settings.runtime.defaultRole,
        },
        available: {
          providers: Object.keys(loadedSettings.settings.providers).sort(),
          models: Object.keys(loadedSettings.settings.models).sort(),
          multiAgent: Object.keys(loadedSettings.settings.multiAgent).sort(),
        },
        resolved: {
          role: resolved.role
            ? {
                name: resolved.role.name,
                config: redactSensitiveConfig(resolved.role.config),
              }
            : null,
          model: resolved.model
            ? {
                name: resolved.model.name,
                config: redactSensitiveConfig(resolved.model.config),
              }
            : null,
          provider: {
            name: resolved.providerName,
            settings: redactSensitiveConfig(resolved.providerConfig),
          },
          runtime: {
            permissionMode: resolved.permissionMode,
            maxStepsPerTurn: loadedSettings.settings.runtime.maxStepsPerTurn,
            doomLoopThreshold: loadedSettings.settings.runtime.doomLoopThreshold,
            childAgentTimeout: loadedSettings.settings.runtime.childAgentTimeout,
            debug: loadedSettings.settings.runtime.debug,
          },
        },
      },
      null,
      2
    )}\n`
  );
}

export function createCurrentConfigCommand(name = 'current'): Command {
  return new Command(name)
    .description(t('commands.config.current.description'))
    .option('-r, --role <name>', t('commands.config.current.options.role'))
    .action(runCurrentConfig);
}

export function createConfigCommand(): Command {
  return new Command('config')
    .description(t('commands.config.current.description'))
    .addCommand(createCurrentConfigCommand());
}
