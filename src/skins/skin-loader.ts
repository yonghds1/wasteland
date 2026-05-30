/**
 * skin-loader.ts - 皮肤加载器
 *
 * 负责加载和应用皮肤配置
 * 支持多皮肤切换和自定义皮肤
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { t, tArray, type Language } from '../locales/index.js';

// ============================================================
// 皮肤类型定义
// ============================================================

export type SkinCLIConfig = {
  commandName: string;
  aliases: string[];
  version: string;
  description: string;
};

export type SkinUIPrompts = {
  input: string;
  assistant: string;
  system: string;
};

export type SkinUILabels = {
  user: string;
  assistant: string;
  system: string;
};

export type SkinUIMessages = {
  welcome: string;
  thinking: string;
  success: string;
  error: string;
};

export type SkinUIColors = {
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
};

export type SkinUIBanner = {
  title: string;
  subtitle: string;
  style: string;
};

export type SkinUIConfig = {
  banner: SkinUIBanner;
  prompts: SkinUIPrompts;
  labels: SkinUILabels;
  messages: SkinUIMessages;
  colors: SkinUIColors;
};

export type SkinRoleConfig = {
  id?: string;
  name?: string;
  title?: string;
  aliases?: string[];
  personality?: string;
  greeting: string;
  catchphrases: string[];
};

export type SkinRolesConfig = {
  main: SkinRoleConfig;
  workers: Record<string, SkinRoleConfig>;
};

export type SkinWorkflowConfig = {
  delegation: {
    strategy: string;
    description: string;
  };
  aggregation: {
    strategy: string;
    description: string;
  };
  errorHandling: {
    strategy: string;
    description: string;
  };
};

export type SkinTemplateConfig = Record<string, string>;

export type Skin = {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  cli: SkinCLIConfig;
  ui: SkinUIConfig;
  roles: SkinRolesConfig;
  templates: SkinTemplateConfig;
  workflow: SkinWorkflowConfig;
  metadata: {
    createdAt: string;
    updatedAt: string;
    tags: string[];
  };
};

// ============================================================
// 内置默认皮肤 - Immortan Joe
// ============================================================

/**
 * 根据语言获取皮肤配置
 *
 * @param lang - 语言代码
 * @returns 皮肤配置
 */
