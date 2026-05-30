/**
 * ExitConfirm - 退出确认提示
 *
 * 使用主题系统颜色的退出确认模态框
 */

import React from 'react';
import { Text, Box } from 'ink';
import { PRIMARY, SUCCESS, ERROR, BORDER } from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

interface ExitConfirmProps {
  width?: number;
}

export function ExitConfirm({ width }: ExitConfirmProps): React.ReactElement {
  const modalWidth = width ? Math.min(width - 4, 40) : 40;

  return (
    <Box
      flexDirection="column"
      width={modalWidth}
      borderStyle="double"
      borderColor={PRIMARY}
      paddingX={2}
      paddingY={1}
    >
      {/* 警告图标和消息 */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={PRIMARY}>
          ⚠ {t('tui.exit.title')}
        </Text>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text dimColor color={BORDER}>
          {'─'.repeat(modalWidth - 6)}
        </Text>
      </Box>

      {/* 确认提示 */}
      <Box justifyContent="center">
        <Text>
          {t('tui.exit.pressY')}{' '}
          <Text bold color={SUCCESS}>
            y
          </Text>{' '}
          {t('tui.exit.toConfirm')}
        </Text>
      </Box>
      <Box justifyContent="center">
        <Text>
          {t('tui.exit.cancel')}{' '}
          <Text bold color={ERROR}>
            n
          </Text>
        </Text>
      </Box>
    </Box>
  );
}
