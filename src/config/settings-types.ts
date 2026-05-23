import type { PermissionMode } from "../runtime/permission-gate.js";

export type AuthRef = {
  $auth: string;
};

export type AuthSettings = Record<string, string>;
export type ProviderSettings = Record<string, unknown>;
export type ModelSettings = {
  provider: string;
  model: string;
  capabilities?: string[];
  [key: string]: unknown;
};
export type RoleSettings = {
  model: string;
  permissionMode?: PermissionMode;
  prompt?: string;
  [key: string]: unknown;
};

export type RawRxcSettings = {
  defaultProvider?: string;
  providers?: Record<string, ProviderSettings>;
  models?: Record<string, ModelSettings>;
  roles?: Record<string, RoleSettings>;
  runtime?: {
    defaultRole?: string;
    permissionMode?: PermissionMode;
    maxStepsPerTurn?: number;
    debug?: boolean;
  };
};

export type ResolvedRxcSettings = {
  defaultProvider: string;
  providers: Record<string, ProviderSettings>;
  models: Record<string, ModelSettings>;
  roles: Record<string, RoleSettings>;
  runtime: {
    defaultRole?: string;
    permissionMode: PermissionMode;
    maxStepsPerTurn: number;
    debug: boolean;
  };
};

export type LoadedRxcSettings = {
  settings: ResolvedRxcSettings;
  sources: {
    user?: string;
    project?: string;
    userAuth?: string;
    projectAuth?: string;
  };
  projectConfigDir: string | null;
  userConfigDir: string;
};

export const DEFAULT_RXC_SETTINGS: ResolvedRxcSettings = {
  defaultProvider: "local",
  providers: {},
  models: {},
  roles: {},
  runtime: {
    defaultRole: undefined,
    permissionMode: "default",
    maxStepsPerTurn: 8,
    debug: false,
  },
};
