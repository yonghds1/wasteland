import { beforeEach, describe, expect, it } from 'vitest';

import { collectSubAgentSkins, selectAndAcquireSkin } from '../skin-acquirer.js';
import * as skinOccupancy from '@core/runtime/skin-occupancy.js';

describe('collectSubAgentSkins', () => {
  it('returns [] when config is undefined', () => {
    expect(collectSubAgentSkins(undefined)).toEqual([]);
  });

  it('returns [] when neither skin nor skins provided', () => {
    expect(collectSubAgentSkins({})).toEqual([]);
  });

  it('单值 skin 优先：存在时返回固定 [skin]，忽略 skins 数组', () => {
    const candidates = collectSubAgentSkins({
      skin: 'warlord-stern',
      skins: ['scout', 'scholar'],
    });
    expect(candidates).toEqual(['warlord-stern']);
  });

  it('无单值 skin 时返回 skins 数组（随机候选）', () => {
    const candidates = collectSubAgentSkins({
      skins: ['scout', 'scholar', 'warlord-casual'],
    });
    expect(candidates).toEqual(['scout', 'scholar', 'warlord-casual']);
  });

  it('skins 数组去重且保持顺序', () => {
    const candidates = collectSubAgentSkins({
      skins: ['scout', 'scout', 'scholar'],
    });
    expect(candidates).toEqual(['scout', 'scholar']);
  });

  it('空串/空白 skin 值被忽略', () => {
    expect(collectSubAgentSkins({ skin: '   ' })).toEqual([]);
    expect(collectSubAgentSkins({ skin: '', skins: ['scout'] })).toEqual(['scout']);
  });
});

describe('selectAndAcquireSkin', () => {
  beforeEach(() => {
    skinOccupancy.clearAll();
  });

  it('候选为空时 fallback 到默认皮肤（不占用）', () => {
    const picked = selectAndAcquireSkin([], 'sess-empty');
    expect(typeof picked).toBe('string');
    expect(picked.length).toBeGreaterThan(0);
  });

  it('单值候选固定返回该皮肤', () => {
    const picked = selectAndAcquireSkin(['scout'], 'sess-fixed');
    expect(picked).toBe('scout');
  });

  it('多候选随机返回其中一个', () => {
    const picked = selectAndAcquireSkin(['scout', 'scholar'], 'sess-random');
    expect(['scout', 'scholar']).toContain(picked);
  });
});