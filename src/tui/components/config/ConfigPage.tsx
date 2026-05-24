/**
 * ConfigPage - 配置页面
 *
 * 可配置区域：
 * 1. Provider - defaultProvider, providers 配置
 * 2. Runtime - permissionMode, maxStepsPerTurn, debug
 * 3. Roles - 角色配置
 */

import React, { useState, useEffect } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import { loadRxcSettings } from "../../../config/load-settings.js";
import { resolveUserSettingsPath, resolveProjectSettingsPath, findProjectConfigDir } from "../../../config/paths.js";
import type { PermissionMode } from "../../../runtime/permission-gate.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type ConfigSection = "provider" | "runtime" | "roles";

interface ConfigPageProps {
  height?: number;
  width?: number;
}

// Provider 选项
const PROVIDER_OPTIONS = ["local", "ollama", "qwen"];

// Permission Mode 选项
const PERMISSION_MODE_OPTIONS: PermissionMode[] = ["default", "accept_edits", "bypass_permissions"];

export function ConfigPage({ height, width }: ConfigPageProps): React.ReactElement {
  const { state, setState, setEditMode, updateConfig } = useAppContext();
  const [focusedSection, setFocusedSection] = useState<ConfigSection>("provider");
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");

  // 监听编辑模式变化
  useEffect(() => {
    setEditMode(focusedField !== null);
  }, [focusedField, setEditMode]);

  // 键盘导航
  useInput((input, key) => {
    // 编辑模式下的键盘处理
    if (focusedField) {
      handleEditModeInput(input, key);
      return;
    }

    // 导航模式
    if (key.upArrow) {
      const sections: ConfigSection[] = ["provider", "runtime", "roles"];
      const idx = sections.indexOf(focusedSection);
      if (idx > 0) setFocusedSection(sections[idx - 1]);
    }
    if (key.downArrow) {
      const sections: ConfigSection[] = ["provider", "runtime", "roles"];
      const idx = sections.indexOf(focusedSection);
      if (idx < sections.length - 1) setFocusedSection(sections[idx + 1]);
    }

    // Enter 进入编辑模式
    if (key.return) {
      if (focusedSection === "provider") {
        setFocusedField("provider");
      } else if (focusedSection === "runtime") {
        // 默认聚焦第一个字段
        setFocusedField("permissionMode");
      } else if (focusedSection === "roles") {
        // Roles 暂不支持编辑
        setSaveMessage("Roles 编辑即将支持");
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }
    }

    // Ctrl+S 保存
    if (input === "s" && key.ctrl) {
      handleSave();
    }

    // Ctrl+R 重置（放弃更改）
    if (input === "r" && key.ctrl) {
      handleReset();
    }
  });

  // 处理编辑模式下的输入
  const handleEditModeInput = (input: string, key: { return: boolean; escape: boolean; upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean }) => {
    // Esc 退出编辑模式
    if (key.escape) {
      setFocusedField(null);
      return;
    }

    // Enter 确认并移动到下一个字段
    if (key.return) {
      if (focusedSection === "runtime") {
        // 在 runtime 区域内移动
        if (focusedField === "permissionMode") {
          setFocusedField("maxSteps");
        } else if (focusedField === "maxSteps") {
          setFocusedField("maxTurns");
        } else {
          setFocusedField(null);
        }
      } else {
        setFocusedField(null);
      }
      return;
    }

    // 字段特定编辑
    if (focusedField === "provider") {
      // 循环切换 provider
      const idx = PROVIDER_OPTIONS.indexOf(state.config.provider);
      const nextIdx = (idx + 1) % PROVIDER_OPTIONS.length;
      updateConfig({ provider: PROVIDER_OPTIONS[nextIdx] });
    } else if (focusedField === "permissionMode") {
      // 循环切换 permissionMode
      const idx = PERMISSION_MODE_OPTIONS.indexOf(state.config.permissionMode as PermissionMode);
      const nextIdx = (idx + 1) % PERMISSION_MODE_OPTIONS.length;
      updateConfig({ permissionMode: PERMISSION_MODE_OPTIONS[nextIdx] });
    } else if (focusedField === "maxSteps") {
      // 上下调整 maxSteps
      if (key.upArrow) {
        const newValue = Math.min(20, state.config.maxSteps + 1);
        updateConfig({ maxSteps: newValue });
      } else if (key.downArrow) {
        const newValue = Math.max(1, state.config.maxSteps - 1);
        updateConfig({ maxSteps: newValue });
      }
    } else if (focusedField === "maxTurns") {
      // 上下调整 maxTurns
      if (key.upArrow) {
        const newValue = Math.min(100, state.config.maxTurns + 1);
        updateConfig({ maxTurns: newValue });
      } else if (key.downArrow) {
        const newValue = Math.max(1, state.config.maxTurns - 1);
        updateConfig({ maxTurns: newValue });
      }
    }
  };

  // 保存配置
  const handleSave = async () => {
    if (!state.configHasChanges) {
      setSaveMessage("没有更改需要保存");
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    setSaveStatus("saving");
    setSaveMessage("正在保存...");

    try {
      // 加载当前配置以获取文件路径
      const cwd = process.cwd();
      const projectConfigDir = await findProjectConfigDir(cwd);
      const settingsPath = projectConfigDir
        ? resolveProjectSettingsPath(projectConfigDir)
        : resolveUserSettingsPath(process.env);

      // 读取现有配置
      let existingSettings = {};
      try {
        const content = await import("node:fs/promises").then(fs => fs.readFile(settingsPath, "utf8"));
        existingSettings = JSON.parse(content);
      } catch {
        // 文件不存在，使用空对象
      }

      // 合并更改
      const newSettings = {
        ...existingSettings,
        defaultProvider: state.config.provider,
        runtime: {
          ...(existingSettings as Record<string, unknown>).runtime as Record<string, unknown> | undefined,
          permissionMode: state.config.permissionMode,
          maxStepsPerTurn: state.config.maxSteps,
        },
      };

      // 确保目录存在
      await mkdir(dirname(settingsPath), { recursive: true });

      // 写入文件
      await writeFile(settingsPath, JSON.stringify(newSettings, null, 2), "utf8");

      setSaveStatus("saved");
      setSaveMessage(`已保存到 ${settingsPath}`);
      setState((prev) => ({ ...prev, configHasChanges: false }));

      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(`保存失败: ${error instanceof Error ? error.message : "未知错误"}`);
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // 重置更改
  const handleReset = async () => {
    try {
      const loaded = await loadRxcSettings();
      setState((prev) => ({
        ...prev,
        config: {
          provider: loaded.settings.defaultProvider,
          model: "default",
          permissionMode: loaded.settings.runtime.permissionMode,
          maxTurns: 50,
          maxSteps: loaded.settings.runtime.maxStepsPerTurn,
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

  // 动态计算每个区域高度
  const sectionHeight = height ? Math.floor((height - 6) / 3) : 5;

  return (
    <Box flexDirection="column" height={height} width={width} paddingX={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold underline>
          配置
        </Text>
        {state.configHasChanges && (
          <Text color="yellow"> (未保存)</Text>
        )}
        {saveStatus !== "idle" && (
          <Text color={saveStatus === "saved" ? "green" : saveStatus === "error" ? "red" : "yellow"}>
            {" "}
            - {saveMessage}
          </Text>
        )}
      </Box>

      {/* Provider 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "provider" ? "double" : "single"}
        borderColor={focusedSection === "provider" ? "cyan" : "gray"}
        paddingX={1}
        marginBottom={1}
        height={sectionHeight}
      >
        <Text bold color="cyan">
          Provider
        </Text>
        <Box flexDirection="row">
          <Text dimColor>默认 Provider: </Text>
          <Text
            bold
            color={focusedField === "provider" ? "yellow" : undefined}
          >
            {state.config.provider}
          </Text>
          {focusedField === "provider" && <Text color="yellow"> ◀</Text>}
        </Box>
        <Box flexDirection="row">
          <Text dimColor>可用: </Text>
          <Text>
            {PROVIDER_OPTIONS.map((p, idx) => (
              <Text
                key={p}
                color={p === state.config.provider ? "green" : undefined}
                bold={p === state.config.provider}
              >
                {idx > 0 ? ", " : ""}
                {p}
              </Text>
            ))}
          </Text>
        </Box>
        <Text dimColor={focusedSection === "provider" && !focusedField} color={focusedSection === "provider" && !focusedField ? "cyan" : undefined}>
          {focusedField === "provider"
            ? "按 Enter 切换 | Esc 取消"
            : "按 Enter 编辑 Provider 设置"}
        </Text>
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
        <Text bold color="green">
          Runtime
        </Text>
        <Box flexDirection="row">
          <Text dimColor>权限模式: </Text>
          <Text
            bold
            color={focusedField === "permissionMode" ? "yellow" : "yellow"}
          >
            {state.config.permissionMode}
          </Text>
          {focusedField === "permissionMode" && <Text color="yellow"> ◀</Text>}
        </Box>
        <Box flexDirection="row">
          <Text dimColor>最大步骤/轮: </Text>
          <Text bold color={focusedField === "maxSteps" ? "yellow" : undefined}>
            {state.config.maxSteps}
          </Text>
          {focusedField === "maxSteps" && (
            <>
              <Text color="yellow"> ◀</Text>
              <Text dimColor> (↑/↓ 调整)</Text>
            </>
          )}
        </Box>
        <Box flexDirection="row">
          <Text dimColor>最大轮次: </Text>
          <Text bold color={focusedField === "maxTurns" ? "yellow" : undefined}>
            {state.config.maxTurns}
          </Text>
          {focusedField === "maxTurns" && (
            <>
              <Text color="yellow"> ◀</Text>
              <Text dimColor> (↑/↓ 调整)</Text>
            </>
          )}
        </Box>
        <Text dimColor={focusedSection === "runtime" && !focusedField} color={focusedSection === "runtime" && !focusedField ? "cyan" : undefined}>
          {focusedField
            ? "按 Enter 确认 | Esc 取消"
            : "按 Enter 编辑 Runtime 设置"}
        </Text>
      </Box>

      {/* Roles 区域 */}
      <Box
        flexDirection="column"
        borderStyle={focusedSection === "roles" ? "double" : "single"}
        borderColor={focusedSection === "roles" ? "cyan" : "gray"}
        paddingX={1}
        height={sectionHeight}
      >
        <Text bold color="magenta">
          Roles
        </Text>
        <Text dimColor>自定义角色配置</Text>
        <Text dimColor>当前角色: default</Text>
        <Text dimColor>即将支持编辑</Text>
      </Box>

      {/* 底部操作提示 */}
      <Box flexDirection="row" justifyContent="center" marginTop={1}>
        <Text dimColor>↑/↓ 切换区域 | Enter 编辑 | </Text>
        <Text bold color="green">Ctrl+S 保存</Text>
        <Text dimColor> | </Text>
        <Text dimColor>Ctrl+R 重置</Text>
      </Box>
    </Box>
  );
}
