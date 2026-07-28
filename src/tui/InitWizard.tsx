/**
 * InitWizard - 首次运行配置向导
 *
 * 引导新用户填写最小可运行配置：
 *   1. Provider 类型（openai-compatible / anthropic）
 *   2. Provider 名字（用于 settings 中的 key，同时派生 auth key）
 *   3. baseUrl
 *   4. apiKey（掩码输入）
 *   5. modelId
 *   6. 摘要确认
 *
 * 完成后调用 `writeInitialConfig` 写入 `~/.wasteland/settings.json` 与 `auth.json`。
 * 组件是独立 Ink render 单元，不依赖 AppContext；结束后由外部 unmount。
 */

import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { t } from '../locales/index.js';
import type { InitWizardInput } from '../config/config-writer.js';
import { wastelandTheme } from '../theme/wasteland/index.js';

type ProviderType = 'openai-compatible' | 'anthropic';

type Step =
  | 'provider-type'
  | 'provider-name'
  | 'base-url'
  | 'api-key'
  | 'model-id'
  | 'confirm'
  | 'submitting'
  | 'done'
  | 'error';

type ProviderTypeOption = {
  value: ProviderType;
  labelKey: string;
  defaultBaseUrl: string;
  defaultProviderName: string;
  defaultModel: string;
};

const PROVIDER_TYPE_OPTIONS: ProviderTypeOption[] = [
  {
    value: 'openai-compatible',
    labelKey: 'commands.init.wizard.providerType.openaiCompatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultProviderName: 'openai',
    defaultModel: 'gpt-4o',
  },
  {
    value: 'anthropic',
    labelKey: 'commands.init.wizard.providerType.anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultProviderName: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
  },
];

