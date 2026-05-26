import { Command } from "commander";

import { loadRxcSettings } from "../config/load-settings.js";
import {
  redactSensitiveConfig,
  resolveChatRuntime,
} from "../config/resolve-chat-runtime.js";

type ConfigCurrentOptions = {
  role?: string;
};

async function runCurrentConfig(options: ConfigCurrentOptions): Promise<void> {
  const cwd = process.cwd();
  const loadedSettings = await loadRxcSettings({
    cwd,
    env: process.env,
  });
  const resolved = resolveChatRuntime({
    settings: loadedSettings.settings,
    roleName: options.role,
    cwd,
  });

  process.stdout.write(`${JSON.stringify({
    cwd,
    sources: loadedSettings.sources,
    defaults: {
      provider: loadedSettings.settings.defaultProvider,
      role: loadedSettings.settings.runtime.defaultRole,
    },
    available: {
      providers: Object.keys(loadedSettings.settings.providers).sort(),
      models: Object.keys(loadedSettings.settings.models).sort(),
      roles: Object.keys(loadedSettings.settings.roles).sort(),
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
        debug: loadedSettings.settings.runtime.debug,
      },
    },
  }, null, 2)}\n`);
}

export function createCurrentConfigCommand(name = "current"): Command {
  return new Command(name)
    .description("输出当前生效的运行时配置。")
    .option("-r, --role <name>", "按指定 role 解析当前生效配置")
    .action(runCurrentConfig);
}

export function createConfigCommand(): Command {
  return new Command("config")
    .description("查看当前生效配置。")
    .addCommand(createCurrentConfigCommand());
}
