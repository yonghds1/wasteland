export type {
  CheckpointMetadata,
  RollbackOptions,
  RollbackResult,
  CheckpointDiffSummary,
  ConflictDetail,
} from './checkpoint-types.js';

export {
  isIgnoredOrSensitive,
  getGitExcludePathspecs,
  computeGitBlobHash,
  checkExternalConflict,
} from './safety-guard.js';

export {
  GitPlumbingDriver,
  gitPlumbingDriver,
  resolveGitContext,
  execGit,
  withTempIndex,
  type GitContext,
} from './git-plumbing-driver.js';

export {
  GitCheckpointManager,
  getCheckpointManager,
  resetCheckpointManager,
} from './checkpoint-manager.js';