function getSkinWithLanguage(lang?: Language): Skin {
  const language = lang ?? 'en';

  // 基础皮肤配置（非翻译部分）
  const baseSkin: Skin = {
    id: 'immortan-joe',
    name: t('skin.name', undefined, language),
    description: t('skin.description', undefined, language),
    author: 'Immortan Joe',
    version: '1.0.0',
    cli: {
      commandName: 'wasteland',
      aliases: ['wasteland', 'joe'],
      version: '0.1.0',
      description: t('skin.cli.description', undefined, language),
    },
    ui: {
      banner: {
        title: t('skin.ui.banner.title', undefined, language),
        subtitle: t('skin.ui.banner.subtitle', undefined, language),
        style: 'wasteland',
      },
      prompts: {
        input: 'wasteland>',
        assistant: t('skin.ui.prompts.assistant', undefined, language),
        system: t('skin.ui.prompts.system', undefined, language),
      },
      labels: {
        user: t('skin.ui.labels.user', undefined, language),
        assistant: t('skin.ui.labels.assistant', undefined, language),
        system: t('skin.ui.labels.system', undefined, language),
      },
      messages: {
        welcome: t('skin.ui.messages.welcome', undefined, language),
        thinking: t('skin.ui.messages.thinking', undefined, language),
        success: t('skin.ui.messages.success', undefined, language),
        error: t('skin.ui.messages.error', undefined, language),
      },
      colors: {
        primary: 'cyan',
        secondary: 'yellow',
        accent: 'red',
        muted: 'gray',
      },
    },
    roles: {
      main: {
        id: 'immortan-joe',
        name: t('skin.roles.main.name', undefined, language),
        title: t('skin.roles.main.title', undefined, language),
        aliases: ['wasteland', 'joe'],
        personality: t('skin.roles.main.personality', undefined, language),
        greeting: t('skin.roles.main.greeting', undefined, language),
        catchphrases: tArray('skin.roles.main.catchphrases', language),
      },
      workers: {
        researcher: {
          personality: t('skin.roles.workers.researcher.personality', undefined, language),
          greeting: t('skin.roles.workers.researcher.greeting', undefined, language),
          catchphrases: tArray('skin.roles.workers.researcher.catchphrases', language),
        },
        developer: {
          personality: t('skin.roles.workers.developer.personality', undefined, language),
          greeting: t('skin.roles.workers.developer.greeting', undefined, language),
          catchphrases: tArray('skin.roles.workers.developer.catchphrases', language),
        },
        analyst: {
          personality: t('skin.roles.workers.analyst.personality', undefined, language),
          greeting: t('skin.roles.workers.analyst.greeting', undefined, language),
          catchphrases: tArray('skin.roles.workers.analyst.catchphrases', language),
        },
        tester: {
          personality: t('skin.roles.workers.tester.personality', undefined, language),
          greeting: t('skin.roles.workers.tester.greeting', undefined, language),
          catchphrases: tArray('skin.roles.workers.tester.catchphrases', language),
        },
      },
    },
    templates: {
      identity: '你是 {{role}}。',
      goal: '你的目标是：{{goal}}',
      backstory: '{{backstory}}',
      constraints: '约束条件：\n{{constraints}}',
    },
    workflow: {
      delegation: {
        strategy: 'sequential',
        description: t('skin.workflow.delegation.description', undefined, language),
      },
      aggregation: {
        strategy: 'merge',
        description: t('skin.workflow.aggregation.description', undefined, language),
      },
      errorHandling: {
        strategy: 'retry',
        description: t('skin.workflow.errorHandling.description', undefined, language),
      },
    },
    metadata: {
      createdAt: '2026-05-28',
      updatedAt: '2026-05-28',
      tags: ['wasteland', 'mad-max', 'immortan-joe', 'default'],
    },
  };

  return baseSkin;
}

// ============================================================
// 皮肤加载器
// ============================================================

const DEFAULT_SKIN_ID = 'immortan-joe';

let currentSkin: Skin | null = null;

/**
 * 获取皮肤目录路径
 */
function getSkinsDir(skinsDir?: string): string {
  if (skinsDir) {
    return resolve(skinsDir);
  }
  // 默认从 .wasteland/.skins/ 加载其他皮肤
  return join(process.cwd(), '.wasteland', '.skins');
}

/**
 * 从文件读取并验证皮肤配置（无副作用）
 */
async function readSkinFromFile(skinPath: string): Promise<Skin> {
  const content = await readFile(skinPath, 'utf8');
  const skin = JSON.parse(content) as Skin;
  validateSkin(skin);
  return skin;
}

/**
 * 加载皮肤配置
 *
 * 加载逻辑：
 * 1. 如果 skinId 是 "immortan-joe"（内置默认皮肤）：
 *    - 优先尝试加载外部皮肤文件
 *    - 如果外部皮肤不存在，使用内置默认皮肤（根据 language 参数选择中文或英文）
 * 2. 其他 skinId：
 *    - 从外部皮肤目录加载
 *    - 如果不存在，抛出错误
 */
export async function loadSkin(
  skinId: string = DEFAULT_SKIN_ID,
  skinsDir?: string,
  language?: string
): Promise<Skin> {
  // 内置默认皮肤：优先使用外部文件，如果没有则使用内置的
  if (skinId === 'immortan-joe') {
    return loadDefaultSkin(skinsDir, language);
  }

  // 其他皮肤：从外部目录加载
  const dir = getSkinsDir(skinsDir);
  const skinPath = join(dir, skinId, 'skin.json');

  try {
    const skin = await readSkinFromFile(skinPath);
    currentSkin = skin;
    return skin;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(t('skins.notFound', { skinId, skinPath }), { cause: error });
    }
    throw error;
  }
}

