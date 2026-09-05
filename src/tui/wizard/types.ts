/**
 * wizard/types.ts - InitWizard 共享类型
 *
 * 从 `InitWizard.tsx` 拆出：向导状态机与各步骤组件的公共类型。
 * 对外仍由 `InitWizard.tsx` re-export，保持 `init.ts` 导入路径不变。
 */

import type {
  InitWizardInput,
  WizardProviderConfig,
  WizardRoleBinding,
} from '@config/config-writer.js';

export type ProviderPreset = {
  id: string;
  name: string;
  type: 'openai-compatible';
  labelKey: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
};

export type SubAgentStrategy = 'unified' | 'inherit_main' | 'role_by_role';

export type Step =
  | 'language-select'
  | 'mode-select'
  | 'provider-select'
  | 'provider-custom-name'
  | 'provider-custom-base-url'
  | 'provider-api-key'
  | 'provider-fetching-models'
  | 'provider-model'
  | 'provider-loop-confirm'
  | 'assign-main'
  | 'subagent-strategy'
  | 'assign-sub-unified'
  | 'assign-sub-dev'
  | 'assign-sub-res'
  | 'assign-sub-test'
  | 'assign-sub-ana'
  | 'a2a'
  | 'confirm'
  | 'submitting'
  | 'done'
  | 'error';

export type InitWizardResult =
  | { kind: 'submitted'; settingsPath: string; authPath: string; skinsPath: string; rolesPath: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface InitWizardProps {
  onComplete: (result: InitWizardResult) => void;
  writeConfig: (input: InitWizardInput) => Promise<{
    settingsPath: string;
    authPath: string;
    skinsPath: string;
    rolesPath: string;
  }>;
}

export type { InitWizardInput, WizardProviderConfig, WizardRoleBinding };