export type InitWizardResult =
  | { kind: 'submitted'; settingsPath: string; authPath: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface InitWizardProps {
  /** 完成后回调，父组件用于收集结果 */
  onComplete: (result: InitWizardResult) => void;
  /** 写入函数（DI 供测试注入） */
  writeConfig: (input: InitWizardInput) => Promise<{ settingsPath: string; authPath: string }>;
}

/**
 * 主组件
 */
export function InitWizard({ onComplete, writeConfig }: InitWizardProps): React.ReactElement {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('provider-type');
  const [typeIndex, setTypeIndex] = useState(0);
  const [providerName, setProviderName] = useState(PROVIDER_TYPE_OPTIONS[0].defaultProviderName);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_TYPE_OPTIONS[0].defaultBaseUrl);
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState(PROVIDER_TYPE_OPTIONS[0].defaultModel);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultPaths, setResultPaths] = useState<{ settingsPath: string; authPath: string } | null>(
    null
  );

  const providerType = PROVIDER_TYPE_OPTIONS[typeIndex].value;

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
        {step === 'provider-type' && (
          <ProviderTypeStep
            typeIndex={typeIndex}
            onIndexChange={setTypeIndex}
            onSubmit={() => {
              const opt = PROVIDER_TYPE_OPTIONS[typeIndex];
              setProviderName(opt.defaultProviderName);
              setBaseUrl(opt.defaultBaseUrl);
              setModelId(opt.defaultModel);
              setStep('provider-name');
            }}
          />
        )}
        {step === 'provider-name' && (
          <TextInputStep
            label={t('commands.init.wizard.providerName.label')}
            hint={t('commands.init.wizard.providerName.hint')}
            value={providerName}
            onChange={setProviderName}
            validate={validateProviderName}
            onSubmit={() => setStep('base-url')}
          />
        )}
        {step === 'base-url' && (
          <TextInputStep
            label={t('commands.init.wizard.baseUrl.label')}
            hint={t('commands.init.wizard.baseUrl.hint')}
            value={baseUrl}
            onChange={setBaseUrl}
            validate={validateBaseUrl}
            onSubmit={() => setStep('api-key')}
          />
        )}
        {step === 'api-key' && (
          <TextInputStep
            label={t('commands.init.wizard.apiKey.label')}
            hint={t('commands.init.wizard.apiKey.hint')}
            value={apiKey}
            onChange={setApiKey}
            masked
            validate={validateApiKey}
            onSubmit={() => setStep('model-id')}
          />
        )}
        {step === 'model-id' && (
          <TextInputStep
            label={t('commands.init.wizard.modelId.label')}
            hint={t('commands.init.wizard.modelId.hint')}
            value={modelId}
            onChange={setModelId}
            validate={validateModelId}
            onSubmit={() => setStep('confirm')}
          />
        )}
        {step === 'confirm' && (
          <ConfirmStep
            providerName={providerName}
            providerType={providerType}
            baseUrl={baseUrl}
            apiKey={apiKey}
            modelId={modelId}
            onSubmit={async () => {
              setStep('submitting');
              try {
                const paths = await writeConfig({
                  providerName,
                  providerType,
                  baseUrl,
                  apiKey,
                  modelId,
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

// ============================================================
// Step Components
// ============================================================

function ProviderTypeStep({
  typeIndex,
  onIndexChange,
  onSubmit,
}: {
  typeIndex: number;
  onIndexChange: (i: number) => void;
  onSubmit: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.upArrow) {
      onIndexChange((typeIndex - 1 + PROVIDER_TYPE_OPTIONS.length) % PROVIDER_TYPE_OPTIONS.length);
    } else if (key.downArrow) {
      onIndexChange((typeIndex + 1) % PROVIDER_TYPE_OPTIONS.length);
    } else if (key.return) {
      onSubmit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{t('commands.init.wizard.providerType.label')}</Text>
      <Text color={wastelandTheme.colors.muted}>{t('commands.init.wizard.providerType.hint')}</Text>
      <Box flexDirection="column" marginTop={1}>
        {PROVIDER_TYPE_OPTIONS.map((option, index) => {
          const selected = index === typeIndex;
          const symbol = selected ? '▶' : ' ';
          return (
            <Text key={option.value} color={selected ? wastelandTheme.colors.primary : undefined}>
              {`${symbol} ${t(option.labelKey)} (${option.value})`}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

function TextInputStep({
  label,
  hint,
  value,
  onChange,
  masked = false,
  validate,
  onSubmit,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  masked?: boolean;
  validate?: (v: string) => string | null;
  onSubmit: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);

  useInput((inputChar, key) => {
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
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      setError(null);
      return;
    }
    if (key.escape) {
      // Esc 清空当前字段（便于重填）
      onChange('');
      setError(null);
      return;
    }
    // 只接受普通字符
    if (inputChar && !key.ctrl && !key.meta && inputChar !== '\r' && inputChar !== '\n') {
      onChange(value + inputChar);
      setError(null);
    }
  });

  const display = masked ? '*'.repeat(value.length) : value;

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
      {error && (
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.error}>{error}</Text>
        </Box>
      )}
    </Box>
  );
}

function ConfirmStep({
  providerName,
  providerType,
  baseUrl,
  apiKey,
  modelId,
  onSubmit,
}: {
  providerName: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  onSubmit: () => void | Promise<void>;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      void onSubmit();
    }
  });

  const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '****';

  return (
    <Box flexDirection="column">
      <Text bold>{t('commands.init.wizard.confirm.title')}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {t('commands.init.wizard.confirm.providerName')}:{' '}
          <Text color={wastelandTheme.colors.primary}>{providerName}</Text>
        </Text>
        <Text>
          {t('commands.init.wizard.confirm.providerType')}:{' '}
          <Text color={wastelandTheme.colors.primary}>{providerType}</Text>
        </Text>
        <Text>
          {t('commands.init.wizard.confirm.baseUrl')}:{' '}
          <Text color={wastelandTheme.colors.primary}>{baseUrl}</Text>
        </Text>
        <Text>
          {t('commands.init.wizard.confirm.apiKey')}:{' '}
          <Text color={wastelandTheme.colors.primary}>{maskedKey}</Text>
        </Text>
        <Text>
          {t('commands.init.wizard.confirm.model')}:{' '}
          <Text color={wastelandTheme.colors.primary}>{modelId}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.warning}>
          {t('commands.init.wizard.confirm.enterToSubmit')}
        </Text>
      </Box>
    </Box>
  );
}

function DoneStep({
  settingsPath,
  authPath,
  onDismiss,
}: {
  settingsPath: string;
  authPath: string;
  onDismiss: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      onDismiss();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={wastelandTheme.colors.success} bold>
        {t('commands.init.wizard.done.title')}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={wastelandTheme.colors.muted}>settings</Text>: {settingsPath}
        </Text>
        <Text>
          <Text color={wastelandTheme.colors.muted}>auth</Text>: {authPath}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>
          {t('commands.init.wizard.done.enterToContinue')}
        </Text>
      </Box>
    </Box>
  );
}

function ErrorStep({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      onDismiss();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={wastelandTheme.colors.error} bold>
        {t('commands.init.wizard.error.title')}
      </Text>
      <Text color={wastelandTheme.colors.error}>{message}</Text>
      <Box marginTop={1}>
        <Text color={wastelandTheme.colors.muted}>
          {t('commands.init.wizard.done.enterToContinue')}
        </Text>
      </Box>
    </Box>
  );
}

// ============================================================
// Validators (exported for tests)
// ============================================================

export function validateProviderName(value: string): string | null {
  if (!value.trim()) return t('commands.init.wizard.errors.emptyProviderName');
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return t('commands.init.wizard.errors.invalidProviderName');
  return null;
}

export function validateBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t('commands.init.wizard.errors.emptyBaseUrl');
  if (!/^https?:\/\//.test(trimmed)) return t('commands.init.wizard.errors.invalidBaseUrl');
  return null;
}

export function validateApiKey(value: string): string | null {
  if (!value.trim()) return t('commands.init.wizard.errors.emptyApiKey');
  return null;
}

export function validateModelId(value: string): string | null {
  if (!value.trim()) return t('commands.init.wizard.errors.emptyModelId');
  return null;
}
