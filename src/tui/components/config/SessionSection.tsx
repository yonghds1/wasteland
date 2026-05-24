/**
 * SessionSection - Session 配置
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function SessionSection(): React.ReactElement {
  const { state } = useAppContext();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold underline>
        Session
      </Text>
      <Box flexDirection="row">
        <Text>Max Turns: </Text>
        <Text>{state.config.maxTurns}</Text>
      </Box>
      <Box flexDirection="row">
        <Text>Max Steps: </Text>
        <Text>{state.config.maxSteps}</Text>
      </Box>
      <Box flexDirection="row">
        <Text>Timeout: </Text>
        <Text>60000 ms</Text>
      </Box>
    </Box>
  );
}
