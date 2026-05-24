/**
 * PermissionSection - 权限配置
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function PermissionSection(): React.ReactElement {
  const { state } = useAppContext();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold underline>
        Permissions
      </Text>
      <Box flexDirection="row">
        <Text>Mode: </Text>
        <Text bold color="yellow">{state.config.permissionMode}</Text>
      </Box>
      <Text dimColor>[ ] Auto-approve read operations</Text>
      <Text dimColor>[ ] Auto-approve write operations</Text>
    </Box>
  );
}
