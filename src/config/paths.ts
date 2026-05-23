import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const RXC_DIRNAME = ".rxc";
export const SETTINGS_FILENAME = "settings.json";
export const AUTH_FILENAME = "auth.json";
export const SESSIONS_DIRNAME = "sessions";
export const RXC_HOME_ENV = "RXC_HOME";
export const RXC_SESSION_DIR_ENV = "RXC_SESSION_DIR";
export const LEGACY_RX_CLI_SESSION_DIR_ENV = "RX_CLI_SESSION_DIR";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveEnvPath(env: NodeJS.ProcessEnv, key: string): string | null {
  if (typeof env[key] === "string" && env[key]!.trim().length > 0) {
    return resolve(env[key]!);
  }

  return null;
}

export function resolveUserConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configuredHome = resolveEnvPath(env, RXC_HOME_ENV);

  if (configuredHome) {
    return configuredHome;
  }

  return resolve(homedir(), RXC_DIRNAME);
}

export function resolveUserSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveUserConfigDir(env), SETTINGS_FILENAME);
}

export function resolveUserAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveUserConfigDir(env), AUTH_FILENAME);
}

export function resolveProjectSettingsPath(configDir: string): string {
  return join(configDir, SETTINGS_FILENAME);
}

export function resolveProjectAuthPath(configDir: string): string {
  return join(configDir, AUTH_FILENAME);
}

export async function findProjectConfigDir(startCwd: string): Promise<string | null> {
  let currentDir = resolve(startCwd);

  while (true) {
    const candidateDir = join(currentDir, RXC_DIRNAME);
    const settingsPath = resolveProjectSettingsPath(candidateDir);
    const authPath = resolveProjectAuthPath(candidateDir);

    if (await pathExists(settingsPath) || await pathExists(authPath)) {
      return candidateDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function resolveDefaultSessionDir(params: {
  cwd: string;
  projectConfigDir: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;

  const sessionDirOverride = resolveSessionDirOverride(env);

  if (sessionDirOverride) {
    return sessionDirOverride;
  }

  if (params.projectConfigDir) {
    return join(params.projectConfigDir, SESSIONS_DIRNAME);
  }

  return join(resolve(params.cwd), RXC_DIRNAME, SESSIONS_DIRNAME);
}

export function resolveSessionDirOverride(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveEnvPath(env, RXC_SESSION_DIR_ENV)
    ?? resolveEnvPath(env, LEGACY_RX_CLI_SESSION_DIR_ENV);
}

export const TRACES_DIRNAME = "traces";

export function resolveDefaultTraceDir(params: {
  cwd: string;
  projectConfigDir: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  if (params.projectConfigDir) {
    return join(params.projectConfigDir, TRACES_DIRNAME);
  }

  return join(resolve(params.cwd), RXC_DIRNAME, TRACES_DIRNAME);
}
