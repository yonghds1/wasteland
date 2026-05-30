/**
 * HelpModal - 帮助弹窗
 *
 * 显示所有快捷键帮助信息
 */

import React from 'react';
import { Text, Box } from 'ink';
import { PRIMARY, SUCCESS, WARNING, SECONDARY, INFO, MUTED } from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

interface HelpModalProps {
  width?: number;
}

export function HelpModal({ width }: HelpModalProps): React.ReactElement {
  const modalWidth = width ? Math.min(width - 4, 60) : 60;

  return (
    <Box
      flexDirection="column"
      width={modalWidth}
      borderStyle="double"
      borderColor={PRIMARY}
      paddingX={2}
      paddingY={1}
    >
      {/* 标题 */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={PRIMARY}>
          {t('tui.help.title')}
        </Text>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(modalWidth - 6)}</Text>
      </Box>

      {/* 导航模式 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={SUCCESS}>
          {t('tui.help.navMode')}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>h</Text> {t('tui.help.actions.showHelp')}
          </Text>
          <Text>
            <Text bold>q</Text> {t('tui.help.actions.exit')}
          </Text>
          <Text>
            <Text bold>Tab</Text> / <Text bold>Shift+Tab</Text> {t('tui.help.actions.switchPage')}
          </Text>
          <Text>
            <Text bold>Enter</Text> {t('tui.help.actions.enterInput')}
          </Text>
          <Text>
            <Text bold>↑/↓</Text> {t('tui.help.actions.scroll')}
          </Text>
        </Box>
      </Box>

      {/* 输入模式 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={WARNING}>
          {t('tui.help.actions.inputMode')}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>Esc</Text> {t('tui.help.actions.cancelInput')}
          </Text>
          <Text>
            <Text bold>Enter</Text> {t('tui.help.actions.sendMessage')}
          </Text>
          <Text>
            <Text bold>Ctrl+C</Text> {t('tui.help.actions.globalExit')}
          </Text>
        </Box>
      </Box>

      {/* 页面特定快捷键 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={SECONDARY}>
          {t('tui.help.actions.sessionPage')}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>↑/↓</Text> {t('tui.help.actions.scrollMessages')}
          </Text>
          <Text>
            <Text bold>Enter</Text> {t('tui.help.actions.enterInputMode')}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={INFO}>
          {t('tui.help.actions.debugPage')}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>f</Text> {t('tui.help.actions.enterFilter')}
          </Text>
          <Text>
            <Text bold>c</Text> {t('tui.help.actions.clearLogs')}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={MUTED}>
          {t('tui.help.actions.configPage')}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>↑/↓</Text> {t('tui.help.actions.switchConfig')}
          </Text>
          <Text>
            <Text bold>Enter</Text> {t('tui.help.actions.enterEdit')}
          </Text>
          <Text>
            <Text bold>Ctrl+S</Text> {t('tui.help.actions.saveConfig')}
          </Text>
          <Text>
            <Text bold>Ctrl+R</Text> {t('tui.help.actions.resetConfig')}
          </Text>
        </Box>
      </Box>

      {/* 关闭提示 */}
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>{t('tui.help.closeHint')}</Text>
      </Box>
    </Box>
  );
}
