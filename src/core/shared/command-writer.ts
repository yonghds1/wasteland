import type { SyncCommandResult } from './command-executor-sync.js';

export interface CommandWriter {
  write(result: SyncCommandResult): void;
  isSkillCommand?(input: string): boolean;
}
