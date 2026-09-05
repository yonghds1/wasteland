/**
 * ExitConfirm - 退出确认 dialog
 *
 * 由 `/exit` 命令或 Ctrl+C 触发（设置 `state.exitConfirmPending = true`）。
 * 显示 "Press y to confirm exit" 提示，让用户二次确认。
 *
 * ## 交互
 *
 * - `y`: 确认退出（由 App.tsx 的 useInput 监听 + 调用 exit()）
 * - 其它任意键: 取消（App.tsx 重置 exitConfirmPending = false）
 * - Esc: 同上（取消）
 *
 * 视觉：黄色提示 + 反白 `y` 键名 + 暗淡的取消说明。
 */

import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';

export function ExitConfirm(): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      borderStyle={wastelandTheme.decorations.borderStyle}
      borderColor={wastelandTheme.colors.warning}
      paddingX={2}
      paddingY={1}
      justifyContent="center"
    >
      <Text color={wastelandTheme.colors.warning} bold>
        {t('tui.exit.title')}
      </Text>
      <Text color={wastelandTheme.colors.muted}>
        {'  '}
        {t('tui.exit.pressY')}{' '}
      </Text>
      <Text color={wastelandTheme.colors.warning} bold>
        y
      </Text>
      <Text color={wastelandTheme.colors.muted}>
        {' '}
        {t('tui.exit.toConfirm')}
        {'  '}
        {t('tui.exit.cancel')}
      </Text>
    </Box>
  );
}