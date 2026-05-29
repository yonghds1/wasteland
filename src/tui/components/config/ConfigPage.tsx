/**
 * ConfigPage - 配置说明页面
 *
 * 只读文档视图，展示 settings.json 的配置说明
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import { t } from "../../../locales/index.js";
import {
  PRIMARY,
  SUCCESS,
  WARNING,
  MUTED,
  BORDER,
} from "../../utils/colors.js";

interface ConfigPageProps {
  height?: number;
  width?: number;
}

export function ConfigPage({ height, width }: ConfigPageProps): React.ReactElement {
  const { state } = useAppContext();
  const [activeSection, setActiveSection] = useState(0);
  const sectionsCount = 4;

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setActiveSection((prev) => (prev - 1 + sectionsCount) % sectionsCount);
      } else if (key.downArrow) {
        setActiveSection((prev) => (prev + 1) % sectionsCount);
      }
    },
    { isActive: state.focusArea === "configList" }
  );

  const isFocused = state.focusArea === "configList";

  return (
    <Box
      flexDirection="column"
      height={height}
      width={width}
      paddingX={1}
      borderStyle="single"
      borderColor={isFocused ? "cyan" : "gray"}
    >
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold underline color={isFocused ? "cyan" : PRIMARY}>
          {t("tui.config.title")}
        </Text>
      </Box>

      {/* 配置文件位置 */}
      <Box flexDirection="column" marginBottom={1} borderStyle={activeSection === 0 && isFocused ? "round" : undefined} borderColor="cyan">
        <Text bold color={activeSection === 0 && isFocused ? "cyan" : PRIMARY}>
          {t("tui.config.docs.location.title")}
        </Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold color={SUCCESS}>{t("tui.config.docs.location.project")}</Text>{" "}
            <Text>.wasteland/settings.json</Text>
          </Text>
          <Text>
            <Text bold color={SUCCESS}>{t("tui.config.docs.location.user")}</Text>{" "}
            <Text>~/.wasteland/settings.json</Text>
          </Text>
          <Text dimColor>{t("tui.config.docs.location.priority")}</Text>
        </Box>
      </Box>

      {/* 配置结构 */}
      <Box flexDirection="column" marginBottom={1} borderStyle={activeSection === 1 && isFocused ? "round" : undefined} borderColor="cyan">
        <Text bold color={activeSection === 1 && isFocused ? "cyan" : PRIMARY}>
          {t("tui.config.docs.structure.title")}
        </Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text dimColor>{"{"}</Text>
          <Text>  <Text color={WARNING}>"runtime"</Text>: {"{"}</Text>
          <Text>    <Text color={WARNING}>"defaultRole"</Text>: <Text color={SUCCESS}>"immortan-joe"</Text>,</Text>
          <Text>    <Text color={WARNING}>"permissionMode"</Text>: <Text color={SUCCESS}>"default"</Text>,</Text>
          <Text>    <Text color={WARNING}>"maxStepsPerTurn"</Text>: <Text color={MUTED}>8</Text>,</Text>
          <Text>    <Text color={WARNING}>"maxTurns"</Text>: <Text color={MUTED}>20</Text>,</Text>
          <Text>    <Text color={WARNING}>"debug"</Text>: <Text color={MUTED}>false</Text>,</Text>
          <Text>    <Text color={WARNING}>"language"</Text>: <Text color={SUCCESS}>"en"</Text></Text>
          <Text>  {"}"},</Text>
          <Text>  <Text color={WARNING}>"providers"</Text>: {"{"}</Text>
          <Text>    <Text color={SUCCESS}>"provider-name"</Text>: {"{"}</Text>
          <Text>      <Text color={WARNING}>"type"</Text>: <Text color={SUCCESS}>"openai-compatible"</Text>,</Text>
          <Text>      <Text color={WARNING}>"baseUrl"</Text>: <Text color={SUCCESS}>"https://..."</Text>,</Text>
          <Text>      <Text color={WARNING}>"apiKey"</Text>: <Text color={SUCCESS}>"sk-..."</Text></Text>
          <Text>    {"}"}</Text>
          <Text>  {"}"},</Text>
          <Text>  <Text color={WARNING}>"models"</Text>: {"{"}</Text>
          <Text>    <Text color={SUCCESS}>"model-name"</Text>: {"{"}</Text>
          <Text>      <Text color={WARNING}>"provider"</Text>: <Text color={SUCCESS}>"provider-name"</Text>,</Text>
          <Text>      <Text color={WARNING}>"model"</Text>: <Text color={SUCCESS}>"model-id"</Text></Text>
          <Text>    {"}"}</Text>
          <Text>  {"}"}</Text>
          <Text dimColor>{"}"}</Text>
        </Box>
      </Box>

      {/* 配置项说明 */}
      <Box flexDirection="column" marginBottom={1} borderStyle={activeSection === 2 && isFocused ? "round" : undefined} borderColor="cyan">
        <Text bold color={activeSection === 2 && isFocused ? "cyan" : PRIMARY}>
          {t("tui.config.docs.fields.title")}
        </Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold color={WARNING}>runtime.defaultRole</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.fields.defaultRole")}
          </Text>
          <Text>
            <Text bold color={WARNING}>runtime.permissionMode</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.fields.permissionMode")}
          </Text>
          <Text>
            <Text bold color={WARNING}>runtime.maxStepsPerTurn</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.fields.maxStepsPerTurn")}
          </Text>
          <Text>
            <Text bold color={WARNING}>runtime.language</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.fields.language")}
          </Text>
          <Text>
            <Text bold color={WARNING}>providers.*.type</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.fields.providerType")}
          </Text>
        </Box>
      </Box>

      {/* 环境变量 */}
      <Box flexDirection="column" borderStyle={activeSection === 3 && isFocused ? "round" : undefined} borderColor="cyan">
        <Text bold color={activeSection === 3 && isFocused ? "cyan" : PRIMARY}>
          {t("tui.config.docs.env.title")}
        </Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text bold color={SUCCESS}>WASTELAND_HOME</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.env.home")}
          </Text>
          <Text>
            <Text bold color={SUCCESS}>WASTELAND_PROVIDER</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.env.provider")}
          </Text>
          <Text>
            <Text bold color={SUCCESS}>WASTELAND_DEBUG</Text>{" "}
            <Text dimColor>-</Text>{" "}
            {t("tui.config.docs.env.debug")}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
