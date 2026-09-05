/**
 * keymap/keymap-registry.ts - 快捷键注册表与层级决策中枢
 */

import type { Key } from "ink";
import type { KeybindingDefinition, KeyHandlerContext, UserKeybindingsConfig } from "./types.js";
import { matchesCombo, parseKeyCombo } from "./key-matcher.js";

/**
 * 默认快捷键清单（开箱即用，已对齐 Claude Code 与 Wasteland TUI 规范）
 */
export const DEFAULT_KEYBINDINGS: KeybindingDefinition[] = [
  // ─── Tier 1: Modal & Global Force ──────────────
  {
    id: "app.force_exit",
    combos: [parseKeyCombo("ctrl+c")],
    scope: "modal",
    description: "全局强制退出/打开退出确认",
  },
  {
    id: "modal.close",
    combos: [parseKeyCombo("escape")],
    scope: "modal",
    description: "关闭当前弹窗或帮助视图",
  },

  // ─── Tier 2: Focus / Input Context ────────────
  {
    id: "chat.send",
    combos: [parseKeyCombo("enter")],
    scope: "focus",
    targetArea: "inputBar",
    description: "发送输入框消息",
  },
  {
    id: "chat.newline",
    combos: [parseKeyCombo("shift+enter"), parseKeyCombo("alt+enter")],
    scope: "focus",
    targetArea: "inputBar",
    description: "输入框换行",
  },
  {
    id: "chat.blur",
    combos: [parseKeyCombo("escape")],
    scope: "focus",
    targetArea: "inputBar",
    description: "退出输入模式并切到 Agent 标签栏",
  },
  {
    id: "agent_tabs.prev",
    combos: [parseKeyCombo("left"), parseKeyCombo("h")],
    scope: "focus",
    targetArea: "agentTabs",
    description: "切换到上一个 Agent 标签",
  },
  {
    id: "agent_tabs.next",
    combos: [parseKeyCombo("right"), parseKeyCombo("l")],
    scope: "focus",
    targetArea: "agentTabs",
    description: "切换到下一个 Agent 标签",
  },
  {
    id: "agent_tabs.select",
    combos: [parseKeyCombo("enter")],
    scope: "focus",
    targetArea: "agentTabs",
    description: "过滤当前 Agent 消息",
  },

  // ─── Tier 3: Navigation & Control ─────────────
  {
    id: "app.cycle_permissions",
    combos: [parseKeyCombo("shift+tab")],
    scope: "navigation",
    description: "全局循环切换权限模式 (default -> accept_edits -> bypass)",
  },
  {
    id: "app.cycle_page",
    combos: [parseKeyCombo("t")],
    scope: "navigation",
    description: "循环切换主页面 (Chat -> Logs -> Sessions)",
  },
  {
    id: "app.quit",
    combos: [parseKeyCombo("q")],
    scope: "navigation",
    description: "退出程序",
  },
];

/**
 * 快捷键注册中心
 */
export class KeymapRegistry {
  private bindings: Map<string, KeybindingDefinition> = new Map();

  constructor(initialBindings: KeybindingDefinition[] = DEFAULT_KEYBINDINGS) {
    for (const b of initialBindings) {
      this.bindings.set(b.id, { ...b });
    }
  }

  /**
   * 注册或覆盖按键定义
   */
  public register(binding: KeybindingDefinition): void {
    this.bindings.set(binding.id, binding);
  }

  /**
   * 获取所有注册项
   */
  public getAll(): KeybindingDefinition[] {
    return Array.from(this.bindings.values());
  }

  /**
   * 应用用户自定义配置 (~/.wasteland/keybindings.json)
   */
  public loadUserBindings(userConfig?: UserKeybindingsConfig): void {
    if (!userConfig?.bindings) return;

    for (const [actionId, comboValue] of Object.entries(userConfig.bindings)) {
      const existing = this.bindings.get(actionId);
      if (!existing) continue;

      const rawCombos = Array.isArray(comboValue) ? comboValue : [comboValue];
      const parsedCombos = rawCombos.map((s) => parseKeyCombo(s));

      this.bindings.set(actionId, {
        ...existing,
        combos: parsedCombos,
      });
    }
  }

  /**
   * 核心分发决策：根据上下文与三层优先级匹配动作 ID
   */
  public findAction(input: string, key: Key, context: KeyHandlerContext): string | null {
    const { activeModal, focusArea, inputMode } = context;

    // ── Tier 1: 模态框激活时，仅响应 modal 作用域动作 ──
    if (activeModal) {
      for (const b of this.bindings.values()) {
        if (b.scope === "modal") {
          for (const c of b.combos) {
            if (matchesCombo(input, key, c)) {
              return b.id;
            }
          }
        }
      }
      return null;
    }

    // 无论是否输入模式，全局强制动作（如 Ctrl+C）始终生效
    for (const b of this.bindings.values()) {
      if (b.id === "app.force_exit") {
        for (const c of b.combos) {
          if (matchesCombo(input, key, c)) {
            return b.id;
          }
        }
      }
    }

    // ── 允许在输入模式下穿透的全局快捷键（如 Shift+Tab 权限切换） ──
    const allowedInInput = ["app.cycle_permissions"];
    for (const actionId of allowedInInput) {
      const b = this.bindings.get(actionId);
      if (b) {
        for (const c of b.combos) {
          if (matchesCombo(input, key, c)) {
            return b.id;
          }
        }
      }
    }

    // ── Tier 2: 焦点组件层（Focus Area 独占） ──
    if (focusArea) {
      for (const b of this.bindings.values()) {
        if (b.scope === "focus" && b.targetArea === focusArea) {
          for (const c of b.combos) {
            if (matchesCombo(input, key, c)) {
              return b.id;
            }
          }
        }
      }
    }

    // ── Tier 3: 通用导航层（非输入模式下生效，防止打字字符被误吃） ──
    if (!inputMode) {
      for (const b of this.bindings.values()) {
        if (b.scope === "navigation") {
          for (const c of b.combos) {
            if (matchesCombo(input, key, c)) {
              return b.id;
            }
          }
        }
      }
    }

    return null;
  }
}

let globalKeymapRegistry: KeymapRegistry | null = null;

export function getKeymapRegistry(): KeymapRegistry {
  if (!globalKeymapRegistry) {
    globalKeymapRegistry = new KeymapRegistry();
  }
  return globalKeymapRegistry;
}
