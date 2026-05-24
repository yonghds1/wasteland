/**
 * ConfigPage - 配置页面
 *
 * 可配置区域：
 * 1. Provider - defaultProvider, providers 配置
 * 2. Runtime - permissionMode, maxStepsPerTurn, debug
 * 3. Roles - 角色配置
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";

type ConfigSection = "provider" | "runtime" | "roles";

export function ConfigPage({ height }: { height?: number }): React.ReactElement {
  const { state, setState } = useAppContext();
  const [focusedSection, setFocusedSection] = useState<ConfigSection>("provider");
  const [hasChanges, setHasChanges] = useState(false);

  // 键盘导航
  useInput((input, key) => {
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
    if (input === "s" && key.ctrl) {
      // Ctrl+S 保存
      setHasChanges(false);
    }
    if (input === "r" && key.ctrl) {
      // Ctrl+R 重置
      setHasChanges(false);
    }
  });

  // 动态计算每个区域高度
  const sectionHeight = height ? Math.floor((height - 5) / 3) : 5;

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold underline>
          配置
        </Text>
        {hasChanges && (
          <Text color="yellow"> (未保存)</Text>
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
          <Text bold>{state.config.provider}</Text>
        </Box>
        <Box flexDirection="row">
          <Text dimColor>可用: </Text>
          <Text>local, ollama, qwen</Text>
        </Box>
        <Text dimColor>按 Enter 编辑 Provider 设置</Text>
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
          <Text bold color="yellow">{state.config.permissionMode}</Text>
        </Box>
        <Box flexDirection="row">
          <Text dimColor>最大步骤/轮: </Text>
          <Text bold>{state.config.maxSteps}</Text>
        </Box>
        <Box flexDirection="row">
          <Text dimColor>最大轮次: </Text>
          <Text bold>{state.config.maxTurns}</Text>
        </Box>
        <Text dimColor>按 Enter 编辑 Runtime 设置</Text>
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
        <Text dimColor>按 Enter 编辑 Roles 设置</Text>
      </Box>

      {/* 底部操作提示 */}
      <Box flexDirection="row" justifyContent="center" marginTop={1}>
        <Text dimColor>↑/↓ 切换 | </Text>
        <Text bold color="green">Ctrl+S 保存</Text>
        <Text dimColor> | </Text>
        <Text dimColor>Ctrl+R 重置</Text>
      </Box>
    </Box>
  );
}
