import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MCPServersConfig } from '../tools/mcp/mcp-registry.js';
import type { MCPServerConfig } from '../tools/mcp/mcp-client.js';

/**
 * 解析配置中的环境变量字符串插值:
 * - ${VAR_NAME} -> process.env.VAR_NAME
 * - ${PROJECT_ROOT} -> projectRoot
 */
export function interpolateEnvVars(text: string, projectRoot: string): string {
  return text.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
    if (varName === 'PROJECT_ROOT') {
      return projectRoot;
    }
    return process.env[varName] ?? match;
  });
}

/**
 * 递归解析配置对象中的环境变量占位符
 */
export function resolveConfigEnv(
  config: MCPServerConfig,
  projectRoot: string
): MCPServerConfig {
  const resolved = { ...config };

  if (resolved.command) {
    resolved.command = interpolateEnvVars(resolved.command, projectRoot);
  }
  if (resolved.url) {
    resolved.url = interpolateEnvVars(resolved.url, projectRoot);
  }
  if (resolved.cwd) {
    resolved.cwd = interpolateEnvVars(resolved.cwd, projectRoot);
  }
  if (resolved.args) {
    resolved.args = resolved.args.map((arg) => interpolateEnvVars(arg, projectRoot));
  }
  if (resolved.env) {
    const newEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(resolved.env)) {
      if (typeof v === 'string') {
        newEnv[k] = interpolateEnvVars(v, projectRoot);
      }
    }
    resolved.env = newEnv;
  }

  return resolved;
}

/**
 * 获取全局 MCP 配置文件路径 (~/.wasteland/mcp.json)
 */
export function getGlobalMcpConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const userWasteland = path.join(os.homedir(), '.wasteland');
  if (fs.existsSync(userWasteland)) {
    return path.join(userWasteland, 'mcp.json');
  }
  return path.join(configHome, 'wasteland', 'mcp.json');
}

/**
 * 获取项目级 MCP 配置文件路径 (./.mcp.json 或 ./.wasteland/mcp.json)
 */
export function getProjectMcpConfigPath(projectRoot: string): string | null {
  const p1 = path.join(projectRoot, '.mcp.json');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(projectRoot, '.wasteland', 'mcp.json');
  if (fs.existsSync(p2)) return p2;
  return null;
}

/**
 * 加载并合并所有来源的 MCP 配置 (项目级优先覆盖全局级)
 */
export function loadAllMcpConfigs(projectRoot: string = process.cwd()): MCPServersConfig {
  const result: MCPServersConfig = {};

  // 1. 全局配置
  const globalPath = getGlobalMcpConfigPath();
  if (fs.existsSync(globalPath)) {
    try {
      const raw = fs.readFileSync(globalPath, 'utf8');
      const parsed = JSON.parse(raw) as { mcpServers?: MCPServersConfig };
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
          result[name] = resolveConfigEnv(cfg, projectRoot);
        }
      }
    } catch {
      // 忽略畸变配置
    }
  }

  // 2. 项目级配置
  const projectPath = getProjectMcpConfigPath(projectRoot);
  if (projectPath && fs.existsSync(projectPath)) {
    try {
      const raw = fs.readFileSync(projectPath, 'utf8');
      const parsed = JSON.parse(raw) as { mcpServers?: MCPServersConfig };
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
          result[name] = resolveConfigEnv(cfg, projectRoot);
        }
      }
    } catch {
      // 忽略畸变配置
    }
  }

  return result;
}

/**
 * 保存单个 MCP Server 配置到全局 ~/.wasteland/mcp.json
 */
export function saveGlobalMcpServerConfig(
  name: string,
  serverConfig: MCPServerConfig
): void {
  const configPath = getGlobalMcpConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let current: { mcpServers?: MCPServersConfig } = {};
  if (fs.existsSync(configPath)) {
    try {
      current = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcpServers?: MCPServersConfig };
    } catch {
      current = {};
    }
  }

  if (!current.mcpServers) {
    current.mcpServers = {};
  }

  current.mcpServers[name] = serverConfig;
  fs.writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf8');
}
