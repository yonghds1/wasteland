/**
 * InitWizard - 首次运行多智能体配置向导 (业务状态解耦至 useWizardState)
 */

import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { t } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { PROVIDER_PRESETS } from './wizard/presets.js';
import type { InitWizardProps } from './wizard/types.js';
import { SUB_AGENT_STRATEGIES } from './wizard/types.js';
import { validateApiKey, validateBaseUrl, validateProviderName } from './wizard/validation.js';
import { DoneStep, ErrorStep, LanguageSelectStep, ModeSelectStep } from './wizard/basic-steps.js';
import { SelectStep, TextInputStep } from './wizard/input-steps.js';
import {
  FetchingModelsStep,
  ModelSelectOrInputStep,
  ProviderLoopStep,
} from './wizard/provider-steps.js';
import { AcpStep, AssignRoleStep, MultiAgentConfirmStep } from './wizard/role-steps.js';
import { useWizardState, type UseWizardStateReturn } from './wizard/useWizardState.js';

export type * from './wizard/types.js';
export { PROVIDER_PRESETS } from './wizard/presets.js';
export * from './wizard/validation.js';
export { useWizardState } from './wizard/useWizardState.js';

const ROLE_STEPS = {
  'assign-main': ['mainTitle', 'mainHint', 'mainAgentBinding'],
  'assign-sub-unified': ['unifiedSubTitle', 'unifiedSubHint', 'unifiedSubBinding'],
  'assign-sub-dev': ['devTitle', 'devHint', 'devBinding'],
  'assign-sub-res': ['resTitle', 'resHint', 'resBinding'],
  'assign-sub-test': ['testTitle', 'testHint', 'testBinding'],
  'assign-sub-ana': ['anaTitle', 'anaHint', 'anaBinding'],
} as const;

function renderStep(w: UseWizardStateReturn): React.ReactNode {
  const { state } = w;

  const roleCfg = ROLE_STEPS[state.step as keyof typeof ROLE_STEPS];
  if (roleCfg) {
    const [title, hint, key] = roleCfg;
    return (
      <AssignRoleStep
        title={t(`commands.init.wizard.assign.${title}`)}
        hint={t(`commands.init.wizard.assign.${hint}`)}
        providers={state.providers}
        currentBinding={state[key]}
        onConfirm={(b) => w.assignRole(key, b)}
        onBack={w.goPrev}
      />
    );
  }

  switch (state.step) {
    case 'language-select':
      return <LanguageSelectStep currentLanguage={state.language} onSelect={w.selectLanguage} />;
    case 'mode-select':
      return <ModeSelectStep onSubmit={w.goNext} onBack={w.goPrev} />;
    case 'provider-select':
      return (
        <SelectStep
          title={t('commands.init.wizard.provider.selectLabel')}
          hint={t('commands.init.wizard.provider.selectHint')}
          options={PROVIDER_PRESETS.map((p) => t(p.labelKey))}
          selectedIndex={state.currentPresetIndex}
          onIndexChange={w.selectPresetIndex}
          onSubmit={w.goNext}
          onBack={w.goPrev}
        />
      );
    case 'provider-custom-name':
    case 'provider-custom-base-url':
    case 'provider-api-key': {
      const isKey = state.step === 'provider-api-key';
      const isName = state.step === 'provider-custom-name';
      const label = isKey
        ? t('commands.init.wizard.provider.keyLabel', { provider: state.effectiveProviderName })
        : t(`commands.init.wizard.provider.${isName ? 'customNameLabel' : 'customBaseUrlLabel'}`);
      const hint = t(
        `commands.init.wizard.provider.${isKey ? 'keyHint' : isName ? 'customNameHint' : 'customBaseUrlHint'}`
      );
      const valKey = isKey ? 'tempApiKey' : isName ? 'tempCustomName' : 'tempCustomBaseUrl';
      const validator = isKey
        ? (v: string) => validateApiKey(v, !state.currentPreset.requiresApiKey)
        : isName
          ? validateProviderName
          : validateBaseUrl;
      return (
        <TextInputStep
          label={label}
          hint={hint}
          value={state[valKey]}
          onChange={(v) => w.updateField(valKey, v)}
          masked={isKey}
          allowMaskToggle={isKey}
          validate={validator}
          onSubmit={w.goNext}
          onBack={w.goPrev}
        />
      );
    }
    case 'provider-fetching-models':
      return (
        <FetchingModelsStep
          providerName={state.effectiveProviderName}
          baseUrl={state.effectiveBaseUrl}
          apiKey={state.tempApiKey}
          onComplete={w.handleModelsFetched}
        />
      );
    case 'provider-model':
      return (
        <ModelSelectOrInputStep
          providerName={state.effectiveProviderName}
          availableModels={state.availableModels}
          value={state.tempModelId}
          onChange={(val) => w.updateField('tempModelId', val)}
          onSubmit={w.commitCurrentProvider}
          onBack={w.goPrev}
        />
      );
    case 'provider-loop-confirm':
      return (
        <ProviderLoopStep
          providers={state.providers}
          onDone={w.goNext}
          onAddMore={w.addMoreProviders}
          onBack={w.goPrev}
        />
      );
    case 'subagent-strategy':
      return (
        <SelectStep
          title={t('commands.init.wizard.assign.subStrategyTitle')}
          hint={t('commands.init.wizard.assign.subStrategyHint')}
          options={['unifiedOption', 'inheritOption', 'roleByRoleOption'].map((k) =>
            t(`commands.init.wizard.assign.${k}`)
          )}
          selectedIndex={Math.max(0, SUB_AGENT_STRATEGIES.indexOf(state.subStrategy))}
          onIndexChange={(i) => w.updateField('subStrategy', SUB_AGENT_STRATEGIES[i])}
          onSubmit={w.goNext}
          onBack={w.goPrev}
        />
      );
    case 'acp':
      return (
        <AcpStep
          selectedPresetIds={state.enabledAcpPresetIds}
          onConfirm={w.confirmAcp}
          onBack={w.goPrev}
        />
      );
    case 'confirm':
      return <MultiAgentConfirmStep {...state} onBack={w.goPrev} onSubmit={w.submit} />;
    case 'submitting':
      return <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.writing')}</Text>;
    case 'done':
      return state.resultPaths && <DoneStep {...state.resultPaths} onDismiss={w.dismissDone} />;
    case 'error':
      return (
        state.errorMessage && <ErrorStep message={state.errorMessage} onDismiss={w.dismissError} />
      );
    default:
      return null;
  }
}

const BOX_STYLE = {
  flexDirection: 'column' as const,
  borderStyle: wastelandTheme.decorations.borderStyle,
  borderColor: wastelandTheme.colors.border,
  paddingX: 2,
  paddingY: 1,
};

export function InitWizard({ onComplete, writeConfig }: InitWizardProps): React.ReactElement {
  const { exit } = useApp();
  const wizard = useWizardState({ onComplete, writeConfig, exit });

  useInput((input, key) => {
    if (key.ctrl && input === 'c') wizard.cancel();
  });

  return (
    <Box {...BOX_STYLE}>
      <Text color={wastelandTheme.colors.primary} bold>
        {t('commands.init.wizard.title')}
      </Text>
      <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.subtitle')}</Text>
      <Box marginTop={1} flexDirection="column">
        {renderStep(wizard)}
      </Box>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.footer')}</Text>
      </Box>
    </Box>
  );
}
