/**
 * HelpCommandsView - wasteland 命令参考 dialog
 *
 * 由 /help 命令触发(`state.showHelp === 'commands'`),
 * 显示 wasteland 化的命令手册:4 段内容 + 视觉装饰。
 *
 * ## 结构
 *
 * 1. 顶部 banner(终端宽 >= 100 用 double border,否则简洁标题)
 * 2. description
 * 3. 4 段(commands / tools / skills / localCommands)
 *    - 段标题前缀:`▎ `
 *    - 列表项符号:`▸ `
 * 4. 段间分隔线(`─` × 40)
 * 5. 底部元数据(Session ID / Workdir)
 *
 * ## 交互
 *
 * - Esc / h:由 App.tsx 统一关闭
 *
 * ## 复用
 *
 * 文本生成器从 `command-handlers.ts` 的 4 个 section helper 拆出。
 * skills 列表通过 `getCommandManager()` 派生(不依赖 skillExecutor)。
 */

import React, { useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import {
  createHelpCommandsSection,
  createHelpToolsSection,
  createHelpSkillsSection,
  createHelpLocalCommandsSection,
} from '@core/shared/command-handlers.js';
import { getCommandManager } from '@core/shared/command-manager.js';
import { getKeymapRegistry, type KeyCombo } from '../keymap/index.js';
import { ScrollableBox, useScroll } from './ScrollableBox.js';

// ============================================================
// 常量(visual tokens)
// ============================================================

/** 段标题前缀(`▎` + 空格) */
const SECTION_PREFIX = '▎ ';

/** 列表项符号(`▸` + 空格) */
const BULLET = '▸ ';

/** Banner 阈值:终端宽 >= 此值显示 double border */
const BANNER_BORDER_THRESHOLD = 100;

// ============================================================
// 纯函数(可独立单测)
// ============================================================

/**
 * 计算段间分隔线
 *
 * @param width - 终端宽度
 * @returns 分隔线字符串(最多 80 字符)
 */
export function sectionSeparator(width: number): string {
  return '─'.repeat(Math.max(8, Math.min(40, width - 4)));
}

/**
 * 决定是否使用 banner 框
 *
 * @param width - 终端宽度
 */
export function shouldRenderBanner(width: number): boolean {
  return width >= BANNER_BORDER_THRESHOLD;
}

/**
 * 构建顶部 banner 内容
 *
 * @returns 包含两行(border 上 + 标题 + border 下)的 Ink 行集合
 */
export function buildBannerContent(): string[] {
  return [
    '╔════════════════════════════════════════╗',
    '║         ⛓  WASTELAND  MANUAL  ⛓          ║',
    '╚════════════════════════════════════════╝',
  ];
}

/**
 * 格式化单个按键组合为可读文本（纯函数，可单测）。
 *
 * - rawInput `\x1b[Z` → `Shift+Tab`（key-matcher 对 shift+tab 的编码）；
 * - 其余按 修饰键+主键 拼接，方向键用箭头字形。
 */
export function formatKeyCombo(combo: KeyCombo): string {
  if (combo.rawInput === '\x1b[Z') return 'Shift+Tab';
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Alt');
  const keyName = combo.key ?? '';
  const keyMap: Record<string, string> = {
    return: 'Enter',
    escape: 'Esc',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Del',
    upArrow: '↑',
    downArrow: '↓',
    leftArrow: '←',
    rightArrow: '→',
    home: 'Home',
    end: 'End',
    pageUp: 'PageUp',
    pageDown: 'PageDown',
    space: 'Space',
  };
  const display = keyMap[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase() : keyName);
  if (display) parts.push(display);
  return parts.join('+');
}

/**
 * 从 keymap 注册表构建快捷键节（单一来源，不硬编码键位）。
 *
 * 注册表未覆盖的手工键（Tab 焦点循环、Ctrl+O 检查器、Alt+数字直达、
 * PageUp/Down 翻页、/ 补全）追加在后，描述走 i18n（`skills.help.shortcut*`）。
 */
export function buildShortcutsSection(): string[] {
  const lines: string[] = [];
  for (const entry of getKeymapRegistry().getAll()) {
    const combos = entry.combos.map(formatKeyCombo).filter((c) => c.length > 0).join(' / ');
    lines.push(`- \`${combos}\` - ${entry.description}`);
  }
  lines.push(`- \`Tab\` - ${t('skills.help.shortcutFocusTab')}`);
  lines.push(`- \`Ctrl+O\` - ${t('skills.help.shortcutInspector')}`);
  lines.push(`- \`Alt+1~9\` - ${t('skills.help.shortcutTabDirect')}`);
  lines.push(`- \`PageUp/PageDown\` - ${t('skills.help.shortcutScroll')}`);
  lines.push(`- \`/\` - ${t('skills.help.shortcutCompletion')}`);
  lines.push(`- \`Ctrl+T\` - ${t('skills.help.shortcutDetails')}`);
  return lines;
}

/**
 * 从 getCommandManager 提取 skills 段文本
 *
 * 按 category 'skill' 过滤;每项展示 `name + aliases + 描述`。
 *
 * @returns skills 列表行
 */
export function buildSkillsSection(): string[] {
  const manager = getCommandManager();
  const skills = manager.getByCategory('skill');
  if (skills.length === 0) {
    return createHelpSkillsSection('');
  }
  const lines: string[] = ['Available skills:'];
  for (const entry of skills) {
    const aliases =
      entry.aliases.length > 0
        ? ` (${entry.aliases.map((a) => `${a}`).join(', ')})`
        : '';
    const desc = t(entry.description);
    lines.push(`  ${entry.name}${aliases} - ${desc}`);
  }
  return lines;
}

// ============================================================
// 组件
// ============================================================

/**
 * HelpCommandsView - /help 命令 dialog
 */
export function HelpCommandsView(): React.ReactElement {
  const { state } = useAppContext();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 24;

  // 5 段内容(由 command-handlers 拆出的纯函数 + keymap 注册表生成)
  const commandsLines = useMemo(() => createHelpCommandsSection(), []);
  const toolsLines = useMemo(() => createHelpToolsSection(), []);
  const skillsLines = useMemo(() => buildSkillsSection(), []);
  const localLines = useMemo(() => createHelpLocalCommandsSection(), []);
  const shortcutsLines = useMemo(() => buildShortcutsSection(), []);

  const sep = sectionSeparator(width);
  const showBanner = shouldRenderBanner(width);

  // 计算总行数用于滚动
  const totalLines = useMemo(() => {
    return (
      commandsLines.length +
      toolsLines.length +
      skillsLines.length +
      localLines.length +
      shortcutsLines.length +
      10 // 分隔符和其他开销
    );
  }, [commandsLines, toolsLines, skillsLines, localLines, shortcutsLines]);

  // 滚动支持
  const scroll = useScroll({
    totalItems: totalLines,
    itemHeight: 1,
    height: height - 4, // 减去 header 和 footer 开销
  });

  // 键盘导航
  useInput((input, key) => {
    if (key.pageUp) {
      scroll.scrollUp();
      return;
    }
    if (key.pageDown) {
      scroll.scrollDown();
      return;
    }
    if (key.home) {
      scroll.scrollToTop();
      return;
    }
    if (key.end) {
      scroll.scrollToBottom();
      return;
    }
  });

  // 5 段渲染器:每段标题 + 列表(▸ 替代 -)
  const renderSection = (
    title: string,
    lines: ReadonlyArray<string>
  ): React.ReactElement[] => {
    const out: React.ReactElement[] = [];
    out.push(
      <Text key={`${title}-title`} color={wastelandTheme.colors.primary} bold>
        {SECTION_PREFIX}
        {title}
      </Text>
    );
    for (const line of lines) {
      // 跳过空行
      if (line.trim() === '') continue;
      // 列表项符号替换:把 '-' 替换为 '▸ '(只替换行首)
      const normalized = line.replace(/^\s*-\s*/, BULLET);
      out.push(
        <Text key={`${title}-${out.length}`} color={wastelandTheme.colors.text}>
          {'  '}
          {normalized}
        </Text>
      );
    }
    return out;
  };

  const sessionId = state.sessionMetadata.id;
  const workdir = state.fullConfig.sources?.project ?? '~';
  const description = t('skills.help.description');

  // 顶部 banner / 简洁标题
  const headerBlock = showBanner ? (
    <Box flexDirection="column" borderStyle="double" borderColor={wastelandTheme.colors.primary} paddingX={2} marginBottom={1}>
      {buildBannerContent().map((line, i) => (
        <Text key={`banner-${i}`} color={wastelandTheme.colors.primary} bold>
          {line}
        </Text>
      ))}
    </Box>
  ) : (
    <Box marginBottom={1}>
      <Text color={wastelandTheme.colors.primary} bold>
        ⛓ {t('skills.help.title')} ⛓
      </Text>
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {headerBlock}

      <Text color={wastelandTheme.colors.muted}>{description}</Text>
      <Text> </Text>

      <ScrollableBox
        offset={scroll.offset}
        onOffsetChange={scroll.setOffset}
        totalItems={totalLines}
        itemHeight={1}
      >
        <Box flexDirection="column">
          {renderSection(t('skills.help.commands'), commandsLines)}
        </Box>
        <Text color={wastelandTheme.colors.borderDim}>{sep}</Text>

        <Box flexDirection="column">
          {renderSection(t('skills.help.builtInTools'), toolsLines)}
        </Box>
        <Text color={wastelandTheme.colors.borderDim}>{sep}</Text>

        <Box flexDirection="column">
          {renderSection(t('skills.help.skillSystem'), skillsLines)}
        </Box>
        <Text color={wastelandTheme.colors.borderDim}>{sep}</Text>

        <Box flexDirection="column">
          {renderSection(t('skills.help.localCommands.title'), localLines)}
        </Box>
        <Text color={wastelandTheme.colors.borderDim}>{sep}</Text>

        <Box flexDirection="column">
          {renderSection(t('skills.help.shortcuts'), shortcutsLines)}
        </Box>
      </ScrollableBox>

      <Text> </Text>
      <Text color={wastelandTheme.colors.muted}>
        {t('skills.help.currentSession')}{' '}
        <Text color={wastelandTheme.colors.text}>{sessionId}</Text>
        {'  '}
        {t('skills.help.workDir')}{' '}
        <Text color={wastelandTheme.colors.text}>{workdir}</Text>
      </Text>
      <Text> </Text>
      <Text color={wastelandTheme.colors.muted}>{t('tui.help.commands.closeHint')}</Text>
    </Box>
  );
}
