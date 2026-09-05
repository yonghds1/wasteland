/**
 * HelpCommandsView 单元测试
 *
 * 覆盖 07-30-07-30-help-dialog-mode 任务 PRD §AC6/AC7/AC9:
 * - sectionSeparator: 段间分隔线长度计算
 * - shouldRenderBanner: 终端宽阈值(>= 100 显示 box)
 * - buildBannerContent: banner 行内容
 * - buildSkillsSection: 复用 getCommandManager 派生 skills 列表
 * - createHelp*Section: 4 段 text generator 输出
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  sectionSeparator,
  shouldRenderBanner,
  buildBannerContent,
  buildSkillsSection
} from './HelpCommandsView.js';
import {
  createHelpCommandsSection,
  createHelpToolsSection,
  createHelpSkillsSection,
  createHelpLocalCommandsSection
} from '@core/shared/command-handlers.js';
import {
  createCommandManager,
  resetCommandManager,
  setCommandManager
} from '@core/shared/command-manager.js';
import { builtinCommands } from '@core/shared/command-definitions.js';
import { initI18n } from '@locales/i18n.js';

// ============================================================
// setup
// ============================================================

beforeEach(async () => {
  resetCommandManager();
  const manager = createCommandManager();
  manager.registerAll(builtinCommands);
  setCommandManager(manager);
  await initI18n('en');
});

// ============================================================
// sectionSeparator
// ============================================================

describe('sectionSeparator', () => {
  it('returns at least 8 chars for tiny terminals', () => {
    expect(sectionSeparator(0).length).toBeGreaterThanOrEqual(8);
    expect(sectionSeparator(2).length).toBeGreaterThanOrEqual(8);
  });

  it('caps at 40 chars for huge terminals', () => {
    expect(sectionSeparator(500).length).toBeLessThanOrEqual(40);
    expect(sectionSeparator(500).length).toBe(40);
  });

  it('width=44 → 40 chars (width - 4)', () => {
    expect(sectionSeparator(44).length).toBe(40);
  });

  it('width=20 → min 8 (clamp)', () => {
    // 20 - 4 = 16, > 8, so uses 16
    expect(sectionSeparator(20).length).toBe(16);
  });

  it('width=10 → min 8 (clamp below width-4)', () => {
    expect(sectionSeparator(10).length).toBe(8);
  });

  it('uses ─ character', () => {
    expect(sectionSeparator(80)).toMatch(/^─+$/);
  });
});

// ============================================================
// shouldRenderBanner
// ============================================================

describe('shouldRenderBanner', () => {
  it('true for wide terminals (>= 100)', () => {
    expect(shouldRenderBanner(100)).toBe(true);
    expect(shouldRenderBanner(120)).toBe(true);
    expect(shouldRenderBanner(200)).toBe(true);
  });

  it('false for narrow terminals (< 100)', () => {
    expect(shouldRenderBanner(99)).toBe(false);
    expect(shouldRenderBanner(80)).toBe(false);
    expect(shouldRenderBanner(40)).toBe(false);
    expect(shouldRenderBanner(0)).toBe(false);
  });
});

// ============================================================
// buildBannerContent
// ============================================================

describe('buildBannerContent', () => {
  it('returns 3 lines (top border + title + bottom border)', () => {
    const lines = buildBannerContent();
    expect(lines.length).toBe(3);
  });

  it('contains WASTELAND MANUAL title', () => {
    const lines = buildBannerContent();
    expect(lines.some((l) => l.includes('WASTELAND'))).toBe(true);
    expect(lines.some((l) => l.includes('MANUAL'))).toBe(true);
  });

  it('uses double-border characters (╔/║/╚/═)', () => {
    const lines = buildBannerContent();
    expect(lines[0]?.startsWith('╔')).toBe(true);
    expect(lines[0]?.endsWith('╗')).toBe(true);
    expect(lines[2]?.startsWith('╚')).toBe(true);
    expect(lines[2]?.endsWith('╝')).toBe(true);
  });
});

// ============================================================
// buildSkillsSection
// ============================================================

describe('buildSkillsSection', () => {
  it('returns non-empty list with skill entries', () => {
    const lines = buildSkillsSection();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/skills?/i);
  });

  it('includes /help entry from builtin', () => {
    const lines = buildSkillsSection();
    expect(lines.some((l) => l.includes('/help'))).toBe(true);
  });

  it('includes skill entries from bootstrap (e.g. /status)', () => {
    const lines = buildSkillsSection();
    // DEFAULT_SKILLS includes /status (skill)
    expect(lines.some((l) => l.includes('/status'))).toBe(true);
  });
});

// ============================================================
// createHelpCommandsSection
// ============================================================

describe('createHelpCommandsSection', () => {
  it('returns 7 lines including header', () => {
    const lines = createHelpCommandsSection();
    expect(lines.length).toBe(7);
    expect(lines[0]).toContain('Session commands');
  });

  it('lists core session commands', () => {
    const lines = createHelpCommandsSection();
    expect(lines.some((l) => l.includes('/help'))).toBe(true);
    expect(lines.some((l) => l.includes('/tools'))).toBe(true);
    expect(lines.some((l) => l.includes('/skills'))).toBe(true);
    expect(lines.some((l) => l.includes('/clear'))).toBe(true);
    expect(lines.some((l) => l.includes('/sessions'))).toBe(true);
    expect(lines.some((l) => l.includes('/exit'))).toBe(true);
  });
});

// ============================================================
// createHelpToolsSection
// ============================================================

describe('createHelpToolsSection', () => {
  it('returns header + 7 tool entries', () => {
    const lines = createHelpToolsSection();
    expect(lines.length).toBe(8);
    expect(lines[0]).toContain('Local tool syntax');
  });

  it('lists all local tools', () => {
    const lines = createHelpToolsSection();
    for (const tool of ['/read', '/write', '/edit', '/bash', '/glob', '/grep', '/ls']) {
      expect(lines.some((l) => l.includes(tool))).toBe(true);
    }
  });
});

// ============================================================
// createHelpSkillsSection
// ============================================================

describe('createHelpSkillsSection', () => {
  it('returns 2 lines with header + content for non-empty skillsHelp', () => {
    const lines = createHelpSkillsSection('  /foo\n  /bar');
    expect(lines[0]).toContain('Available skills');
    expect(lines[1]).toContain('/foo');
    expect(lines[1]).toContain('/bar');
  });

  it('returns hint when skillsHelp is empty', () => {
    const lines = createHelpSkillsSection('');
    expect(lines[0]).toContain('Available skills');
    expect(lines.length).toBe(2);
    expect(lines[1]).toMatch(/Run \/skills/i);
  });
});

// ============================================================
// createHelpLocalCommandsSection
// ============================================================

describe('createHelpLocalCommandsSection', () => {
  it('returns 7 lines including header', () => {
    const lines = createHelpLocalCommandsSection();
    expect(lines.length).toBe(7);
    expect(lines[0]).toContain('Local commands');
  });

  it('lists local TUI commands', () => {
    const lines = createHelpLocalCommandsSection();
    for (const cmd of ['/logs', '/mode', '/context', '/clear', '/sessions', '/exit']) {
      expect(lines.some((l) => l.includes(cmd))).toBe(true);
    }
  });
});
