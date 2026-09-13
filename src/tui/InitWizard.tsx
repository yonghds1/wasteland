/**
 * InitWizard - 首次运行多智能体配置向导
 *
 * 引导新用户从零完成多智能体协同配置：
 *   0. 界面语言选择 (Language: 简体中文 zh / English en)
 *   1. 运行模式选择 (Multi-Agent 默认推荐 / Single-Agent 暂未完备禁用)
 *   2. 供应商配置池 (支持配置多个 Provider，最少 1 个)
 *      - 预设供应商 (DeepSeek, OpenAI, Qwen, GLM, MiniMax, Ollama, OpenCode Zen, OpenCode Go) 携带官方默认 Base URL
 *      - 自定义供应商 (Custom) 提供 Provider 名称、API Base URL、API Key 输入
 *      - **动态拉取模型**：输入 Key 后自动连接服务端探测可用模型；成功则列出供选择，探测失败则默认留空由用户手动输入
 *   3. 智能体供应商与模型绑定：
 *      - 主 Agent (总控主脑) Provider & Model 绑定
 *      - 子 Agent 矩阵分配策略 (统一工人模型 / 复用主脑 / 4大工种精细化定制)
 *   4. 汇总确认与启航 (展示默认启用的主/子 Agent 角色人设皮肤，并提示支持自定义)
 */

import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { setLanguage, t } from '@locales/index.js';
import type {
  WizardProviderConfig,
  WizardRoleBinding,
} from '@config/config-writer.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { PROVIDER_PRESETS } from './wizard/presets.js';
import type { InitWizardProps, Step, SubAgentStrategy } from './wizard/types.js';
import {
  validateApiKey,
  validateBaseUrl,
  validateProviderName,
} from './wizard/validation.js';
import {
  DoneStep,
  ErrorStep,
  LanguageSelectStep,
  ModeSelectStep,
} from './wizard/basic-steps.js';
import { SelectStep, TextInputStep } from './wizard/input-steps.js';
import {
  FetchingModelsStep,
  ModelSelectOrInputStep,
  ProviderLoopStep,
} from './wizard/provider-steps.js';
import {
  AcpStep,
  AssignRoleStep,
  MultiAgentConfirmStep,
} from './wizard/role-steps.js';

// 对外兼容：类型 / 预设 / 校验器仍可从本入口导入（实现已拆至 ./wizard/*）。
export type {
  InitWizardInput,
  InitWizardResult,
  InitWizardProps,
  ProviderPreset,
  SubAgentStrategy,
  WizardProviderConfig,
  WizardRoleBinding,
} from './wizard/types.js';
export { PROVIDER_PRESETS } from './wizard/presets.js';
export {
  validateApiKey,
  validateBaseUrl,
  validateModelId,
  validateProviderName,
  validateSubAgentModelId,
} from './wizard/validation.js';

