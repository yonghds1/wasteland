/**
 * ConfigPage - 配置页面
 *
 * 完整配置编辑器，支持：
 * - Sources：显示配置源和优先级
 * - Runtime：defaultRole, permissionMode, maxStepsPerTurn, maxTurns, childAgentTimeout, debug
 * - Providers：只读展示
 * - Models：只读展示
 * - Roles：只读展示
 */

import React, { useState, useEffect } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import { loadJoeSettings } from "../../../config/load-settings.js";
import { resolveUserSettingsPath, resolveProjectSettingsPath, findProjectConfigDir } from "../../../config/paths.js";
import { resolveChatRuntime } from "../../../config/resolve-chat-runtime.js";
import type { PermissionMode } from "../../../runtime/permission-gate.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  PRIMARY,
  SUCCESS,
  WARNING,
  SEPARATORS,
} from "../../utils/colors.js";

type ConfigSection = "sources" | "runtime" | "providers" | "models" | "subAgents";

const SECTIONS: { key: ConfigSection; label: string; color: string; editable: boolean }[] = [
  { key: "sources", label: "配置源", color: "gray", editable: false },
  { key: "runtime", label: "Runtime", color: "green", editable: true },
  { key: "providers", label: "Providers", color: "cyan", editable: false },
  { key: "models", label: "Models", color: "yellow", editable: false },
  { key: "subAgents", label: "Roles", color: "magenta", editable: false },
];

const PERMISSION_MODE_OPTIONS: PermissionMode[] = ["default", "accept_edits", "bypass_permissions"];

interface ConfigPageProps {
  height?: number;
  width?: number;
}

