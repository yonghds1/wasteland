/**
 * wizard/useWizardState.ts - 向导状态与业务控制流 Hook (Step 迁移/表单字段/模型探测/配置写入)
 */

import { useCallback, useState } from 'react';

import { setLanguage } from '@locales/index.js';
import type {
  InitWizardInput,
  WizardProviderConfig,
  WizardRoleBinding,
} from '@config/config-writer.js';
import { fetchRemoteModels } from '@providers/fetch-models.js';
import { PROVIDER_PRESETS } from './presets.js';
import type {
  InitWizardResult,
  ProviderPreset,
  Step,
  SubAgentStrategy,
  WizardResultPaths,
} from './types.js';

export interface UseWizardStateOptions {
  onComplete: (result: InitWizardResult) => void;
  writeConfig: (input: InitWizardInput) => Promise<WizardResultPaths>;
  onCancel?: () => void;
  exit?: () => void;
}

export interface WizardState {
  step: Step;
  language: 'zh' | 'en';
  mode: 'multi' | 'single';
  providers: WizardProviderConfig[];
  currentPresetIndex: number;
  currentPreset: ProviderPreset;
  isCustom: boolean;
  effectiveProviderName: string;
  effectiveBaseUrl: string;
  tempCustomName: string;
  tempCustomBaseUrl: string;
  tempApiKey: string;
  tempModelId: string;
  availableModels: string[];
  isFetchingModels: boolean;
  mainAgentBinding: WizardRoleBinding;
  mainAgent: WizardRoleBinding;
  subStrategy: SubAgentStrategy;
  unifiedSubBinding: WizardRoleBinding;
  unifiedSubAgent: WizardRoleBinding;
  devBinding: WizardRoleBinding;
  resBinding: WizardRoleBinding;
  testBinding: WizardRoleBinding;
  anaBinding: WizardRoleBinding;
  roleBindings: {
    developer: WizardRoleBinding;
    researcher: WizardRoleBinding;
    tester: WizardRoleBinding;
    analyst: WizardRoleBinding;
  };
  enabledAcpPresetIds: string[];
  errorMessage: string | null;
  resultPaths: WizardResultPaths | null;
}

export type WizardFieldValues = {
  step: Step;
  language: 'zh' | 'en';
  mode: 'multi' | 'single';
  providers: WizardProviderConfig[];
  currentPresetIndex: number;
  tempCustomName: string;
  tempCustomBaseUrl: string;
  tempApiKey: string;
  tempModelId: string;
  availableModels: string[];
  mainAgentBinding: WizardRoleBinding;
  subStrategy: SubAgentStrategy;
  unifiedSubBinding: WizardRoleBinding;
  devBinding: WizardRoleBinding;
  resBinding: WizardRoleBinding;
  testBinding: WizardRoleBinding;
  anaBinding: WizardRoleBinding;
  enabledAcpPresetIds: string[];
  errorMessage: string | null;
  resultPaths: WizardResultPaths | null;
};

const STATIC_NEXT: Partial<Record<Step, Step>> = {
  'language-select': 'mode-select',
  'mode-select': 'provider-select',
  'provider-custom-name': 'provider-custom-base-url',
  'provider-custom-base-url': 'provider-api-key',
  'provider-api-key': 'provider-fetching-models',
  'provider-fetching-models': 'provider-model',
  'provider-model': 'provider-loop-confirm',
  'assign-main': 'subagent-strategy',
  'assign-sub-unified': 'acp',
  'assign-sub-dev': 'assign-sub-res',
  'assign-sub-res': 'assign-sub-test',
  'assign-sub-test': 'assign-sub-ana',
  'assign-sub-ana': 'acp',
  acp: 'confirm',
};

const STATIC_PREV: Partial<Record<Step, Step>> = {
  'mode-select': 'language-select',
  'provider-custom-name': 'provider-select',
  'provider-custom-base-url': 'provider-custom-name',
  'provider-loop-confirm': 'provider-select',
  'assign-main': 'provider-loop-confirm',
  'subagent-strategy': 'assign-main',
  'assign-sub-unified': 'subagent-strategy',
  'assign-sub-dev': 'subagent-strategy',
  'assign-sub-res': 'assign-sub-dev',
  'assign-sub-test': 'assign-sub-res',
  'assign-sub-ana': 'assign-sub-test',
  confirm: 'acp',
};

const initRoleBinding = (): WizardRoleBinding => ({
  providerName: PROVIDER_PRESETS[0].name,
  modelId: '',
});

