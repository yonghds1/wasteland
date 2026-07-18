/**
 * skin-loader.ts - 皮肤加载器
 *
 * 负责加载和应用皮肤配置
 * 支持多皮肤切换和自定义皮肤
 */

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

export type Skin = {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  cli: SkinCLIConfig;
  ui: SkinUIConfig;
  roles: SkinRolesConfig;
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

/** 内置皮肤 id 列表 */
const BUILTIN_SKIN_IDS = ['immortan-joe'];

/**
 * 加载皮肤配置
 *
 * 皮肤内置化：仅支持内置皮肤（当前 immortan-joe）。
 * 按 language 取对应语言的内置双语文案。
 */
export async function loadSkin(
  skinId: string = DEFAULT_SKIN_ID,
  language?: string
): Promise<Skin> {
  if (skinId === 'immortan-joe') {
    const skin = getSkinWithLanguage(language);
    currentSkin = skin;
    return skin;
  }

  throw new Error(
    t('skins.notFound', { skinId, skinPath: `(builtin: ${BUILTIN_SKIN_IDS.join(', ')})` })
  );
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
export async function getDefaultSkin(language?: string): Promise<Skin> {
  return loadSkin(DEFAULT_SKIN_ID, language);
}

/**
 * 列出所有可用皮肤（内置）
 */
export async function listSkins(language?: string): Promise<Skin[]> {
  return [getSkinWithLanguage(language)];
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
