/**
 * wizard/role-steps.tsx - 角色绑定与确认步骤组件
 *
 * 角色分配 / A2A 生态选择 / 汇总确认。
 * 纯搬运自 `InitWizard.tsx`，零逻辑改动。
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { t } from '@locales/index.js';
import type { WizardProviderConfig, WizardRoleBinding } from '@config/config-writer.js';
import { ACP_PRESETS } from '@config/acp-presets.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { SubAgentStrategy } from './types.js';

export function AssignRoleStep({
  title,
  hint,
  providers,
  currentBinding,
  onConfirm,
  onBack,
}: {
  title: string;
  hint?: string;
  providers: WizardProviderConfig[];
  currentBinding: WizardRoleBinding;
  onConfirm: (binding: WizardRoleBinding) => void;
  onBack: () => void;
}): React.ReactElement {
  const initialProviderIndex = Math.max(
    0,
    providers.findIndex((p) => p.name === currentBinding.providerName)
  );
  const [providerIdx, setProviderIdx] = useState(initialProviderIndex);
  const selectedProvider = providers[providerIdx] ?? providers[0];
  const [modelInput, setModelInput] = useState(
    currentBinding.modelId || selectedProvider?.defaultModel || ''
  );
  const [isEditingModel, setIsEditingModel] = useState(providers.length === 1);

  useInput((inputChar, key) => {
    if (!isEditingModel) {
      if (providers.length > 1) {
        if (key.upArrow) {
          const next = (providerIdx - 1 + providers.length) % providers.length;
          setProviderIdx(next);
          setModelInput(providers[next].defaultModel);
          return;
        }
        if (key.downArrow) {
          const next = (providerIdx + 1) % providers.length;
          setProviderIdx(next);
          setModelInput(providers[next].defaultModel);
          return;
        }
      }
      if (key.return) {
        setIsEditingModel(true);
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
    } else {
      if (key.return) {
        if (modelInput.trim().length > 0) {
          onConfirm({
            providerName: selectedProvider.name,
            modelId: modelInput.trim(),
          });
        }
        return;
      }
      if (key.escape) {
        if (providers.length > 1) {
          setIsEditingModel(false);
        } else {
          onBack();
        }
        return;
      }
      if (key.backspace || key.delete) {
        setModelInput(modelInput.slice(0, -1));
        return;
      }
      if (inputChar && !key.ctrl && !key.meta && inputChar !== '\r' && inputChar !== '\n') {
        setModelInput(modelInput + inputChar);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {hint && <Text color={wastelandTheme.colors.muted}>{hint}</Text>}

      {providers.length > 1 && !isEditingModel && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={wastelandTheme.colors.muted}>选择供应商平台：</Text>
          {providers.map((p, idx) => {
            const selected = idx === providerIdx;
            return (
              <Text key={p.name} color={selected ? wastelandTheme.colors.primary : undefined}>
                {selected ? '▶ ' : '  '}
                {p.name} ({p.defaultModel})
              </Text>
            );
          })}
          <Box marginTop={1}>
            <Text color={wastelandTheme.colors.muted}>按 Enter 确认平台并微调模型名称</Text>
          </Box>
        </Box>
      )}

      {(providers.length === 1 || isEditingModel) && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={wastelandTheme.colors.secondary}>
            已选平台: {selectedProvider.name} (协议: {selectedProvider.type})
          </Text>
          <Box marginTop={1}>
            <Text color={wastelandTheme.colors.primary}>
              模型 ID: {'> '}
              <Text color={undefined}>{modelInput}</Text>
              <Text color={wastelandTheme.colors.muted}>█</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={wastelandTheme.colors.muted}>按 Enter 确认此角色配置 · 按 Esc 返回</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function AcpStep({
  selectedPresetIds,
  onConfirm,
  onBack,
}: {
  selectedPresetIds: string[];
  onConfirm: (selected: string[]) => void;
  onBack: () => void;
}): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string[]>(selectedPresetIds);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((prev) => (prev > 0 ? prev - 1 : ACP_PRESETS.length - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((prev) => (prev < ACP_PRESETS.length - 1 ? prev + 1 : 0));
      return;
    }
    if (input === ' ') {
      const current = ACP_PRESETS[cursor];
      if (current) {
        setSelected((prev) =>
          prev.includes(current.id)
            ? prev.filter((id) => id !== current.id)
            : [...prev, current.id]
        );
      }
      return;
    }
    if (key.return) {
      onConfirm(selected);
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={wastelandTheme.colors.primary}>
        {t('commands.init.wizard.acp.title')}
      </Text>
      <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.acp.hint')}</Text>

      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="single"
        borderColor={wastelandTheme.colors.border}
        paddingX={1}
      >
        {ACP_PRESETS.map((preset, index) => {
          const isFocused = index === cursor;
          const isChecked = selected.includes(preset.id);
          return (
            <Box key={preset.id} flexDirection="column" marginY={0}>
              <Box flexDirection="row">
                <Text color={isFocused ? wastelandTheme.colors.primary : wastelandTheme.colors.text}>
                  {isFocused ? '❯ ' : '  '}
                  {isChecked ? '[x] ' : '[ ] '}
                  {preset.label}
                </Text>
                <Text color={wastelandTheme.colors.muted}>
                  {` (${preset.toAgentConfig().command} ${preset.toAgentConfig().args?.join(' ') ?? ''})`}
                </Text>
              </Box>
              {isFocused && (
                <Box marginLeft={6}>
                  <Text color={wastelandTheme.colors.muted}>{preset.description}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.acp.controls')}</Text>
      </Box>
    </Box>
  );
}

export function MultiAgentConfirmStep({
  language,
  mode,
  providers,
  mainAgent,
  subStrategy,
  unifiedSubAgent,
  roleBindings,
  enabledAcpPresetIds,
  onSubmit,
  onBack,
}: {
  language: 'zh' | 'en';
  mode: 'multi' | 'single';
  providers: WizardProviderConfig[];
  mainAgent: WizardRoleBinding;
  subStrategy: SubAgentStrategy;
  unifiedSubAgent: WizardRoleBinding;
  roleBindings: {
    developer: WizardRoleBinding;
    researcher: WizardRoleBinding;
    tester: WizardRoleBinding;
    analyst: WizardRoleBinding;
  };
  enabledAcpPresetIds: string[];
  onSubmit: () => void;
  onBack: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.escape) {
      onBack();
    }
  });

  const subAgentSummary =
    subStrategy === 'inherit_main'
      ? `完全复用主脑 (${mainAgent.providerName} -> ${mainAgent.modelId})`
      : subStrategy === 'unified'
        ? `统一工人模型 (${unifiedSubAgent.providerName} -> ${unifiedSubAgent.modelId})`
        : `工种定制 [Dev: ${roleBindings.developer.modelId}, Res: ${roleBindings.researcher.modelId}, Test: ${roleBindings.tester.modelId}, Ana: ${roleBindings.analyst.modelId}]`;

  return (
    <Box flexDirection="column">
      <Text bold color={wastelandTheme.colors.primary}>
        {t('commands.init.wizard.confirm.title')}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text color={wastelandTheme.colors.muted}>• {t('commands.init.wizard.confirm.language')}: </Text>
          <Text color={undefined}>{language === 'zh' ? '简体中文 (zh)' : 'English (en)'}</Text>
        </Text>
        <Text>
          <Text color={wastelandTheme.colors.muted}>• {t('commands.init.wizard.confirm.mode')}: </Text>
          <Text color={undefined}>{mode === 'multi' ? '多 Agent 协同模式 (multi)' : '单 Agent 模式 (single)'}</Text>
        </Text>
        <Text>
          <Text color={wastelandTheme.colors.muted}>• {t('commands.init.wizard.confirm.providersCount')}: </Text>
          <Text color={undefined}>{providers.map((p) => p.name).join(', ')} ({providers.length} 个)</Text>
        </Text>
        <Text>
          <Text color={wastelandTheme.colors.muted}>• {t('commands.init.wizard.confirm.mainAgent')}: </Text>
          <Text bold color={wastelandTheme.colors.primary}>
            {`${mainAgent.providerName} -> ${mainAgent.modelId}`}
          </Text>
        </Text>
        <Text>
          <Text color={wastelandTheme.colors.muted}>• {t('commands.init.wizard.confirm.subAgent')}: </Text>
          <Text color={undefined}>{subAgentSummary}</Text>
        </Text>
        <Text>
          <Text color={wastelandTheme.colors.muted}>• {t('commands.init.wizard.confirm.acp')}: </Text>
          <Text color={enabledAcpPresetIds.length > 0 ? wastelandTheme.colors.secondary : undefined}>
            {enabledAcpPresetIds.length > 0
              ? enabledAcpPresetIds
                  .map((id) => ACP_PRESETS.find((item) => item.id === id)?.label ?? id)
                  .join(', ')
              : t('commands.init.wizard.confirm.acpNone')}
          </Text>
        </Text>
      </Box>

      {/* 默认启用的人设与皮肤配置系统提示 */}
      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="single"
        borderColor={wastelandTheme.colors.border}
        paddingX={1}
      >
        <Text bold color={wastelandTheme.colors.secondary}>
          {`[${t('commands.init.wizard.confirm.personas')}]`}
        </Text>
        <Text color={wastelandTheme.colors.muted}>
          {t('commands.init.wizard.confirm.personasHint')}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text color={wastelandTheme.colors.primary}>  • {t('commands.init.wizard.confirm.mainPersona')}</Text>
          <Text color={wastelandTheme.colors.secondary}>  • {t('commands.init.wizard.confirm.vanguardPersona')}</Text>
          <Text color={wastelandTheme.colors.muted}>  • {t('commands.init.wizard.confirm.devPersona')}</Text>
          <Text color={wastelandTheme.colors.muted}>  • {t('commands.init.wizard.confirm.resPersona')}</Text>
          <Text color={wastelandTheme.colors.muted}>  • {t('commands.init.wizard.confirm.testPersona')}</Text>
          <Text color={wastelandTheme.colors.muted}>  • {t('commands.init.wizard.confirm.anaPersona')}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text bold color={wastelandTheme.colors.primary}>
          {t('commands.init.wizard.confirm.enterToSubmit')}
        </Text>
      </Box>
    </Box>
  );
}
