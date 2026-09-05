/**
 * keymap/__tests__/keymap.test.ts - 键盘分发体系单元测试
 */

import { describe, it, expect } from "vitest";
import type { Key } from "ink";
import { parseKeyCombo, matchesCombo } from "../key-matcher.js";
import { KeymapRegistry } from "../keymap-registry.js";

function makeKey(partial: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...partial,
  } as Key;
}

describe("Key Matcher", () => {
  it("正确解析组合键字符串", () => {
    const shiftTab = parseKeyCombo("shift+tab");
    expect(shiftTab.key).toBe("tab");
    expect(shiftTab.shift).toBe(true);
    expect(shiftTab.rawInput).toBe("\x1b[Z");

    const ctrlC = parseKeyCombo("ctrl+c");
    expect(ctrlC.key).toBe("c");
    expect(ctrlC.ctrl).toBe(true);

    const altEnter = parseKeyCombo("alt+enter");
    expect(altEnter.key).toBe("return");
    expect(altEnter.meta).toBe(true);
  });

  it("精确匹配功能键与 ANSI 码", () => {
    const shiftTab = parseKeyCombo("shift+tab");
    expect(matchesCombo("\x1b[Z", makeKey({ shift: true, tab: true }), shiftTab)).toBe(true);
    expect(matchesCombo("", makeKey({ shift: true, tab: true }), shiftTab)).toBe(true);
    expect(matchesCombo("", makeKey({ tab: true }), shiftTab)).toBe(false);

    const esc = parseKeyCombo("esc");
    expect(matchesCombo("", makeKey({ escape: true }), esc)).toBe(true);
    expect(matchesCombo("q", makeKey(), esc)).toBe(false);
  });
});

describe("KeymapRegistry & Hierarchical Dispatch", () => {
  it("默认注册表包含核心动作", () => {
    const registry = new KeymapRegistry();
    const all = registry.getAll();
    expect(all.some((b) => b.id === "app.cycle_permissions")).toBe(true);
    expect(all.some((b) => b.id === "app.cycle_page")).toBe(true);
    expect(all.some((b) => b.id === "chat.send")).toBe(true);
  });

  it("Tier 1: 模态框激活时仅命中 modal 动作", () => {
    const registry = new KeymapRegistry();

    // 模态激活时按 Esc -> modal.close
    const actionEsc = registry.findAction("", makeKey({ escape: true }), {
      input: "",
      key: makeKey({ escape: true }),
      activeModal: "help",
      inputMode: false,
    });
    expect(actionEsc).toBe("modal.close");

    // 模态激活时按 T (导航按键) -> 被阻断 (返回 null)
    const actionT = registry.findAction("t", makeKey(), {
      input: "t",
      key: makeKey(),
      activeModal: "help",
      inputMode: false,
    });
    expect(actionT).toBeNull();
  });

  it("Tier 2: 焦点组件命中自身 focus 动作", () => {
    const registry = new KeymapRegistry();

    // 在 inputBar 中按 Enter -> chat.send
    const actionEnter = registry.findAction("", makeKey({ return: true }), {
      input: "",
      key: makeKey({ return: true }),
      focusArea: "inputBar",
      inputMode: true,
    });
    expect(actionEnter).toBe("chat.send");

    // 在 inputBar 中按 Left -> 不命中 agentTabs.prev (因为 targetArea 不匹配)
    const actionLeft = registry.findAction("", makeKey({ leftArrow: true }), {
      input: "",
      key: makeKey({ leftArrow: true }),
      focusArea: "inputBar",
      inputMode: true,
    });
    expect(actionLeft).toBeNull();

    // 在 agentTabs 中按 Left -> agent_tabs.prev
    const actionTabsLeft = registry.findAction("", makeKey({ leftArrow: true }), {
      input: "",
      key: makeKey({ leftArrow: true }),
      focusArea: "agentTabs",
      inputMode: false,
    });
    expect(actionTabsLeft).toBe("agent_tabs.prev");
  });

  it("Tier 3: Shift+Tab 权限切换在输入模式与普通模式下均能穿透触发", () => {
    const registry = new KeymapRegistry();

    // 输入模式下按 Shift+Tab
    const actionInInput = registry.findAction("", makeKey({ shift: true, tab: true }), {
      input: "",
      key: makeKey({ shift: true, tab: true }),
      focusArea: "inputBar",
      inputMode: true,
    });
    expect(actionInInput).toBe("app.cycle_permissions");

    // 浏览模式下按 Shift+Tab
    const actionOutInput = registry.findAction("", makeKey({ shift: true, tab: true }), {
      input: "",
      key: makeKey({ shift: true, tab: true }),
      focusArea: "agentTabs",
      inputMode: false,
    });
    expect(actionOutInput).toBe("app.cycle_permissions");
  });

  it("支持加载用户自定义快捷键覆盖", () => {
    const registry = new KeymapRegistry();
    registry.loadUserBindings({
      bindings: {
        "app.cycle_page": "p",
      },
    });

    // 默认 T 不再触发 cycle_page，现在改由 P 触发
    const actionT = registry.findAction("t", makeKey(), {
      input: "t",
      key: makeKey(),
      inputMode: false,
    });
    expect(actionT).toBeNull();

    const actionP = registry.findAction("p", makeKey(), {
      input: "p",
      key: makeKey(),
      inputMode: false,
    });
    expect(actionP).toBe("app.cycle_page");
  });
});