export function ConfigPage({ height, width }: ConfigPageProps): React.ReactElement {
  const { state, setState, setEditMode, updateConfig } = useAppContext();
  const [focusedSection, setFocusedSection] = useState<ConfigSection>("sources");
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [providerOptions, setProviderOptions] = useState<string[]>([]);

  // 加载可用的 Provider 列表
  useEffect(() => {
    async function loadProviders() {
      try {
        const loaded = await loadJoeSettings({ cwd: process.cwd(), env: process.env });
        const providerNames = Object.keys(loaded.settings.providers);
        if (providerNames.length > 0) {
          setProviderOptions(providerNames);
        }
      } catch {
        // 使用默认选项
      }
    }
    loadProviders();
  }, []);

  // 监听编辑模式变化
  useEffect(() => {
    setEditMode(focusedField !== null);
  }, [focusedField, setEditMode]);

  // 获取当前 section 配置
  const sectionKeys = SECTIONS.map((s) => s.key);

  // 处理编辑模式下的输入
  const handleEditModeInput = (input: string, key: { return: boolean; escape: boolean; upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean }) => {
    if (key.escape) {
      setFocusedField(null);
      return;
    }

    if (key.return) {
      // 在 runtime 区域内移动
      if (focusedSection === "runtime") {
        const runtimeFields = ["permissionMode", "maxSteps", "maxTurns", "defaultRole", "childAgentTimeout", "debug"];
        const idx = runtimeFields.indexOf(focusedField ?? "");
        if (idx < runtimeFields.length - 1) {
          setFocusedField(runtimeFields[idx + 1]);
        } else {
          setFocusedField(null);
        }
      } else {
        setFocusedField(null);
      }
      return;
    }

    // 字段特定编辑
    if (focusedField === "permissionMode") {
      const idx = PERMISSION_MODE_OPTIONS.indexOf(state.config.permissionMode as PermissionMode);
      const nextIdx = key.leftArrow
        ? (idx - 1 + PERMISSION_MODE_OPTIONS.length) % PERMISSION_MODE_OPTIONS.length
        : (idx + 1) % PERMISSION_MODE_OPTIONS.length;
      updateConfig({ permissionMode: PERMISSION_MODE_OPTIONS[nextIdx] });
    } else if (focusedField === "maxSteps") {
      if (key.upArrow) {
        updateConfig({ maxSteps: Math.min(50, state.config.maxSteps + 1) });
      } else if (key.downArrow) {
        updateConfig({ maxSteps: Math.max(1, state.config.maxSteps - 1) });
      }
    } else if (focusedField === "maxTurns") {
      if (key.upArrow) {
        updateConfig({ maxTurns: Math.min(200, state.config.maxTurns + 1) });
      } else if (key.downArrow) {
        updateConfig({ maxTurns: Math.max(1, state.config.maxTurns - 1) });
      }
    } else if (focusedField === "defaultRole") {
      // 循环切换 role
      const roleNames = Object.keys(state.fullConfig.subAgents);
      if (roleNames.length > 0) {
        const idx = roleNames.indexOf(state.config.defaultRole);
        const nextIdx = key.leftArrow
          ? (idx - 1 + roleNames.length) % roleNames.length
          : (idx + 1) % roleNames.length;
        updateConfig({ defaultRole: roleNames[nextIdx] });
      }
    } else if (focusedField === "childAgentTimeout") {
      if (key.upArrow) {
        updateConfig({ childAgentTimeout: Math.min(600000, state.config.childAgentTimeout + 10000) });
      } else if (key.downArrow) {
        updateConfig({ childAgentTimeout: Math.max(10000, state.config.childAgentTimeout - 10000) });
      }
    } else if (focusedField === "debug") {
      updateConfig({ debug: !state.config.debug });
    }
  };

  // 键盘导航
  useInput(
    (input, key) => {
      if (focusedField) {
        handleEditModeInput(input, key);
        return;
      }

      // 上下切换 section
      if (key.upArrow) {
        const idx = sectionKeys.indexOf(focusedSection);
        if (idx > 0) setFocusedSection(sectionKeys[idx - 1]);
      }
      if (key.downArrow) {
        const idx = sectionKeys.indexOf(focusedSection);
        if (idx < sectionKeys.length - 1) setFocusedSection(sectionKeys[idx + 1]);
      }

      // Enter 进入编辑模式
      if (key.return) {
        const section = SECTIONS.find((s) => s.key === focusedSection);
        if (section?.editable) {
          if (focusedSection === "runtime") {
            setFocusedField("permissionMode");
          }
        }
      }

      // Ctrl+S 保存到 project config
      if (input === "s" && key.ctrl) {
        handleSave("project");
      }

      // Ctrl+U 保存到 user config
      if (input === "u" && key.ctrl) {
        handleSave("user");
      }

      // Ctrl+R 重置
      if (input === "r" && key.ctrl) {
        handleReset();
      }
    },
    { isActive: state.currentPage === "config" && state.focusArea === "configList" && !state.inputMode && !state.filterMode && !state.exitConfirmPending && !state.showHelp }
  );

  // 保存配置
  const handleSave = async (target: "project" | "user") => {
    if (!state.configHasChanges && target === "project") {
      setSaveMessage("没有更改需要保存");
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    setSaveStatus("saving");
    setSaveMessage("正在保存...");

    try {
      const cwd = process.cwd();
      let settingsPath: string;

      if (target === "project") {
        const projectConfigDir = await findProjectConfigDir(cwd);
        settingsPath = projectConfigDir
          ? resolveProjectSettingsPath(projectConfigDir)
          : resolveProjectSettingsPath(`${cwd}/.wasteland`);
      } else {
        settingsPath = resolveUserSettingsPath(process.env);
      }

      // 读取现有配置
      let existingSettings: Record<string, unknown> = {};
      try {
        const content = await import("node:fs/promises").then((fs) => fs.readFile(settingsPath, "utf8"));
        existingSettings = JSON.parse(content);
      } catch {
        // 文件不存在
      }

      // 合并更改
      const newSettings = {
        ...existingSettings,
        defaultProvider: state.config.provider,
        runtime: {
          ...(existingSettings.runtime as Record<string, unknown> | undefined) as Record<string, unknown> | undefined,
          defaultRole: state.config.defaultRole || undefined,
          permissionMode: state.config.permissionMode,
          maxStepsPerTurn: state.config.maxSteps,
          maxTurns: state.config.maxTurns,
          childAgentTimeout: state.config.childAgentTimeout,
          debug: state.config.debug,
        },
      };

      // 确保目录存在
      await mkdir(dirname(settingsPath), { recursive: true });

      // 写入文件
      await writeFile(settingsPath, JSON.stringify(newSettings, null, 2), "utf8");

      setSaveStatus("saved");
      setSaveMessage(`已保存到 ${target === "project" ? "项目" : "用户"}配置: ${settingsPath}`);
      setState((prev) => ({ ...prev, configHasChanges: false }));

      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(`保存失败: ${error instanceof Error ? error.message : "未知错误"}`);
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // 重置
  const handleReset = async () => {
    try {
      const loaded = await loadJoeSettings();
      const resolved = resolveChatRuntime({ settings: loaded.settings });
      setState((prev) => ({
        ...prev,
        config: {
          provider: resolved.providerName,
          model: resolved.model?.name ?? "",
          permissionMode: resolved.permissionMode,
          maxTurns: loaded.settings.runtime.maxTurns,
          maxSteps: loaded.settings.runtime.maxStepsPerTurn,
          defaultRole: loaded.settings.runtime.defaultRole ?? "",
          childAgentTimeout: loaded.settings.runtime.childAgentTimeout,
          debug: loaded.settings.runtime.debug,
        },
        fullConfig: {
          ...prev.fullConfig,
          providers: loaded.settings.providers,
          models: loaded.settings.models,
          subAgents: loaded.settings.subAgents,
          sources: loaded.sources,
          defaultProvider: loaded.settings.defaultProvider,
        },
        configHasChanges: false,
      }));
      setSaveMessage("已重置");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveMessage("重置失败");
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  // 计算可用高度
  const sectionHeight = height ? Math.floor((height - 8) / SECTIONS.length) : 4;

  const renderSectionHeader = (key: ConfigSection, label: string, color: string, editable: boolean) => {
    const isFocused = focusedSection === key;
    return (
      <Box flexDirection="row" gap={1}>
        <Text bold color={isFocused ? color : "gray"}>
          {isFocused ? "▸ " : "  "}{label}
        </Text>
        {editable && isFocused && !focusedField && (
          <Text dimColor>Enter 编辑</Text>
        )}
        {focusedField && key === "runtime" && (
          <Text dimColor>Enter 下一字段 | Esc 退出编辑</Text>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height={height} width={width} paddingX={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold underline color={state.focusArea === "configList" ? "cyan" : undefined}>
          配置
        </Text>
        {state.configHasChanges && (
          <Text color="yellow"> (未保存)</Text>
        )}
        {state.focusArea === "configList" && (
          <Text dimColor color="cyan"> [焦点]</Text>
        )}
        {saveStatus !== "idle" && (
          <Text color={saveStatus === "saved" ? "green" : saveStatus === "error" ? "red" : "yellow"}>
            {" "} - {saveMessage}
          </Text>
        )}
      </Box>

      {/* Sources 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "sources" ? "double" : "single"}
        borderColor={focusedSection === "sources" ? "cyan" : "gray"}
        paddingX={1}
        marginBottom={1}
        height={sectionHeight}
      >
        {renderSectionHeader("sources", "配置源", "gray", false)}
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="row">
            <Text dimColor>项目: </Text>
            <Text color={state.fullConfig.sources.project ? "green" : "gray"}>
              {state.fullConfig.sources.project ?? "(未配置)"}
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text dimColor>用户: </Text>
            <Text color={state.fullConfig.sources.user ? "green" : "gray"}>
              {state.fullConfig.sources.user ?? "(未配置)"}
            </Text>
          </Box>
        </Box>
        <Text dimColor>优先级: 项目 &gt; 用户 &gt; 默认值</Text>
      </Box>

      {/* Runtime 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "runtime" ? "double" : "single"}
        borderColor={focusedSection === "runtime" ? "cyan" : "gray"}
        paddingX={1}
        marginBottom={1}
        height={sectionHeight}
      >
        {renderSectionHeader("runtime", "Runtime", "green", true)}
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="row">
            <Text dimColor>权限: </Text>
            <Text bold color={focusedField === "permissionMode" ? "yellow" : "green"}>
              {state.config.permissionMode}
            </Text>
            {focusedField === "permissionMode" && <Text color="yellow"> ◀</Text>}
          </Box>
          <Box flexDirection="row">
            <Text dimColor>步骤/轮: </Text>
            <Text bold color={focusedField === "maxSteps" ? "yellow" : undefined}>
              {state.config.maxSteps}
            </Text>
            {focusedField === "maxSteps" && <Text color="yellow"> ◀ ↑/↓</Text>}
          </Box>
          <Box flexDirection="row">
            <Text dimColor>轮次: </Text>
            <Text bold color={focusedField === "maxTurns" ? "yellow" : undefined}>
              {state.config.maxTurns}
            </Text>
            {focusedField === "maxTurns" && <Text color="yellow"> ◀ ↑/↓</Text>}
          </Box>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="row">
            <Text dimColor>默认角色: </Text>
            <Text bold color={focusedField === "defaultRole" ? "yellow" : undefined}>
              {state.config.defaultRole || "(未设置)"}
            </Text>
            {focusedField === "defaultRole" && <Text color="yellow"> ◀ ←/→</Text>}
          </Box>
          <Box flexDirection="row">
            <Text dimColor>超时: </Text>
            <Text bold color={focusedField === "childAgentTimeout" ? "yellow" : undefined}>
              {state.config.childAgentTimeout}ms
            </Text>
            {focusedField === "childAgentTimeout" && <Text color="yellow"> ◀ ↑/↓</Text>}
          </Box>
          <Box flexDirection="row">
            <Text dimColor>Debug: </Text>
            <Text bold color={focusedField === "debug" ? "yellow" : state.config.debug ? "green" : "gray"}>
              {state.config.debug ? "ON" : "OFF"}
            </Text>
            {focusedField === "debug" && <Text color="yellow"> ◀ Enter</Text>}
          </Box>
        </Box>
      </Box>

      {/* Providers 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "providers" ? "double" : "single"}
        borderColor={focusedSection === "providers" ? "cyan" : "gray"}
        paddingX={1}
        marginBottom={1}
        height={sectionHeight}
      >
        {renderSectionHeader("providers", "Providers", "cyan", false)}
        {Object.entries(state.fullConfig.providers).length === 0 ? (
          <Text dimColor>  无已配置的 Provider</Text>
        ) : (
          Object.entries(state.fullConfig.providers).map(([name, cfg]) => (
            <Box key={name} flexDirection="row" gap={1}>
              <Text bold color={name === state.config.provider ? "green" : "cyan"}>{name}</Text>
              <Text dimColor>({cfg.type ?? "unknown"})</Text>
              {cfg.baseUrl && <Text dimColor>{cfg.baseUrl.slice(0, 40)}</Text>}
              {cfg.model && <Text dimColor>model={cfg.model}</Text>}
            </Box>
          ))
        )}
        <Text dimColor>  默认: {state.config.provider}</Text>
      </Box>

      {/* Models 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "models" ? "double" : "single"}
        borderColor={focusedSection === "models" ? "cyan" : "gray"}
        paddingX={1}
        marginBottom={1}
        height={sectionHeight}
      >
        {renderSectionHeader("models", "Models", "yellow", false)}
        {Object.entries(state.fullConfig.models).length === 0 ? (
          <Text dimColor>  无已配置的 Model</Text>
        ) : (
          Object.entries(state.fullConfig.models).map(([name, cfg]) => (
            <Box key={name} flexDirection="row" gap={1}>
              <Text bold color="yellow">{name}</Text>
              <Text dimColor>→</Text>
              <Text>{cfg.model}</Text>
              <Text dimColor>({cfg.provider})</Text>
            </Box>
          ))
        )}
        <Text dimColor>  当前: {state.config.model}</Text>
      </Box>

      {/* Roles 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "subAgents" ? "double" : "single"}
        borderColor={focusedSection === "subAgents" ? "cyan" : "gray"}
        paddingX={1}
        height={sectionHeight}
      >
        {renderSectionHeader("subAgents", "Roles", "magenta", false)}
        {Object.entries(state.fullConfig.subAgents).length === 0 ? (
          <Text dimColor>  无已配置的 Role</Text>
        ) : (
          Object.entries(state.fullConfig.subAgents).map(([name, cfg]) => (
            <Box key={name} flexDirection="row" gap={1}>
              <Text bold color="magenta">{name}</Text>
              <Text dimColor>→</Text>
              <Text>{cfg.model}</Text>
              {cfg.permissionMode && <Text dimColor>({cfg.permissionMode})</Text>}
            </Box>
          ))
        )}
        <Text dimColor>  默认: {state.config.defaultRole || "(未设置)"}</Text>
      </Box>

      {/* 底部操作提示 */}
      <Box flexDirection="row" justifyContent="center" marginTop={1}>
        <Text dimColor>↑/↓ 切换 | </Text>
        {SECTIONS.find((s) => s.key === focusedSection)?.editable && (
          <>
            <Text color={PRIMARY}>Enter 编辑</Text>
            <Text dimColor> | </Text>
          </>
        )}
        <Text bold color="green">Ctrl+S 保存项目</Text>
        <Text dimColor> | </Text>
        <Text bold color="cyan">Ctrl+U 保存用户</Text>
        <Text dimColor> | </Text>
        <Text dimColor>Ctrl+R 重置</Text>
      </Box>
    </Box>
  );
}