export function useWizardState({ onComplete, writeConfig, onCancel, exit }: UseWizardStateOptions) {
  const [step, setStep] = useState<Step>('language-select');
  const [language, setLanguageState] = useState<'zh' | 'en'>('zh');
  const [mode, setMode] = useState<'multi' | 'single'>('multi');

  const [providers, setProviders] = useState<WizardProviderConfig[]>([]);
  const [currentPresetIndex, setCurrentPresetIndex] = useState(0);
  const [tempCustomName, setTempCustomName] = useState('');
  const [tempCustomBaseUrl, setTempCustomBaseUrl] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [tempModelId, setTempModelId] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const [mainAgentBinding, setMainAgentBinding] = useState<WizardRoleBinding>(initRoleBinding);
  const [subStrategy, setSubStrategy] = useState<SubAgentStrategy>('unified');
  const [unifiedSubBinding, setUnifiedSubBinding] = useState<WizardRoleBinding>(initRoleBinding);
  const [devBinding, setDevBinding] = useState<WizardRoleBinding>(initRoleBinding);
  const [resBinding, setResBinding] = useState<WizardRoleBinding>(initRoleBinding);
  const [testBinding, setTestBinding] = useState<WizardRoleBinding>(initRoleBinding);
  const [anaBinding, setAnaBinding] = useState<WizardRoleBinding>(initRoleBinding);

  const [enabledAcpPresetIds, setEnabledAcpPresetIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultPaths, setResultPaths] = useState<WizardResultPaths | null>(null);

  const currentPreset = PROVIDER_PRESETS[currentPresetIndex] ?? PROVIDER_PRESETS[0];
  const isCustom = currentPreset.id === 'custom';
  const effectiveProviderName = isCustom ? tempCustomName.trim() : currentPreset.name;
  const effectiveBaseUrl = isCustom ? tempCustomBaseUrl.trim() : currentPreset.defaultBaseUrl;

  const selectLanguage = useCallback((lang: 'zh' | 'en') => {
    setLanguage(lang);
    setLanguageState(lang);
    setStep('mode-select');
  }, []);

  const selectPresetIndex = useCallback((i: number) => {
    setCurrentPresetIndex(i);
    const preset = PROVIDER_PRESETS[i];
    if (preset?.id === 'custom') {
      setTempCustomName('');
      setTempCustomBaseUrl('');
      setTempModelId('');
    } else {
      setTempModelId('');
    }
  }, []);

  const handleModelsFetched = useCallback((models: string[]) => {
    setAvailableModels(models);
    setTempModelId(models.length > 0 ? models[0] : '');
    setStep('provider-model');
  }, []);

  const fetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    try {
      const res = await fetchRemoteModels({
        baseUrl: effectiveBaseUrl,
        apiKey: tempApiKey,
        timeoutMs: 4000,
      });
      const models = res.success ? res.models : [];
      handleModelsFetched(models);
      return models;
    } finally {
      setIsFetchingModels(false);
    }
  }, [effectiveBaseUrl, tempApiKey, handleModelsFetched]);

  const commitCurrentProvider = useCallback(
    (chosenModel: string) => {
      const pName = isCustom ? tempCustomName.trim() : currentPreset.name;
      const pBaseUrl = isCustom ? tempCustomBaseUrl.trim() : currentPreset.defaultBaseUrl;

      const newProvider: WizardProviderConfig = {
        name: pName,
        type: currentPreset.type,
        baseUrl: pBaseUrl,
        apiKey: tempApiKey.trim(),
        defaultModel: chosenModel.trim(),
      };

      const filtered = providers.filter((p) => p.name !== pName);
      const updated = [...filtered, newProvider];
      setProviders(updated);

      if (updated.length === 1) {
        const defaultBinding: WizardRoleBinding = {
          providerName: newProvider.name,
          modelId: newProvider.defaultModel,
        };
        setMainAgentBinding(defaultBinding);
        setUnifiedSubBinding(defaultBinding);
        setDevBinding(defaultBinding);
        setResBinding(defaultBinding);
        setTestBinding(defaultBinding);
        setAnaBinding(defaultBinding);
      }

      setTempApiKey('');
      setTempCustomName('');
      setTempCustomBaseUrl('');
      setAvailableModels([]);
      setStep('provider-loop-confirm');
    },
    [
      isCustom,
      tempCustomName,
      currentPreset.name,
      currentPreset.type,
      currentPreset.defaultBaseUrl,
      tempCustomBaseUrl,
      tempApiKey,
      providers,
    ]
  );

  const submit = useCallback(async () => {
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
        acp: enabledAcpPresetIds.length > 0 ? { enabledPresetIds: enabledAcpPresetIds } : undefined,
        skinId: 'warlord-immortal',
      });
      setResultPaths(paths);
      setStep('done');
      return paths;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStep('error');
      return null;
    }
  }, [
    writeConfig,
    language,
    mode,
    providers,
    mainAgentBinding,
    subStrategy,
    unifiedSubBinding,
    devBinding,
    resBinding,
    testBinding,
    anaBinding,
    enabledAcpPresetIds,
  ]);

  const cancel = useCallback(() => {
    onCancel?.();
    onComplete({ kind: 'cancelled' });
    exit?.();
  }, [onCancel, onComplete, exit]);

  const dismissDone = useCallback(() => {
    if (resultPaths) {
      onComplete({ kind: 'submitted', ...resultPaths });
    }
    exit?.();
  }, [onComplete, resultPaths, exit]);

  const dismissError = useCallback(() => {
    if (errorMessage) {
      onComplete({ kind: 'error', message: errorMessage });
    }
    exit?.();
  }, [onComplete, errorMessage, exit]);

  const goNext = useCallback(() => {
    const staticTarget = STATIC_NEXT[step];
    if (staticTarget) {
      setStep(staticTarget);
      return;
    }

    if (step === 'provider-select') {
      if (currentPreset.id === 'custom') {
        setStep('provider-custom-name');
      } else if (currentPreset.requiresApiKey) {
        setStep('provider-api-key');
      } else {
        setStep('provider-fetching-models');
      }
    } else if (step === 'provider-loop-confirm') {
      setStep(mode === 'single' ? 'acp' : 'assign-main');
    } else if (step === 'subagent-strategy') {
      if (subStrategy === 'unified') {
        setStep('assign-sub-unified');
      } else if (subStrategy === 'role_by_role') {
        setStep('assign-sub-dev');
      } else {
        setStep('acp');
      }
    } else if (step === 'confirm') {
      void submit();
    }
  }, [step, currentPreset, mode, subStrategy, submit]);

  const goPrev = useCallback(() => {
    const staticTarget = STATIC_PREV[step];
    if (staticTarget) {
      setStep(staticTarget);
      return;
    }

    const prevBeforeModel = currentPreset.requiresApiKey
      ? 'provider-api-key'
      : isCustom
        ? 'provider-custom-base-url'
        : 'provider-select';

    if (step === 'provider-select') {
      setStep(providers.length > 0 ? 'provider-loop-confirm' : 'mode-select');
    } else if (step === 'provider-api-key') {
      setStep(isCustom ? 'provider-custom-base-url' : 'provider-select');
    } else if (step === 'provider-fetching-models' || step === 'provider-model') {
      setStep(prevBeforeModel);
    } else if (step === 'acp') {
      if (mode === 'single') {
        setStep('provider-loop-confirm');
      } else if (subStrategy === 'unified') {
        setStep('assign-sub-unified');
      } else if (subStrategy === 'role_by_role') {
        setStep('assign-sub-ana');
      } else {
        setStep('subagent-strategy');
      }
    }
  }, [step, providers.length, isCustom, currentPreset.requiresApiKey, mode, subStrategy]);

  const updateField = useCallback(
    <K extends keyof WizardFieldValues>(key: K, value: WizardFieldValues[K]) => {
      const setters: { [P in keyof WizardFieldValues]: (val: WizardFieldValues[P]) => void } = {
        step: setStep,
        language: setLanguageState,
        mode: setMode,
        providers: setProviders,
        currentPresetIndex: setCurrentPresetIndex,
        tempCustomName: setTempCustomName,
        tempCustomBaseUrl: setTempCustomBaseUrl,
        tempApiKey: setTempApiKey,
        tempModelId: setTempModelId,
        availableModels: setAvailableModels,
        mainAgentBinding: setMainAgentBinding,
        subStrategy: setSubStrategy,
        unifiedSubBinding: setUnifiedSubBinding,
        devBinding: setDevBinding,
        resBinding: setResBinding,
        testBinding: setTestBinding,
        anaBinding: setAnaBinding,
        enabledAcpPresetIds: setEnabledAcpPresetIds,
        errorMessage: setErrorMessage,
        resultPaths: setResultPaths,
      };
      setters[key](value);
    },
    []
  );

  const assignRole = useCallback(
    (fieldKey: keyof WizardFieldValues, binding: WizardRoleBinding) => {
      updateField(fieldKey, binding);
      goNext();
    },
    [updateField, goNext]
  );

  const confirmAcp = useCallback(
    (ids: string[]) => {
      updateField('enabledAcpPresetIds', ids);
      goNext();
    },
    [updateField, goNext]
  );

  const addMoreProviders = useCallback(() => {
    setStep('provider-select');
  }, []);

  const state: WizardState = {
    step,
    language,
    mode,
    providers,
    currentPresetIndex,
    currentPreset,
    isCustom,
    effectiveProviderName,
    effectiveBaseUrl,
    tempCustomName,
    tempCustomBaseUrl,
    tempApiKey,
    tempModelId,
    availableModels,
    isFetchingModels,
    mainAgentBinding,
    mainAgent: mainAgentBinding,
    subStrategy,
    unifiedSubBinding,
    unifiedSubAgent: unifiedSubBinding,
    devBinding,
    resBinding,
    testBinding,
    anaBinding,
    roleBindings: {
      developer: devBinding,
      researcher: resBinding,
      tester: testBinding,
      analyst: anaBinding,
    },
    enabledAcpPresetIds,
    errorMessage,
    resultPaths,
  };

  return {
    state,
    setStep,
    goNext,
    goPrev,
    updateField,
    assignRole,
    confirmAcp,
    addMoreProviders,
    selectLanguage,
    selectPresetIndex,
    handleModelsFetched,
    fetchModels,
    commitCurrentProvider,
    submit,
    cancel,
    dismissDone,
    dismissError,
  };
}

export type UseWizardStateReturn = ReturnType<typeof useWizardState>;
