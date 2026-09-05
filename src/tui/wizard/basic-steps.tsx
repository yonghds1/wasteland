/**
 * wizard/basic-steps.tsx - 基础步骤组件
 *
 * 语言选择 / 模式选择 / 完成 / 错误四个无依赖步骤。
 * 纯搬运自 `InitWizard.tsx`，零逻辑改动。
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';

export function LanguageSelectStep({
  currentLanguage,
  onSelect,
}: {
  currentLanguage: 'zh' | 'en';
  onSelect: (lang: 'zh' | 'en') => void;
}): React.ReactElement {
  const options: Array<{ lang: 'zh' | 'en'; label: string }> = [
    { lang: 'zh', label: '简体中文 (Chinese - zh)' },
    { lang: 'en', label: 'English (en)' },
  ];
  const [selectedIndex, setSelectedIndex] = useState(
    currentLanguage === 'en' ? 1 : 0
  );

  useInput((_input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelectedIndex((selectedIndex + 1) % options.length);
    } else if (key.return) {
      onSelect(options[selectedIndex].lang);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>选择语言 / Select Language</Text>
      <Text color={wastelandTheme.colors.muted}>
        请选择界面交互语言 / Please choose your preferred interface language
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, idx) => {
          const selected = idx === selectedIndex;
          return (
            <Text key={opt.lang} color={selected ? wastelandTheme.colors.primary : undefined} bold={selected}>
              {selected ? '▶ ' : '  '}
              {opt.label}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

export function ModeSelectStep({ onSubmit, onBack }: { onSubmit: () => void; onBack: () => void }): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{t('commands.init.wizard.mode.label')}</Text>
      <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.mode.hint')}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color={wastelandTheme.colors.primary} bold>
          ▶ ● {t('commands.init.wizard.mode.multi')}
        </Text>
        <Text color={wastelandTheme.colors.muted}>
          {'    '}(支持主脑规划、子 Agent 并发执行编码/搜索/测试任务)
        </Text>
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.muted}>
            {'  '}○ {t('commands.init.wizard.mode.single')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function DoneStep({
  settingsPath,
  authPath,
  skinsPath,
  rolesPath,
  onDismiss,
}: {
  settingsPath: string;
  authPath: string;
  skinsPath: string;
  rolesPath: string;
  onDismiss: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      onDismiss();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={wastelandTheme.colors.success}>
        {t('commands.init.wizard.done.title')}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>  {settingsPath}</Text>
        <Text color={wastelandTheme.colors.muted}>  {authPath}</Text>
        <Text color={wastelandTheme.colors.muted}>  {skinsPath}</Text>
        <Text color={wastelandTheme.colors.muted}>  {rolesPath}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.primary}>
          {t('commands.init.wizard.done.enterToContinue')}
        </Text>
      </Box>
    </Box>
  );
}

export function ErrorStep({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return || key.escape) {
      onDismiss();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={wastelandTheme.colors.error}>
        {t('commands.init.wizard.error.title')}
      </Text>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.error}>{message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>
          {t('commands.init.wizard.done.enterToContinue')}
        </Text>
      </Box>
    </Box>
  );
}
