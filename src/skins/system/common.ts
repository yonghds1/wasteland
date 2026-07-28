/**
 * 系统级 skin 文案键。
 *
 * 系统级内容不依赖任何角色；调用方必须通过 t() 在渲染时解析这些键。
 */
export const systemCommon = {
  labels: {
    user: 'skins.system.labels.user',
    system: 'skins.system.labels.system',
    tool: 'skins.system.labels.tool',
    error: 'skins.system.labels.error',
    success: 'skins.system.labels.success',
    warn: 'skins.system.labels.warn',
    userName: 'skins.system.labels.userName',
    session: 'skins.system.labels.session',
  },
  messages: {
    noResponse: 'skins.system.messages.noResponse',
    executionFailed: 'skins.system.messages.executionFailed',
    executionComplete: 'skins.system.messages.executionComplete',
    spawnAgentHandled: 'skins.system.messages.spawnAgentHandled',
    toolRegistry: 'skins.system.messages.toolRegistry',
    startupFailed: 'skins.system.messages.startupFailed',
  },
} as const;
