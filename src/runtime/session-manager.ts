import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RuntimeMode, SessionRecord } from "./event-types.js";

export type SessionMetadata = {
  id: string;
  path: string;
  cwd: string;
  mode: RuntimeMode;
  providerId: string;
};

function resolveSessionDir(): string {
  if (process.env.RX_CLI_SESSION_DIR) {
    return resolve(process.env.RX_CLI_SESSION_DIR);
  }

  return resolve(process.cwd(), ".rx-cli", "sessions");
}

export class SessionManager {
  constructor(private readonly sessionDir = resolveSessionDir()) {}

  async startSession(params: {
    cwd: string;
    mode: RuntimeMode;
    providerId: string;
  }): Promise<SessionMetadata> {
    await mkdir(this.sessionDir, { recursive: true });

    const id = randomUUID();

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
