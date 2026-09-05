/**
 * 废土主题颜色。
 *
 * 这里只描述 Ink 如何绘制界面，不包含角色、文案或提示词。
 */
export const wastelandColors = {
  primary: '#E6B450',
  secondary: '#D47A3A',
  accent: '#C94F2D',
  muted: '#7D7468',
  border: '#66513A',
  success: '#8FAF5B',
  error: '#D95738',
  warning: '#E0A33A',
  info: '#6E9F9A',
  user: '#E6B450',
  assistant: '#D47A3A',
  tool: '#9B8065',
  system: '#7D7468',
  background: '#18140F',
  backgroundSecondary: '#241D16',
  backgroundDarker: '#100D0A',
  // 07-31: 顶部 top-bar (AgentTabs) 专用 Title 表面色,与主背景 #18140F 同色系微深
  // Hue 34° (与主背景 33° 字面同色系,Wasteland 主题约束 30-40°)
  // Saturation 33% (主背景 23% → +10pp,通道差接近完美等差,视觉是"稍暗"非"更饱和")
  // Lightness 4% (主背景 8% → -4pp / 线性比例 50%,肉眼可辨等级)
  // 与主背景逐通道 RGB Δ (10,9,8)——dark theme 终端下可见级别(经验阈值 ≥ 8)
  // 上一版 #13100B 因 ΔRGB (5,4,4) 不可见被回退,见 .trellis/tasks/07-31-refactor-tui-statusbar/prd.md。
  // primary #E6B450 上的 APCA Lc -66.0(等价于主背景 -65.5,text 阈值满足)。
  // 07-31 statusbar 合并后: 该 token 现在由 AgentTabs (合并前由 StatusBar) 使用。
  titleSurface: '#0E0B07',
  text: '#DED3C4',
  textEmphasized: '#FFF3D6',
  borderNormal: '#66513A',
  borderFocused: '#E6B450',
  borderDim: '#3D3328',
  messageBorderUser: '#E6B450',
  messageBorderAssistant: '#D47A3A',
  messageBorderTool: '#9B8065',
  messageBorderSystem: '#7D7468',
} as const;
