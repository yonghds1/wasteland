/**
 * variable-interpolator.ts - 变量插值器
 *
 * 支持 {{variable}} 语法的变量插值，复用 skill-discovery.ts 的实现模式。
 *
 * 支持语法：
 * - {{variable}} - 简单变量
 * - {{nested.path}} - 嵌套路径
 * - {{variable|default:value}} - 带默认值
 */

// ============================================================
// 嵌套值获取
// ============================================================

/** 禁止访问的属性名（防止原型链注入，如 {{__proto__}}） */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 从对象中获取嵌套路径的值
 *
 * @param obj - 源对象
 * @param path - 点分隔的路径，如 "nested.path"
 * @returns 找到的值或 undefined
 *
 * @example
 * getNestedValue({ a: { b: 1 } }, "a.b") // 1
 * getNestedValue({ a: { b: 1 } }, "a.c") // undefined
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    // 阻止原型链访问，防止 {{__proto__}} / {{constructor.prototype}} 等注入
    if (FORBIDDEN_KEYS.has(key)) {
      return undefined;
    }
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// ============================================================
// 变量插值
// ============================================================

/**
 * 执行变量插值
 *
 * 支持：
 * - {{variable}} - 简单变量
 * - {{nested.path}} - 嵌套路径
 * - {{variable|default:value}} - 带默认值（如果变量未定义则使用默认值）
 *
 * @param template - 模板字符串
 * @param variables - 变量对象
 * @returns 插值后的字符串
 *
 * @example
 * interpolateVariables("Hello, {{name}}!", { name: "World" })
 * // "Hello, World!"
 *
 * interpolateVariables("Value: {{x|default:10}}", {})
 * // "Value: 10"
 */
export function interpolateVariables(template: string, variables: Record<string, unknown>): string {
  // 匹配 {{variable}} 或 {{variable|default:value}}
  return template.replace(
    /\{\{([\w.]+)(?:\|default:([^}]*))?\}\}/g,
    (_, path: string, defaultValue: string | undefined) => {
      const value = getNestedValue(variables, path);

      if (value !== undefined && value !== null) {
        // 数组转为换行分隔的字符串
        if (Array.isArray(value)) {
          return value.join('\n');
        }
        // 对象转为 JSON
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return String(value);
      }

      // 使用默认值
      if (defaultValue !== undefined) {
        return defaultValue;
      }

      // 保留未定义的变量（方便调试）
      return `{{${path}}}`;
    }
  );
}

// ============================================================
// 批量插值
// ============================================================

/**
 * 对对象的所有字符串值执行插值
 *
 * @param obj - 源对象
 * @param variables - 变量对象
 * @returns 插值后的对象
 */
export function interpolateObject(
  obj: Record<string, unknown>,
  variables: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = interpolateVariables(value, variables);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = interpolateObject(value as Record<string, unknown>, variables);
    } else {
      result[key] = value;
    }
  }

  return result;
}
