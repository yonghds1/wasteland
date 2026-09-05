/**
 * 废土主题装饰元素。
 *
 * 这些值只控制边框和 ASCII 图形，不承载角色内容。
 */
export const wastelandDecorations = {
  borderStyle: 'single',
  banner: '═'.repeat(48),
  separator: '─',
  bullet: '◆',
  prompt: '❯',
  streamingCursor: '▊',
  ascii: {
    warRig: [
      '      ______________',
      ' ____/ _|_|_|_|_|_ \\____',
      '|__  WASTELAND WAR RIG  __|',
      '   O----------------O',
    ],
  },
} as const;
