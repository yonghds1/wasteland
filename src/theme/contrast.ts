/**
 * contrast.ts - vendored APCA 0.0.98G-4g contrast calculation.
 *
 * The constants and polarity handling follow the reference apca-w3 algorithm.
 * Keeping this small implementation local avoids a runtime dependency for a
 * build-time validation rule.
 */

/** 对比度校验支持的皮肤颜色角色。 */
export type ContrastRole = 'label' | 'text' | 'thinking';

const APCA = {
  mainTrc: 2.4,
  redCoefficient: 0.2126729,
  greenCoefficient: 0.7151522,
  blueCoefficient: 0.072175,
  normalBackgroundExponent: 0.56,
  normalTextExponent: 0.57,
  reverseTextExponent: 0.62,
  reverseBackgroundExponent: 0.65,
  blackThreshold: 0.022,
  blackClampExponent: 1.414,
  scaleBlackOnWhite: 1.14,
  scaleWhiteOnBlack: 1.14,
  lowContrastOffsetBlackOnWhite: 0.027,
  lowContrastOffsetWhiteOnBlack: 0.027,
  minimumLuminanceDelta: 0.0005,
  lowContrastClip: 0.1,
} as const;

const HEX_COLOR_PATTERN = /^#([\da-f]{6}|[\da-f]{3})$/i;

/** 将 hex 颜色展开并转成 RGB 通道。 */
function parseHex(hex: string): [number, number, number] {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (!match) {
    throw new Error(`Invalid hex color "${hex}"; expected #RGB or #RRGGBB`);
  }

  const compact = match[1];
  const expanded = compact.length === 3
    ? compact.split('').map((channel) => channel + channel).join('')
    : compact;

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

/** 把 sRGB hex 转为 APCA 使用的屏幕亮度 Y。 */
function sRgbToLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex);
  return (
    APCA.redCoefficient * Math.pow(red / 255, APCA.mainTrc)
    + APCA.greenCoefficient * Math.pow(green / 255, APCA.mainTrc)
    + APCA.blueCoefficient * Math.pow(blue / 255, APCA.mainTrc)
  );
}

/** 对接近黑色的亮度应用 APCA soft clamp。 */
function clampBlack(luminance: number): number {
  if (luminance >= APCA.blackThreshold) return luminance;
  return luminance + Math.pow(APCA.blackThreshold - luminance, APCA.blackClampExponent);
}

/**
 * 计算前景色相对背景色的 APCA Lc。
 *
 * 返回带符号数值：深色字/浅色背景为正，浅色字/深色背景为负。
 */
export function apcaContrast(fgHex: string, bgHex: string): number {
  const textLuminance = clampBlack(sRgbToLuminance(fgHex));
  const backgroundLuminance = clampBlack(sRgbToLuminance(bgHex));

  if (Math.abs(backgroundLuminance - textLuminance) < APCA.minimumLuminanceDelta) {
    return 0;
  }

  if (backgroundLuminance > textLuminance) {
    const sapc = (
      Math.pow(backgroundLuminance, APCA.normalBackgroundExponent)
      - Math.pow(textLuminance, APCA.normalTextExponent)
    ) * APCA.scaleBlackOnWhite;

    return sapc < APCA.lowContrastClip
      ? 0
      : (sapc - APCA.lowContrastOffsetBlackOnWhite) * 100;
  }

  const sapc = (
    Math.pow(backgroundLuminance, APCA.reverseBackgroundExponent)
    - Math.pow(textLuminance, APCA.reverseTextExponent)
  ) * APCA.scaleWhiteOnBlack;

  return sapc > -APCA.lowContrastClip
    ? 0
    : (sapc + APCA.lowContrastOffsetWhiteOnBlack) * 100;
}

/**
 * 断言颜色组合达到指定 APCA 绝对 Lc 阈值。
 *
 * @throws 当前景/背景无效或对比度低于阈值时抛出包含 role 和 Lc 的错误。
 */
export function assertContrast(
  fgHex: string,
  bgHex: string,
  minAbsLc: number,
  role: ContrastRole,
): void {
  const lc = apcaContrast(fgHex, bgHex);
  if (Math.abs(lc) < minAbsLc) {
    throw new Error(
      `APCA contrast failed for ${role}: ${fgHex} on ${bgHex} has Lc ${lc.toFixed(1)}; required |Lc| >= ${minAbsLc}`,
    );
  }
}
