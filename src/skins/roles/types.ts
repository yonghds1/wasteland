/** LLM 可见的角色 persona。 */
export type RolePersona = {
  /** 角色身份。 */
  role: string;
  /** 回答风格。 */
  style: string;
  /** 角色语气。 */
  voice: string;
  /** 不可违反的角色约束。 */
  constraints: readonly string[];
  /** 注入 system message 的完整英文 persona。 */
  fullPrompt: string;
};

/** 角色专属 TUI 文案键。 */
export type RoleUi = {
  /** 角色显示名翻译键。 */
  labelKey: string;
  /** 思考状态翻译键。 */
  thinkingKey: string;
  /** 欢迎语翻译键。 */
  greetingKey: string;
  /** 口头禅数组翻译键。 */
  catchphrasesKey: string;
  /** 错误前缀翻译键。 */
  errorPrefixKey: string;
};

/** 一套完整角色 skin，由英文 persona 与可翻译 UI 文案键组成。 */
export type RoleSkin = {
  /** skin 注册 ID。 */
  id: string;
  /** LLM 可见 persona。 */
  persona: RolePersona;
  /** TUI 文案键。 */
  roleUi: RoleUi;
};
