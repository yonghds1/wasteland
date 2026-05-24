/**
 * ConfigPage - 配置页面
 */

import React from "react";
import { Text, Box } from "ink";
import { ProviderSection } from "./ProviderSection.js";
import { PermissionSection } from "./PermissionSection.js";
import { SessionSection } from "./SessionSection.js";

interface ConfigPageProps {
  height?: number;
}

export function ConfigPage({ height }: ConfigPageProps): React.ReactElement {
  return (
    <Box flexDirection="column" height={height} paddingX={2}>
      <ProviderSection />
      <PermissionSection />
      <SessionSection />
      <Box flexDirection="row" justifyContent="center" marginTop={1}>
        <Text bold color="green">[Save]</Text>
        <Text> </Text>
        <Text dimColor>[Reset]</Text>
        <Text> </Text>
        <Text dimColor>[Apply]</Text>
      </Box>
    </Box>
  );
}
