/**
 * useWizardState.test.tsx - InitWizard 状态机与控制流 Hook 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';

import { useWizardState, type UseWizardStateReturn } from '../useWizardState.js';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('useWizardState', () => {
  it('manages wizard state machine flow from language to submit', async () => {
    let wizard!: UseWizardStateReturn;
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const exit = vi.fn();
    const writeConfig = vi.fn().mockResolvedValue({
      settingsPath: '/mock/settings.json',
      authPath: '/mock/auth.json',
      skinsPath: '/mock/skins.json',
      rolesPath: '/mock/roles.json',
    });

    function TestHarness() {
      wizard = useWizardState({ onComplete, writeConfig, onCancel, exit });
      return null;
    }

    const instance = render(<TestHarness />, { patchConsole: false });

    try {
      await tick();
      // 1. Initial State
      expect(wizard.state.step).toBe('language-select');
      expect(wizard.state.language).toBe('zh');
      expect(wizard.state.mode).toBe('multi');
      expect(wizard.state.providers).toHaveLength(0);

      // 2. Language Selection -> mode-select
      wizard.selectLanguage('en');
      await tick();
      expect(wizard.state.step).toBe('mode-select');
      expect(wizard.state.language).toBe('en');

      // 3. Mode Select -> provider-select
      wizard.goNext();
      await tick();
      expect(wizard.state.step).toBe('provider-select');

      // 4. Provider Select -> provider-api-key (preset 0 requires API key)
      wizard.goNext();
      await tick();
      expect(wizard.state.step).toBe('provider-api-key');

      // 5. API Key Input -> provider-fetching-models
      wizard.updateField('tempApiKey', 'sk-mock-key');
      wizard.goNext();
      await tick();
      expect(wizard.state.step).toBe('provider-fetching-models');

      // 6. Models Fetched -> provider-model
      wizard.handleModelsFetched(['deepseek-chat', 'deepseek-reasoner']);
      await tick();
      expect(wizard.state.step).toBe('provider-model');
      expect(wizard.state.availableModels).toEqual(['deepseek-chat', 'deepseek-reasoner']);
      expect(wizard.state.tempModelId).toBe('deepseek-chat');

      // 7. Commit Provider -> provider-loop-confirm
      wizard.commitCurrentProvider('deepseek-chat');
      await tick();
      expect(wizard.state.step).toBe('provider-loop-confirm');
      expect(wizard.state.providers).toHaveLength(1);
      expect(wizard.state.providers[0].name).toBe('deepseek');
      expect(wizard.state.mainAgentBinding.modelId).toBe('deepseek-chat');

      // 8. Provider Loop -> assign-main
      wizard.goNext();
      await tick();
      expect(wizard.state.step).toBe('assign-main');

      // 9. Assign Main -> subagent-strategy
      wizard.assignRole('mainAgentBinding', {
        providerName: 'deepseek',
        modelId: 'deepseek-reasoner',
      });
      await tick();
      expect(wizard.state.step).toBe('subagent-strategy');
      expect(wizard.state.mainAgent.modelId).toBe('deepseek-reasoner');

      // 10. SubAgent Strategy (default 'unified') -> assign-sub-unified
      wizard.goNext();
      await tick();
      expect(wizard.state.step).toBe('assign-sub-unified');

      // 11. Assign Unified Sub -> acp
      wizard.assignRole('unifiedSubBinding', {
        providerName: 'deepseek',
        modelId: 'deepseek-chat',
      });
      await tick();
      expect(wizard.state.step).toBe('acp');

      // 12. ACP Presets -> confirm
      wizard.confirmAcp(['fetch_tools']);
      await tick();
      expect(wizard.state.step).toBe('confirm');
      expect(wizard.state.enabledAcpPresetIds).toEqual(['fetch_tools']);

      // 13. Submit -> writeConfig -> done
      await wizard.submit();
      await tick();
      expect(writeConfig).toHaveBeenCalledTimes(1);
      expect(wizard.state.step).toBe('done');
      expect(wizard.state.resultPaths?.settingsPath).toBe('/mock/settings.json');

      // 14. Dismiss Done -> onComplete & exit
      wizard.dismissDone();
      expect(onComplete).toHaveBeenCalledWith({
        kind: 'submitted',
        settingsPath: '/mock/settings.json',
        authPath: '/mock/auth.json',
        skinsPath: '/mock/skins.json',
        rolesPath: '/mock/roles.json',
      });
      expect(exit).toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('handles cancellation and back navigation', async () => {
    let wizard!: UseWizardStateReturn;
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const exit = vi.fn();
    const writeConfig = vi.fn();

    function TestHarness() {
      wizard = useWizardState({ onComplete, writeConfig, onCancel, exit });
      return null;
    }

    const instance = render(<TestHarness />, { patchConsole: false });

    try {
      await tick();
      wizard.goNext();
      await tick();
      expect(wizard.state.step).toBe('mode-select');

      wizard.goPrev();
      await tick();
      expect(wizard.state.step).toBe('language-select');

      wizard.cancel();
      expect(onCancel).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith({ kind: 'cancelled' });
      expect(exit).toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });
});