/**
 * 加载 Immortan Joe 皮肤
 *
 * 优先加载外部皮肤文件，如果没有则使用内置默认皮肤
 */
async function loadDefaultSkin(skinsDir?: string, language?: string): Promise<Skin> {
  const dir = getSkinsDir(skinsDir);
  const skinPath = join(dir, 'immortan-joe', 'skin.json');

  try {
    const skin = await readSkinFromFile(skinPath);
    currentSkin = skin;
    return skin;
  } catch (error) {
    // 外部皮肤不存在，使用内置默认皮肤（根据 language 参数选择语言）
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const skin = getSkinWithLanguage(language);
      currentSkin = skin;
      return skin;
    }
    throw error;
  }
}

/**
 * 验证皮肤配置
 */
function validateSkin(skin: Skin): void {
  if (!skin.id || !skin.name || !skin.cli || !skin.ui || !skin.roles) {
    throw new Error(t('skins.incomplete'));
  }

  if (!skin.cli.commandName) {
    throw new Error(t('skins.missingCommandName'));
  }

  if (!skin.roles.main || !skin.roles.main.greeting) {
    throw new Error(t('skins.missingGreeting'));
  }
}

/**
 * 获取当前皮肤
 */
export function getCurrentSkin(): Skin | null {
  return currentSkin;
}

/**
 * 获取默认皮肤
 */
export async function getDefaultSkin(skinsDir?: string): Promise<Skin> {
  return loadSkin(DEFAULT_SKIN_ID, skinsDir);
}

/**
 * 列出所有可用皮肤
 */
export async function listSkins(skinsDir?: string, language?: string): Promise<Skin[]> {
  const skins: Skin[] = [];

  // 1. 加载 Immortan Joe 皮肤（内置默认或外部）
  try {
    const dir = getSkinsDir(skinsDir);
    const skinPath = join(dir, 'immortan-joe', 'skin.json');
    const skin = await readSkinFromFile(skinPath);
    skins.push(skin);
  } catch {
    // 外部 immortan-joe 皮肤不存在，使用内置默认（根据 language 参数选择语言）
    const skin = getSkinWithLanguage(language);
    skins.push(skin);
  }

  // 2. 加载 .wasteland/.skins/ 目录下的其他皮肤目录
  try {
    const dir = getSkinsDir(skinsDir);
    const entries = await readdir(dir, { withFileTypes: true });
    const skinDirs = entries.filter((e) => e.isDirectory() && e.name !== 'immortan-joe');

    const loads = skinDirs.map(async (entry) => {
      const skinPath = join(dir, entry.name, 'skin.json');
      try {
        return await readSkinFromFile(skinPath);
      } catch {
        return null;
      }
    });

    const results = await Promise.all(loads);
    for (const skin of results) {
      if (skin) {
        skins.push(skin);
      }
    }
  } catch {
    // .skins 目录不存在或无法读取，跳过
  }

  return skins;
}

// ============================================================
// 皮肤查询函数
// ============================================================

/**
 * 获取角色的欢迎语
 */
export function getRoleGreeting(
  skin: Skin,
  roleType: 'main' | 'worker',
  workerId?: string
): string {
  if (roleType === 'main') {
    return skin.roles.main.greeting;
  }

  if (workerId && skin.roles.workers[workerId]) {
    return skin.roles.workers[workerId].greeting;
  }

  return 'Ready to serve.';
}

/**
 * 获取角色的口头禅
 */
export function getRoleCatchphrase(
  skin: Skin,
  roleType: 'main' | 'worker',
  workerId?: string
): string {
  const phrases =
    roleType === 'main'
      ? skin.roles.main.catchphrases
      : (skin.roles.workers[workerId ?? '']?.catchphrases ?? []);

  if (phrases.length === 0) {
    return '';
  }

  return phrases[Math.floor(Math.random() * phrases.length)];
}

// ============================================================
// 皮肤导出
// ============================================================

export { DEFAULT_SKIN_ID };
