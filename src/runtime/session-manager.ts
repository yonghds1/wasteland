import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveDefaultSessionDir } from "../config/paths.js";
import type { RuntimeMode, SessionRecord } from "./event-types.js";

export type SessionMetadata = {
  id: string;
  path: string;
  cwd: string;
  mode: RuntimeMode;
  providerId: string;
};

/**
 * Generates a session ID with timestamp prefix for easy identification.
 * Format: 2026-05-23T14-30-00_abc123
 */
function generateSessionId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const shortId = randomUUID().slice(0, 6);
  return `${timestamp}_${shortId}`;
}

function resolveSessionDir(): string {
  return resolveDefaultSessionDir({
    cwd: process.cwd(),
    projectConfigDir: null,
    env: process.env,
  });
}

export class SessionManager {
  constructor(private readonly sessionDir = resolveSessionDir()) {}

  async startSession(params: {
    cwd: string;
    mode: RuntimeMode;
    providerId: string;
  }): Promise<SessionMetadata> {
    await mkdir(this.sessionDir, { recursive: true });

    const id = generateSessionId();

    return {
      id,
      path: join(this.sessionDir, `${id}.jsonl`),
      cwd: params.cwd,
      mode: params.mode,
      providerId: params.providerId,
    };
  }

  async appendRecord(session: SessionMetadata, record: SessionRecord): Promise<void> {
    await appendFile(session.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}
