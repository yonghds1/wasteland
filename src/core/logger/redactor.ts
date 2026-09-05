/**
 * redactor.ts - 敏感字段脱敏器
 *
 * 用途：在 LogEntry 写入文件前，按 denylist 正则把 API key / token / env 密钥等
 * 高敏感字符串替换为占位符，避免 `ChatInputTurn.content` / `tool_result.output`
 * / `tool_call.input` 裸跑密钥。
 *
 * 设计要点：
 * - 每条规则独立（name + pattern + 可选 replacer），便于白名单放弃（Omit 一条规则）。
 * - 替换后保留 `[redacted:<rule-name>]` 前缀，便于审计哪条规则命中。
 * - `redactString` / `redactObject` 永远启用，没有"enabled: false"开关。
 *   FileSink 在 env 决定是否调用，但本模块自身实现永远应用所有规则。
 * - 不修改原对象（深拷贝脱敏版本），避免上游引用被悄悄 mutate。
 *
 * 参考 PRD：
 * - R4: FileSink 支持 redaction（denylist 正则）
 * - R9: 含 prompt 内容的字段经 sink 写入前自动按 denylist mask
 * - ADR-4: Redaction 强制开启
 */

// ============================================================
// 规则类型
// ============================================================

/**
 * 单条脱敏规则。
 *
 * @property name - 规则名（审计用，会出现在 `[redacted:<name>]` 前缀中）
 * @property pattern - 匹配正则（global 标志会被强制加；只匹配第一处由 caller 多次调用）
 * @property replacer - 可选：自定义替换函数。输入 (match, ...captureGroups)，
 *                     返回脱敏后的"裸"字符串（不含 `[redacted:<name>]` 前缀，
 *                     该前缀由 redactString 统一加）。
 *                     不传则默认替换为 `[REDACTED]`。
 */
export type RedactionRule = {
  name: string;
  pattern: RegExp;
  replacer?: (match: string, ...groups: string[]) => string;
};

// ============================================================
// 默认 denylist
// ============================================================

/**
 * 默认 denylist。
 *
 * 覆盖：
 * 1. Authorization header
 * 2. Bearer token
 * 3. _API_KEY 等 env-style 密钥（保留 env 名）
 * 4. OpenAI sk- 前缀
 * 5. Slack xoxb- 前缀
 * 6. GitHub PAT ghp_ 前缀
 * 7. JWT-like 3-segment token
 * 8. PEM private key block
 */
export function defaultRedactionRules(): readonly RedactionRule[] {
  return [
    // 1) Authorization header (贪婪匹配到引号/换行/逗号/分号,避免把 Bearer + token 切开)
    {
      name: 'auth-header',
      pattern: /Authorization\s*:\s*['"]?[^'"\n,;]+['"]?/gi,
      replacer: () => 'Authorization: [REDACTED]',
    },
    // 2) Bearer token
    {
      name: 'bearer-token',
      pattern: /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
      replacer: () => 'Bearer [REDACTED]',
    },
    // 3) _API_KEY env-style
    {
      name: 'env-api-key',
      // Group 1 = env var name; 保留 name 给审计
      pattern: /(\b\w+_API_KEY)\s*[:=]\s*['"]?[^\s'"]+/gi,
      replacer: (_match, envName: string) => `${envName}=[REDACTED]`,
    },
    // 4) OpenAI sk- prefix
    {
      name: 'openai-sk',
      pattern: /sk-[A-Za-z0-9]{20,}/g,
      replacer: () => 'sk-[REDACTED]',
    },
    // 5) Slack xoxb- prefix
    {
      name: 'slack-xoxb',
      pattern: /xoxb-[A-Za-z0-9-]+/g,
      replacer: () => 'xoxb-[REDACTED]',
    },
    // 6) GitHub PAT ghp_ prefix
    {
      name: 'github-pat',
      pattern: /ghp_[A-Za-z0-9]{30,}/g,
      replacer: () => 'ghp_[REDACTED]',
    },
    // 7) JWT-like 3-segment
    {
      name: 'jwt-like',
      pattern: /eyJ[A-Za-z0-9._-]{20,}\.[A-Za-z0-9._-]{20,}\.[A-Za-z0-9._-]{20,}/g,
      replacer: () => '[REDACTED-JWT]',
    },
    // 8) PEM private key block
    {
      name: 'pem-private-key',
      pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
      replacer: () => '[REDACTED-PEM]',
    },
  ];
}

// ============================================================
// String / Object redact
// ============================================================

/**
 * 把字符串中所有 denylist 命中的部分替换为 `[redacted:<name>]<masked>`。
 *
 * @param input - 原始字符串
 * @param rules - 可选自定义规则；不传则用 defaultRedactionRules()
 * @returns 脱敏后的字符串
 */
export function redactString(input: string, rules?: readonly RedactionRule[]): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  const effectiveRules = rules ?? defaultRedactionRules();
  let result = input;
  for (const rule of effectiveRules) {
    // 每个规则保证 global 标志
    const pattern =
      rule.pattern.global || rule.pattern.sticky
        ? rule.pattern
        : new RegExp(rule.pattern.source, rule.pattern.flags + 'g');
    result = result.replace(pattern, (match: string, ...rest: unknown[]) => {
      // rest 末尾两个元素是 offset 与完整 string
      const groups = rest.slice(0, -2) as string[];
      const masked = rule.replacer ? rule.replacer(match, ...groups) : '[REDACTED]';
      return `[redacted:${rule.name}]${masked}`;
    });
  }
  return result;
}

/**
 * 深拷贝一个对象并把所有 string 值用 redactString 处理。
 *
 * 不修改原对象；遇到 object/array 递归拷贝；非 string 标量原样保留。
 *
 * @param input - 任意 JSON-friendly 值
 * @param rules - 可选自定义规则
 * @returns 脱敏后的新对象
 */
export function redactObject<T>(input: T, rules?: readonly RedactionRule[]): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return redactString(input, rules) as unknown as T;
  }
  if (typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item, rules)) as unknown as T;
  }
  // 普通 object：拷贝每个 key
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input as Record<string, unknown>)) {
    const value = (input as Record<string, unknown>)[key];
    out[key] = redactObject(value, rules);
  }
  return out as unknown as T;
}
