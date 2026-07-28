/**
 * 废土主题排版参数。
 *
 * Ink 终端统一使用等宽字体；尺寸值作为支持字号的渲染器的语义基线。
 */
export const wastelandTypography = {
  family: 'monospace',
  weight: {
    regular: 400,
    medium: 500,
    bold: 700,
  },
  size: {
    small: 12,
    body: 14,
    heading: 16,
  },
} as const;
