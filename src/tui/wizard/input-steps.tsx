/**
 * wizard/input-steps.tsx - 通用输入步骤组件
 *
 * 选项选择（SelectStep）与文本输入（TextInputStep）两个无业务依赖的通用组件，
 * 被 provider / role 等步骤复用。纯搬运自 `InitWizard.tsx`，零逻辑改动。
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';

export function SelectStep({
  title,
  hint,
  options,
  selectedIndex,
  onIndexChange,
  onSubmit,
  onBack,
}: {
  title: string;
  hint?: string;
  options: string[];
  selectedIndex: number;
  onIndexChange: (i: number) => void;
  onSubmit: () => void;
  onBack?: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.upArrow) {
      onIndexChange((selectedIndex - 1 + options.length) % options.length);
    } else if (key.downArrow) {
      onIndexChange((selectedIndex + 1) % options.length);
    } else if (key.return) {
      onSubmit();
    } else if (key.escape && onBack) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {hint && <Text color={wastelandTheme.colors.muted}>{hint}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, index) => {
          const selected = index === selectedIndex;
          const symbol = selected ? '▶' : ' ';
          return (
            <Text key={opt} color={selected ? wastelandTheme.colors.primary : undefined}>
              {`${symbol} ${opt}`}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

export function TextInputStep({
  label,
  hint,
  value,
  onChange,
  masked = false,
  allowMaskToggle = false,
  validate,
  onSubmit,
  onBack,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  masked?: boolean;
  allowMaskToggle?: boolean;
  validate?: (v: string) => string | null;
  onSubmit: () => void;
  onBack?: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [isMasked, setIsMasked] = useState(masked);

  useInput((inputChar, key) => {
    if (key.tab && allowMaskToggle) {
      setIsMasked(!isMasked);
      return;
    }
    if (key.return) {
      const validationError = validate ? validate(value) : null;
      if (validationError) {
        setError(validationError);
        return;
      }
      setError(null);
      onSubmit();
      return;
    }
    if (key.escape) {
      if (onBack) {
        onBack();
      } else {
        onChange('');
        setError(null);
      }
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      setError(null);
      return;
    }
    if (inputChar && !key.ctrl && !key.meta && inputChar !== '\r' && inputChar !== '\n') {
      onChange(value + inputChar);
      setError(null);
    }
  });

  const display = isMasked ? '*'.repeat(value.length) : value;

  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      {hint && <Text color={wastelandTheme.colors.muted}>{hint}</Text>}
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.primary}>
          {'> '}
          <Text color={undefined}>{display}</Text>
          <Text color={wastelandTheme.colors.muted}>█</Text>
        </Text>
      </Box>
      {allowMaskToggle && (
        <Text color={wastelandTheme.colors.muted}>
          {t('commands.init.wizard.provider.tabMaskHint')}
        </Text>
      )}
      {error && (
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.error}>{error}</Text>
        </Box>
      )}
    </Box>
  );
}