export function InitWizard({ onComplete, writeConfig }: InitWizardProps): React.ReactElement {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('language-select');

  // Step 0: Language
  const [language, setLanguageState] = useState<'zh' | 'en'>('zh');

  // Step 1: Mode
  const [mode] = useState<'multi' | 'single'>('multi');

  // Step 2: Configured Providers Pool
  const [providers, setProviders] = useState<WizardProviderConfig[]>([]);
  const [currentPresetIndex, setCurrentPresetIndex] = useState(0);
  const [tempCustomName, setTempCustomName] = useState('');
  const [tempCustomBaseUrl, setTempCustomBaseUrl] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [tempModelId, setTempModelId] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // Step 3: Role Assignments
  const [mainAgentBinding, setMainAgentBinding] = useState<WizardRoleBinding>({
    providerName: PROVIDER_PRESETS[0].name,
    modelId: '',
  });
  const [subStrategy, setSubStrategy] = useState<SubAgentStrategy>('unified');
  const [unifiedSubBinding, setUnifiedSubBinding] = useState<WizardRoleBinding>({
    providerName: PROVIDER_PRESETS[0].name,
    modelId: '',
  });
  const [devBinding, setDevBinding] = useState<WizardRoleBinding>({
    providerName: PROVIDER_PRESETS[0].name,
    modelId: '',
  });
  const [resBinding, setResBinding] = useState<WizardRoleBinding>({
    providerName: PROVIDER_PRESETS[0].name,
    modelId: '',
  });
  const [testBinding, setTestBinding] = useState<WizardRoleBinding>({
    providerName: PROVIDER_PRESETS[0].name,
    modelId: '',
  });
  const [anaBinding, setAnaBinding] = useState<WizardRoleBinding>({
    providerName: PROVIDER_PRESETS[0].name,
    modelId: '',
  });

  // Step 4: ACP Presets Selection
  const [enabledAcpPresetIds, setEnabledAcpPresetIds] = useState<string[]>([]);

  // Status
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultPaths, setResultPaths] = useState<{
    settingsPath: string;
    authPath: string;
    skinsPath: string;
    rolesPath: string;
  } | null>(null);

  const currentPreset = PROVIDER_PRESETS[currentPresetIndex];
  const isCustom = currentPreset.id === 'custom';
  const effectiveProviderName = isCustom ? tempCustomName.trim() : currentPreset.name;
  const effectiveBaseUrl = isCustom ? tempCustomBaseUrl.trim() : currentPreset.defaultBaseUrl;

  // Ctrl+C 全局取消
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      onComplete({ kind: 'cancelled' });
      exit();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle={wastelandTheme.decorations.borderStyle}
      borderColor={wastelandTheme.colors.border}
      paddingX={2}
      paddingY={1}
    >
      <Text color={wastelandTheme.colors.primary} bold>
        {t('commands.init.wizard.title')}
      </Text>
      <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.subtitle')}</Text>

      <Box marginTop={1} flexDirection="column">
        {/* Step 0: Language Select */}
        {step === 'language-select' && (
          <LanguageSelectStep
            currentLanguage={language}
            onSelect={(lang) => {
              setLanguage(lang);
              setLanguageState(lang);
              setStep('mode-select');
            }}
          />
        )}

        {/* Step 1: Mode Select */}
        {step === 'mode-select' && (
          <ModeSelectStep
            onSubmit={() => {
              setStep('provider-select');
            }}
            onBack={() => {
              setStep('language-select');
            }}
          />
        )}

        {/* Step 2-1: Select Provider to Add */}
        {step === 'provider-select' && (
          <SelectStep
            title={t('commands.init.wizard.provider.selectLabel')}
            hint={t('commands.init.wizard.provider.selectHint')}
            options={PROVIDER_PRESETS.map((p) => t(p.labelKey))}
            selectedIndex={currentPresetIndex}
            onIndexChange={(i) => {
              setCurrentPresetIndex(i);
              if (PROVIDER_PRESETS[i].id === 'custom') {
                setTempCustomName('');
                setTempCustomBaseUrl('');
                setTempModelId('');
              } else {
                setTempModelId('');
              }
            }}
            onSubmit={() => {
              if (PROVIDER_PRESETS[currentPresetIndex].id === 'custom') {
                setStep('provider-custom-name');
              } else if (PROVIDER_PRESETS[currentPresetIndex].requiresApiKey) {
                setStep('provider-api-key');
              } else {
                setStep('provider-fetching-models');
              }
            }}
            onBack={() => {
              if (providers.length > 0) {
                setStep('provider-loop-confirm');
              } else {
                setStep('mode-select');
              }
            }}
          />
        )}

        {/* Step 2-1-A: Custom Provider Name */}
        {step === 'provider-custom-name' && (
          <TextInputStep
            label={t('commands.init.wizard.provider.customNameLabel')}
            hint={t('commands.init.wizard.provider.customNameHint')}
            value={tempCustomName}
            onChange={setTempCustomName}
            validate={validateProviderName}
            onSubmit={() => setStep('provider-custom-base-url')}
            onBack={() => setStep('provider-select')}
          />
        )}

        {/* Step 2-1-B: Custom Provider Base URL */}
        {step === 'provider-custom-base-url' && (
          <TextInputStep
            label={t('commands.init.wizard.provider.customBaseUrlLabel')}
            hint={t('commands.init.wizard.provider.customBaseUrlHint')}
            value={tempCustomBaseUrl}
            onChange={setTempCustomBaseUrl}
            validate={validateBaseUrl}
            onSubmit={() => setStep('provider-api-key')}
            onBack={() => setStep('provider-custom-name')}
          />
        )}

        {/* Step 2-2: Provider API Key */}
        {step === 'provider-api-key' && (
          <TextInputStep
            label={t('commands.init.wizard.provider.keyLabel', { provider: effectiveProviderName })}
            hint={t('commands.init.wizard.provider.keyHint')}
            value={tempApiKey}
            onChange={setTempApiKey}
            masked
            allowMaskToggle
            validate={(val) => validateApiKey(val, !currentPreset.requiresApiKey)}
            onSubmit={() => setStep('provider-fetching-models')}
            onBack={() => {
              if (isCustom) {
                setStep('provider-custom-base-url');
              } else {
                setStep('provider-select');
              }
            }}
          />
        )}

        {/* Step 2-2-Fetch: Fetch Models from Provider */}
        {step === 'provider-fetching-models' && (
          <FetchingModelsStep
            providerName={effectiveProviderName}
            baseUrl={effectiveBaseUrl}
            apiKey={tempApiKey}
            onComplete={(models) => {
              setAvailableModels(models);
              if (models.length > 0) {
                setTempModelId(models[0]);
              } else {
                setTempModelId('');
              }
              setStep('provider-model');
            }}
          />
        )}

        {/* Step 2-3: Provider Default Model Selection / Input */}
        {step === 'provider-model' && (
          <ModelSelectOrInputStep
            providerName={effectiveProviderName}
            availableModels={availableModels}
            value={tempModelId}
            onChange={setTempModelId}
            onSubmit={(chosenModel) => {
              const pName = isCustom ? tempCustomName.trim() : currentPreset.name;
              const pBaseUrl = isCustom ? tempCustomBaseUrl.trim() : currentPreset.defaultBaseUrl;

              const newProvider: WizardProviderConfig = {
                name: pName,
                type: currentPreset.type,
                baseUrl: pBaseUrl,
                apiKey: tempApiKey.trim(),
                defaultModel: chosenModel.trim(),
              };

              // 替换同名或追加
              const filtered = providers.filter((p) => p.name !== pName);
              const updated = [...filtered, newProvider];
              setProviders(updated);

              // 自动初始化主脑与工人默认绑定
              if (updated.length === 1) {
                setMainAgentBinding({
                  providerName: newProvider.name,
                  modelId: newProvider.defaultModel,
                });
                setUnifiedSubBinding({
                  providerName: newProvider.name,
                  modelId: newProvider.defaultModel,
                });
                setDevBinding({ providerName: newProvider.name, modelId: newProvider.defaultModel });
                setResBinding({ providerName: newProvider.name, modelId: newProvider.defaultModel });
                setTestBinding({ providerName: newProvider.name, modelId: newProvider.defaultModel });
                setAnaBinding({ providerName: newProvider.name, modelId: newProvider.defaultModel });
              }

              // 重置临时输入
              setTempApiKey('');
              setTempCustomName('');
              setTempCustomBaseUrl('');
              setAvailableModels([]);
              setStep('provider-loop-confirm');
            }}
            onBack={() => {
              if (currentPreset.requiresApiKey) {
                setStep('provider-api-key');
              } else if (isCustom) {
                setStep('provider-custom-base-url');
              } else {
                setStep('provider-select');
              }
            }}
          />
        )}

        {/* Step 2-4: Provider Loop Confirm */}
        {step === 'provider-loop-confirm' && (
          <ProviderLoopStep
            providers={providers}
            onDone={() => setStep(mode === 'single' ? 'acp' : 'assign-main')}
            onAddMore={() => setStep('provider-select')}
            onBack={() => setStep('provider-select')}
          />
        )}

        {/* Step 3-1: Assign Main Agent */}
        {step === 'assign-main' && (
          <AssignRoleStep
            title={t('commands.init.wizard.assign.mainTitle')}
            hint={t('commands.init.wizard.assign.mainHint')}
            providers={providers}
            currentBinding={mainAgentBinding}
            onConfirm={(binding) => {
              setMainAgentBinding(binding);
              setStep('subagent-strategy');
            }}
            onBack={() => setStep('provider-loop-confirm')}
          />
        )}

        {/* Step 3-2: Sub-Agent Strategy Select */}
        {step === 'subagent-strategy' && (
          <SelectStep
            title={t('commands.init.wizard.assign.subStrategyTitle')}
            hint={t('commands.init.wizard.assign.subStrategyHint')}
            options={[
              t('commands.init.wizard.assign.unifiedOption'),
              t('commands.init.wizard.assign.inheritOption'),
              t('commands.init.wizard.assign.roleByRoleOption'),
            ]}
            selectedIndex={
              subStrategy === 'unified' ? 0 : subStrategy === 'inherit_main' ? 1 : 2
            }
            onIndexChange={(i) => {
              const strategies: SubAgentStrategy[] = ['unified', 'inherit_main', 'role_by_role'];
              setSubStrategy(strategies[i]);
            }}
            onSubmit={() => {
              if (subStrategy === 'unified') {
                setStep('assign-sub-unified');
              } else if (subStrategy === 'role_by_role') {
                setStep('assign-sub-dev');
              } else {
                setStep('acp');
              }
            }}
            onBack={() => setStep('assign-main')}
          />
        )}

        {/* Step 3-3: Unified Sub-Agent Assignment */}
        {step === 'assign-sub-unified' && (
          <AssignRoleStep
            title={t('commands.init.wizard.assign.unifiedSubTitle')}
            hint={t('commands.init.wizard.assign.unifiedSubHint')}
            providers={providers}
            currentBinding={unifiedSubBinding}
            onConfirm={(binding) => {
              setUnifiedSubBinding(binding);
              setStep('acp');
            }}
            onBack={() => setStep('subagent-strategy')}
          />
        )}

        {/* Step 3-3-A: Developer Assignment */}
        {step === 'assign-sub-dev' && (
          <AssignRoleStep
            title={t('commands.init.wizard.assign.devTitle')}
            hint={t('commands.init.wizard.assign.devHint')}
            providers={providers}
            currentBinding={devBinding}
            onConfirm={(binding) => {
              setDevBinding(binding);
              setStep('assign-sub-res');
            }}
            onBack={() => setStep('subagent-strategy')}
          />
        )}

        {/* Step 3-3-B: Researcher Assignment */}
        {step === 'assign-sub-res' && (
          <AssignRoleStep
            title={t('commands.init.wizard.assign.resTitle')}
            hint={t('commands.init.wizard.assign.resHint')}
            providers={providers}
            currentBinding={resBinding}
            onConfirm={(binding) => {
              setResBinding(binding);
              setStep('assign-sub-test');
            }}
            onBack={() => setStep('assign-sub-dev')}
          />
        )}

        {/* Step 3-3-C: Tester Assignment */}
        {step === 'assign-sub-test' && (
          <AssignRoleStep
            title={t('commands.init.wizard.assign.testTitle')}
            hint={t('commands.init.wizard.assign.testHint')}
            providers={providers}
            currentBinding={testBinding}
            onConfirm={(binding) => {
              setTestBinding(binding);
              setStep('assign-sub-ana');
            }}
            onBack={() => setStep('assign-sub-res')}
          />
        )}

        {/* Step 3-3-D: Analyst Assignment */}
        {step === 'assign-sub-ana' && (
          <AssignRoleStep
            title={t('commands.init.wizard.assign.anaTitle')}
            hint={t('commands.init.wizard.assign.anaHint')}
            providers={providers}
            currentBinding={anaBinding}
            onConfirm={(binding) => {
              setAnaBinding(binding);
              setStep('acp');
            }}
            onBack={() => setStep('assign-sub-test')}
          />
        )}

        {/* Step 3.5: ACP Ecosystem */}
        {step === 'acp' && (
          <AcpStep
            selectedPresetIds={enabledAcpPresetIds}
            onConfirm={(selected) => {
              setEnabledAcpPresetIds(selected);
              setStep('confirm');
            }}
            onBack={() => {
              if (mode === 'single') {
                setStep('provider-loop-confirm');
              } else if (subStrategy === 'unified') {
                setStep('assign-sub-unified');
              } else if (subStrategy === 'role_by_role') {
                setStep('assign-sub-ana');
              } else {
                setStep('subagent-strategy');
              }
            }}
          />
        )}

        {/* Step 4: Summary & Confirm */}
        {step === 'confirm' && (
          <MultiAgentConfirmStep
            language={language}
            mode={mode}
            providers={providers}
            mainAgent={mainAgentBinding}
            subStrategy={subStrategy}
            unifiedSubAgent={unifiedSubBinding}
            roleBindings={{
              developer: devBinding,
              researcher: resBinding,
              tester: testBinding,
              analyst: anaBinding,
            }}
            enabledAcpPresetIds={enabledAcpPresetIds}
            onBack={() => setStep('acp')}
            onSubmit={async () => {
              setStep('submitting');
              try {
                const paths = await writeConfig({
                  language,
                  mode,
                  providers,
                  mainAgent: mainAgentBinding,
                  subAgentStrategy: subStrategy,
                  unifiedSubAgent: subStrategy === 'unified' ? unifiedSubBinding : undefined,
                  roleBindings:
                    subStrategy === 'role_by_role'
                      ? {
                          developer: devBinding,
                          researcher: resBinding,
                          tester: testBinding,
                          analyst: anaBinding,
                        }
                      : undefined,
                  acp:
                    enabledAcpPresetIds.length > 0
                      ? { enabledPresetIds: enabledAcpPresetIds }
                      : undefined,
                  skinId: 'warlord-immortal',
                });
                setResultPaths(paths);
                setStep('done');
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setErrorMessage(message);
                setStep('error');
              }
            }}
          />
        )}

        {step === 'submitting' && (
          <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.writing')}</Text>
        )}

        {step === 'done' && resultPaths && (
          <DoneStep
            settingsPath={resultPaths.settingsPath}
            authPath={resultPaths.authPath}
            skinsPath={resultPaths.skinsPath}
            rolesPath={resultPaths.rolesPath}
            onDismiss={() => {
              onComplete({ kind: 'submitted', ...resultPaths });
              exit();
            }}
          />
        )}

        {step === 'error' && errorMessage && (
          <ErrorStep
            message={errorMessage}
            onDismiss={() => {
              onComplete({ kind: 'error', message: errorMessage });
              exit();
            }}
          />
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.footer')}</Text>
      </Box>
    </Box>
  );
}
