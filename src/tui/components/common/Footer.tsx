/**
 * Footer - 底部状态栏
 *
 * 参考 OpenCode 的设计：
 * - 左侧：快捷键提示
 * - 中间：页面特定提示
 * - 右侧：模型信息、Token 用量
 */

import React from 'react';
import { Text, Box } from 'ink';
import { useAppContext } from '../../context/AppContext.js';
import {
  PRIMARY,
  SECONDARY,
  SUCCESS,
  WARNING,
  MUTED,
  BORDER_DIM,
  SEPARATORS,
} from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

interface FooterProps {
  width?: number;
}

export function Footer({ width }: FooterProps): React.ReactElement {
  const { state } = useAppContext();

  // 根据模式返回不同的帮助文本
  const getModeHelp = () => {
    if (state.inputMode) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color={SECONDARY}>
            {t('tui.footer.inputMode')}
          </Text>
          <Text dimColor>{t('tui.footer.escCancel')}</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={SUCCESS}>{t('tui.footer.enterSend')}</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>{t('tui.footer.ctrlCExit')}</Text>
        </Box>
      );
    }

    if (state.filterMode) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color={SECONDARY}>
            {t('tui.footer.filterMode')}
          </Text>
          <Text dimColor>{t('tui.footer.tabSwitchField')}</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>{t('tui.footer.arrowSwitchValue')}</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>{t('tui.footer.escClose')}</Text>
        </Box>
      );
    }

    if (state.editMode) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color={SECONDARY}>
            {t('tui.footer.editMode')}
          </Text>
          <Text color={SUCCESS}>{t('tui.footer.enterConfirm')}</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>{t('tui.footer.escCancel')}</Text>
        </Box>
      );
    }

    if (state.exitConfirmPending) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color="red">
            {t('tui.footer.exitConfirm')}
          </Text>
          <Text color={SUCCESS}>{t('tui.footer.yConfirmExit')}</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>{t('tui.footer.nCancel')}</Text>
        </Box>
      );
    }

    if (state.showHelp) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color="cyan">
            {t('tui.footer.helpMode')}
          </Text>
          <Text color={WARNING}>{t('tui.footer.hOrEscClose')}</Text>
        </Box>
      );
    }

    // 导航模式 - 显示默认快捷键
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={PRIMARY}>h</Text>
        <Text dimColor>{t('tui.footer.help')}</Text>
        <Text dimColor>{SEPARATORS.item.trim()}</Text>
        <Text color={PRIMARY}>Tab</Text>
        <Text dimColor>{t('tui.footer.switchPage')}</Text>
        <Text dimColor>{SEPARATORS.item.trim()}</Text>
        <Text color={PRIMARY}>q</Text>
        <Text dimColor>{t('tui.footer.exit')}</Text>
      </Box>
    );
  };

  // 根据页面返回特定提示
  const getPageSpecificHelp = () => {
    if (
      state.inputMode ||
      state.filterMode ||
      state.editMode ||
      state.exitConfirmPending ||
      state.showHelp
    ) {
      return null;
    }

    switch (state.currentPage) {
      case 'session':
        return (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{t('tui.footer.scroll')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={SUCCESS}>{t('tui.footer.enterInput')}</Text>
          </Box>
        );
      case 'debug':
        return (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{t('tui.footer.scroll')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={PRIMARY}>Space</Text>
            <Text dimColor>{t('tui.footer.expand')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={PRIMARY}>f</Text>
            <Text dimColor>{t('tui.footer.filter')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={PRIMARY}>c</Text>
            <Text dimColor>{t('tui.footer.clear')}</Text>
          </Box>
        );
      case 'config':
        return (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{t('tui.footer.switch')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={PRIMARY}>Enter</Text>
            <Text dimColor>{t('tui.footer.edit')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={SUCCESS}>{t('tui.footer.saveProject')}</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color="cyan">{t('tui.footer.saveUser')}</Text>
          </Box>
        );
    }
  };

  // 获取页面名称
  const getPageName = () => {
    switch (state.currentPage) {
      case 'session':
        return t('tui.footer.sessionPage');
      case 'debug':
        return t('tui.footer.debugPage');
      case 'config':
        return t('tui.footer.guidePage');
    }
  };

  // 计算并行 Agent 数量
  const runningAgents = state.session.agents.filter((a) => a.status === 'running');
  const parallelAgentCount = runningAgents.length;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width={width}
      paddingX={1}
      borderStyle="single"
      borderTop
      borderColor={BORDER_DIM}
    >
      {/* 左侧：快捷键提示 */}
      <Box flexDirection="row">{getModeHelp()}</Box>

      {/* 右侧：并行状态 + 页面信息 + 模型 */}
      <Box flexDirection="row" gap={1}>
        {/* 并行 Agent 状态（如果有多个运行中的 Agent） */}
        {parallelAgentCount > 1 && (
          <>
            <Text color={SUCCESS}>⚡</Text>
            <Text color={SUCCESS}>
              {t('runtime.parallelAgentsRunning', {
                count: String(parallelAgentCount),
                names: runningAgents.map((a) => a.name).join(', '),
              })}
            </Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
          </>
        )}

        {/* 页面特定提示 */}
        {getPageSpecificHelp()}

        {/* 分隔符 */}
        <Text dimColor>{SEPARATORS.item.trim()}</Text>

        {/* 当前页面 */}
        <Text bold color={PRIMARY}>
          {getPageName()}
        </Text>

        {/* 分隔符 */}
        <Text dimColor>{SEPARATORS.vertical}</Text>

        {/* 模型信息（如果有） */}
        {state.sessionMetadata.providerId && (
          <Text color={MUTED}>
            {state.sessionMetadata.providerId}
          </Text>
        )}
      </Box>
    </Box>
  );
}
