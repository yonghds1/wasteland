/**
 * keymap/key-matcher.ts - 键盘组合匹配器
 */

import type { Key } from "ink";
import type { KeyCombo } from "./types.js";

/**
 * 将字符串解析为 KeyCombo 对象
 * 示例: "shift+tab", "ctrl+c", "alt+enter", "esc", "enter", "up"
 */
export function parseKeyCombo(comboStr: string): KeyCombo {
  const parts = comboStr.toLowerCase().trim().split("+");
  const combo: KeyCombo = {};

  for (const part of parts) {
    if (part === "ctrl" || part === "control") {
      combo.ctrl = true;
    } else if (part === "shift") {
      combo.shift = true;
    } else if (part === "alt" || part === "meta" || part === "cmd" || part === "opt") {
      combo.meta = true;
    } else if (part === "esc" || part === "escape") {
      combo.key = "escape";
    } else if (part === "enter" || part === "return") {
      combo.key = "return";
    } else if (part === "tab") {
      combo.key = "tab";
    } else if (part === "backspace" || part === "bs") {
      combo.key = "backspace";
    } else if (part === "delete" || part === "del") {
      combo.key = "delete";
    } else if (part === "up" || part === "uparrow") {
      combo.key = "upArrow";
    } else if (part === "down" || part === "downarrow") {
      combo.key = "downArrow";
    } else if (part === "left" || part === "leftarrow") {
      combo.key = "leftArrow";
    } else if (part === "right" || part === "rightarrow") {
      combo.key = "rightArrow";
    } else if (part === "pageup") {
      combo.key = "pageUp";
    } else if (part === "pagedown") {
      combo.key = "pageDown";
    } else {
      combo.key = part;
    }
  }

  // 特殊处理 shift+tab
  if (combo.shift && combo.key === "tab") {
    combo.rawInput = "\x1b[Z";
  }

  return combo;
}

/**
 * 检查 Ink 捕获的击键是否命中 KeyCombo
 */
export function matchesCombo(input: string, key: Key, combo: KeyCombo): boolean {
  // 1. 原始 ANSI 序列匹配（如 Shift+Tab 触发的 \x1b[Z）
  if (combo.rawInput && input === combo.rawInput) {
    return true;
  }

  // 2. 修饰键状态匹配（未声明则要求为 false，防止 shift+t 误判为 t）
  const expectCtrl = !!combo.ctrl;
  const expectShift = !!combo.shift;
  const expectMeta = !!combo.meta;

  const actualCtrl = !!key.ctrl;
  const actualShift = !!key.shift;
  const actualMeta = !!key.meta;

  if (expectCtrl !== actualCtrl) return false;
  if (expectShift !== actualShift) return false;
  if (expectMeta !== actualMeta) return false;

  // 3. 特殊功能键匹配
  if (combo.key === "escape") return key.escape === true;
  if (combo.key === "return") return key.return === true;
  if (combo.key === "tab") return key.tab === true;
  if (combo.key === "backspace") return key.backspace === true || key.delete === true;
  if (combo.key === "delete") return key.delete === true;
  if (combo.key === "upArrow") return key.upArrow === true;
  if (combo.key === "downArrow") return key.downArrow === true;
  if (combo.key === "leftArrow") return key.leftArrow === true;
  if (combo.key === "rightArrow") return key.rightArrow === true;
  if (combo.key === "pageUp") return key.pageUp === true;
  if (combo.key === "pageDown") return key.pageDown === true;

  // 4. 普通字符匹配（忽略大小写对比）
  if (combo.key && input) {
    return input.toLowerCase() === combo.key.toLowerCase();
  }

  return false;
}
