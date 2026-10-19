import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Skin } from '../types.js';
import type { SkinsDefinition } from '../loader.js';
import {
  initSkinRegistry,
  getSkin,
  getSingleAgentSkin,
  listSkins,
  validateSkinId,
  getSkinContrastIssue,
  defaultSkin,
} from '../index.js';
import {
  mergeSkins,
  mergeSingleAgent,
  loadSkinsWithPriority,
} from '../loader.js';
import { getRoleCatchphrase } from '../../tui/components/chat-message-utils.js';

describe('Skin System Core', () => {
  const BUILTIN_SKIN_IDS = [
    'warlord-immortal',
    'road-nomad',
    'fury-vanguard',
    'v8-mechanic',
    'sand-scout',
    'bullet-tester',
    'doof-analyst',
  ] as const;

  beforeEach(async () => {
    // 每次测试前初始化默认注册表
    await initSkinRegistry();
  });

  describe('测试 1（内置皮肤完整性校验）', () => {
    it('验证 7 款内置皮肤全部成功加载', () => {
      const skins = listSkins();
      const skinMap = new Map(skins.map((item) => [item.id, item.skin]));

      expect(skins.length).toBeGreaterThanOrEqual(BUILTIN_SKIN_IDS.length);
      for (const id of BUILTIN_SKIN_IDS) {
        expect(skinMap.has(id)).toBe(true);
      }
    });

    it('验证每款皮肤的 id, label, thinking, greeting, catchphrases 完整非空', () => {
      for (const id of BUILTIN_SKIN_IDS) {
        const skin = getSkin(id);
        expect(skin.id).toBe(id);
        expect(typeof skin.label).toBe('string');
        expect(skin.label.trim().length).toBeGreaterThan(0);

        expect(Array.isArray(skin.thinking)).toBe(true);
        expect(skin.thinking.length).toBeGreaterThan(0);
        for (const item of skin.thinking) {
          expect(typeof item).toBe('string');
          expect(item.trim().length).toBeGreaterThan(0);
        }

        expect(Array.isArray(skin.greeting)).toBe(true);
        expect(skin.greeting.length).toBeGreaterThan(0);
        for (const item of skin.greeting) {
          expect(typeof item).toBe('string');
          expect(item.trim().length).toBeGreaterThan(0);
        }

        expect(Array.isArray(skin.catchphrases)).toBe(true);
        expect(skin.catchphrases.length).toBeGreaterThan(0);
        for (const item of skin.catchphrases) {
          expect(typeof item).toBe('string');
          expect(item.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it('验证所有自带 colors 的皮肤通过 APCA 对比度测试', () => {
      for (const id of BUILTIN_SKIN_IDS) {
        const skin = getSkin(id);
        const issue = getSkinContrastIssue(skin);
        expect(issue).toBeNull();
      }

      // 测试带高对比度颜色的合法皮肤
      const validColoredSkin: Skin = {
        id: 'valid-colored',
        label: '高对比度皮肤',
        thinking: ['思考中...'],
        greeting: ['你好！'],
        catchphrases: ['冲！'],
        colors: {
          label: '#ffffff',
          text: '#f0f0f0',
          thinking: '#cccccc',
        },
      };
      expect(getSkinContrastIssue(validColoredSkin)).toBeNull();

      // 测试极低对比度（黑底深黑字）导致对比度未通过
      const lowContrastSkin: Skin = {
        id: 'low-contrast',
        label: '低对比度皮肤',
        thinking: ['思考中...'],
        greeting: ['你好！'],
        catchphrases: ['冲！'],
        colors: {
          label: '#131313',
        },
      };
      const issue = getSkinContrastIssue(lowContrastSkin);
      expect(issue).not.toBeNull();
      expect(typeof issue).toBe('string');
    });
  });

  describe('测试 2（查询与容错降级）', () => {
    it('查询已存在的合法皮肤 ID 返回正确对象', () => {
      const immortal = getSkin('warlord-immortal');
      expect(immortal.id).toBe('warlord-immortal');
      expect(immortal.label).toBe('不死老蕉');

      const vanguard = getSkin('fury-vanguard');
      expect(vanguard.id).toBe('fury-vanguard');
      expect(vanguard.label).toBe('独臂弗莎');
    });

    it('查询不存在的皮肤 ID 能优雅降级到默认皮肤 warlord-immortal', () => {
      const fallback = getSkin('non-existent-cyborg');
      expect(fallback.id).toBe(defaultSkin);
      expect(fallback.label).toBe('不死老蕉');

      const emptyParamFallback = getSkin();
      expect(emptyParamFallback.id).toBe(defaultSkin);
    });

    it('测试 validateSkinId 对有效与无效 ID 的判断', () => {
      expect(validateSkinId('warlord-immortal')).toBe(true);
      expect(validateSkinId('road-nomad')).toBe(true);
      expect(validateSkinId('non-existent-cyborg')).toBe(false);
      expect(validateSkinId('')).toBe(false);
      expect(validateSkinId(null)).toBe(false);
      expect(validateSkinId(undefined)).toBe(false);
      expect(validateSkinId(12345)).toBe(false);
      expect(validateSkinId({})).toBe(false);
    });

    it('验证 getSingleAgentSkin() 的真源返回逻辑', () => {
      const singleAgentId = getSingleAgentSkin();
      expect(singleAgentId).toBe('road-nomad');
      expect(validateSkinId(singleAgentId)).toBe(true);
    });
  });

  describe('测试 3（多层级覆盖合并行为）', () => {
    it('测试 mergeSkins：高优先级覆盖低优先级属性并保留未覆盖字段', () => {
      const base: SkinsDefinition = {
        'skin-a': {
          id: 'skin-a',
          label: '基础 A',
          thinking: ['A1'],
          greeting: ['A2'],
          catchphrases: ['A3'],
        },
        'skin-b': {
          id: 'skin-b',
          label: '基础 B',
          thinking: ['B1'],
          greeting: ['B2'],
          catchphrases: ['B3'],
        },
      };

      const override: SkinsDefinition = {
        'skin-b': {
          id: 'skin-b',
          label: '覆盖后的 B',
          thinking: ['B1-new'],
          greeting: ['B2-new'],
          catchphrases: ['B3-new'],
        },
        'skin-c': {
          id: 'skin-c',
          label: '新皮肤 C',
          thinking: ['C1'],
          greeting: ['C2'],
          catchphrases: ['C3'],
        },
      };

      const merged = mergeSkins(base, override);
      expect(merged['skin-a'].label).toBe('基础 A');
      expect(merged['skin-b'].label).toBe('覆盖后的 B');
      expect(merged['skin-c'].label).toBe('新皮肤 C');
    });

    it('测试 mergeSingleAgent：正确覆盖默认单 agent 皮肤', () => {
      const base = { skin: 'road-nomad' };
      const override = { skin: 'v8-mechanic' };
      const merged = mergeSingleAgent(base, override);
      expect(merged.skin).toBe('v8-mechanic');
    });

    it('测试 loadSkinsWithPriority：内置 < 用户级 < 项目级 三层合并机制', async () => {
      const tempUserDir = await mkdtemp(join(tmpdir(), 'wl-skin-user-'));
      const tempProjectDir = await mkdtemp(join(tmpdir(), 'wl-skin-proj-'));

      try {
        const userSkinsFile = {
          skins: {
            'warlord-immortal': {
              label: '用户级老蕉',
              thinking: ['用户思考'],
              greeting: ['用户问候'],
              catchphrases: ['用户口头禅'],
            },
            'user-only-skin': {
              label: '用户专属皮肤',
              thinking: ['U-Think'],
              greeting: ['U-Greet'],
              catchphrases: ['U-Phrase'],
            },
          },
          singleAgent: { skin: 'user-only-skin' },
        };

        const projectSkinsFile = {
          skins: {
            'warlord-immortal': {
              label: '项目特化老蕉',
              thinking: ['项目思考'],
              greeting: ['项目问候'],
              catchphrases: ['项目口头禅'],
            },
            'project-only-skin': {
              label: '项目专属皮肤',
              thinking: ['P-Think'],
              greeting: ['P-Greet'],
              catchphrases: ['P-Phrase'],
            },
          },
          singleAgent: { skin: 'project-only-skin' },
        };

        await writeFile(join(tempUserDir, 'skins.json'), JSON.stringify(userSkinsFile), 'utf-8');
        await writeFile(join(tempProjectDir, 'skins.json'), JSON.stringify(projectSkinsFile), 'utf-8');

        const { skins, singleAgent } = await loadSkinsWithPriority(tempUserDir, tempProjectDir);

        // 1. 项目级覆盖优先于用户级和内置默认
        expect(skins['warlord-immortal'].label).toBe('项目特化老蕉');
        // 2. 项目级未覆盖的皮肤保留用户级定义
        expect(skins['user-only-skin'].label).toBe('用户专属皮肤');
        // 3. 项目级新增皮肤正常存在
        expect(skins['project-only-skin'].label).toBe('项目专属皮肤');
        // 4. 用户级与项目级未覆盖的内置皮肤保持内置原样
        expect(skins['fury-vanguard'].label).toBe('独臂弗莎');
        // 5. singleAgent 由项目级胜出
        expect(singleAgent.skin).toBe('project-only-skin');
      } finally {
        await rm(tempUserDir, { recursive: true, force: true });
        await rm(tempProjectDir, { recursive: true, force: true });
      }
    });
  });

  describe('测试 4（台词提取与空边界安全）', () => {
    it('验证 getRoleCatchphrase 能随机返回皮肤口头禅之一', () => {
      const skin = getSkin('road-nomad');
      expect(skin.catchphrases.length).toBeGreaterThan(0);

      const phrase = getRoleCatchphrase(skin);
      expect(typeof phrase).toBe('string');
      expect(phrase.length).toBeGreaterThan(0);
      expect(skin.catchphrases).toContain(phrase);
    });

    it('当皮肤对象的 catchphrases 为空数组时安全返回空字符串', () => {
      const emptyPhraseSkin: Skin = {
        id: 'empty-phrase-skin',
        label: '沉默行者',
        thinking: ['...'],
        greeting: ['...'],
        catchphrases: [],
      };

      const result = getRoleCatchphrase(emptyPhraseSkin);
      expect(result).toBe('');
      expect(result).not.toBeUndefined();
    });
  });
});
