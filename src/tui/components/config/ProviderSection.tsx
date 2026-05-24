/**
 * ProviderSection - Provider 配置
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function ProviderSection(): React.ReactElement {
  const { state } = useAppContext();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold underline>
        Provider
      </Text>
      <Box flexDirection="row">
        <Text>Provider: </Text>
        <Text bold color="cyan">{state.config.provider}</Text>
        <Text dimColor> [local ▼]</Text>
      </Box>
      <Box flexDirection="row">
        <Text>Model: </Text>
        <Text>{state.config.model || "default"}</Text>
      </Box>
    </Box>
  );
}
