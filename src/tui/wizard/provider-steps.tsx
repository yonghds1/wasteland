/**
 * wizard/provider-steps.tsx - Provider 配置步骤组件
 *
 * 模型拉取 / 模型选择或输入 / Provider 循环确认。
 * 纯搬运自 `InitWizard.tsx`，零逻辑改动。
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { t } from '@locales/index.js';
import type { WizardProviderConfig } from '@config/config-writer.js';
import { fetchRemoteModels } from '@providers/fetch-models.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { validateModelId } from './validation.js';
import { SelectStep, TextInputStep } from './input-steps.js';

export function FetchingModelsStep({
  providerName,
  baseUrl,
  apiKey,
  onComplete,
}: {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  onComplete: (models: string[]) => void;
}): React.ReactElement {
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetchRemoteModels({
        baseUrl,
        apiKey,
        timeoutMs: 4000,
      });
      if (!cancelled) {
        onComplete(res.success ? res.models : []);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, apiKey, onComplete]);

  return (
    <Box flexDirection="column">
      <Text color={wastelandTheme.colors.primary} bold>
        ⟳ {t('commands.init.wizard.provider.fetchingModels', { provider: providerName })}
      </Text>
      <Text color={wastelandTheme.colors.muted}>
        端点: {baseUrl}
      </Text>
    </Box>
  );
}

export function ModelSelectOrInputStep({
  providerName,
  availableModels,
  value,
  onChange,
  onSubmit,
  onBack,
}: {
  providerName: string;
  availableModels: string[];
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  onBack: () => void;
}): React.ReactElement {
  const hasModels = availableModels.length > 0;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isManualInput, setIsManualInput] = useState(!hasModels);
  const manualOptionLabel = t('commands.init.wizard.provider.manualModelOption');
  const allOptions = [...availableModels, manualOptionLabel];

  if (!isManualInput && hasModels) {
    return (
      <SelectStep
        title={t('commands.init.wizard.provider.modelLabel', { provider: providerName })}
        hint={t('commands.init.wizard.provider.modelSelectHint', {
          count: String(availableModels.length),
        })}
        options={allOptions}
        selectedIndex={selectedIndex}
        onIndexChange={setSelectedIndex}
        onSubmit={() => {
          if (selectedIndex === availableModels.length) {
            onChange('');
            setIsManualInput(true);
          } else {
            onSubmit(availableModels[selectedIndex]);
          }
        }}
        onBack={onBack}
      />
    );
  }

  return (
    <TextInputStep
      label={t('commands.init.wizard.provider.modelLabel', { provider: providerName })}
      hint={
        hasModels
          ? t('commands.init.wizard.provider.modelHint')
          : t('commands.init.wizard.provider.modelEmptyHint')
      }
      value={value}
      onChange={onChange}
      validate={validateModelId}
      onSubmit={() => onSubmit(value)}
      onBack={() => {
        if (hasModels) {
          setIsManualInput(false);
        } else {
          onBack();
        }
      }}
    />
  );
}

export function ProviderLoopStep({
  providers,
  onDone,
  onAddMore,
  onBack,
}: {
  providers: WizardProviderConfig[];
  onDone: () => void;
  onAddMore: () => void;
  onBack: () => void;
}): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = [
    t('commands.init.wizard.provider.loopDone'),
    t('commands.init.wizard.provider.loopAddMore'),
  ];

  useInput((_input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelectedIndex((selectedIndex + 1) % options.length);
    } else if (key.return) {
      if (selectedIndex === 0) {
        onDone();
      } else {
        onAddMore();
      }
    } else if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={wastelandTheme.colors.primary}>
        {t('commands.init.wizard.provider.loopTitle', { count: String(providers.length) })}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {providers.map((p) => (
          <Text key={p.name} color={wastelandTheme.colors.secondary}>
            {`  • ${p.name} (协议: ${p.type}, 端点: ${p.baseUrl}, 默认模型: ${p.defaultModel})`}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.provider.loopHint')}</Text>
        <Box flexDirection="column" marginTop={1}>
          {options.map((opt, idx) => {
            const selected = idx === selectedIndex;
            return (
              <Text key={opt} color={selected ? wastelandTheme.colors.primary : undefined} bold={selected}>
                {selected ? '▶ ' : '  '}
                {opt}
              </Text>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
