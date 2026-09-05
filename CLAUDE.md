# Wasteland 项目开发指南

## 代码组织约定

### 测试文件
- **位置**：使用 Vitest（`.test.ts`），放在 `src/<module>/__tests__/` 目录
- **导入规则**：从源码导入，不从 `dist/` 导入
- **示例**：
  ```
  src/config/__tests__/load-settings.test.ts
  src/commands/__tests__/skin.test.ts
  ```

### 目录结构
- 新模块遵循 `index.ts` + `__tests__/` 结构
- 现有模块保持原样，不强制重组
- 公共 API 通过 `index.ts` 导出
- 主要模块：`core`（核心运行时）、`providers`（LLM 提供者）、`tools`（工具实现）、`commands`（CLI 命令）、`tui`（TUI 界面）、`config`（配置系统）、`skins`（皮肤系统）、`theme`（主题视觉）、`skills`（技能系统）、`acp`（A2A 协议）、`locales`（国际化）、`ui`（CLI 适配器）

### 文件大小
- 建议单个文件不超过 500 行
- 超标文件记录但不强制拆分

### 导入约定
- 使用相对路径导入
- 类型导入使用 `import type`
- 避免循环依赖

## 测试运行

```bash
npm test                    # 运行所有测试
npx vitest run <file>       # 运行单个测试文件
```

## 构建

```bash
npm run build               # 构建 TypeScript
npm run typecheck           # 类型检查
npm run check:locale-parity # 检查 i18n 一致性
npm run check:contrast      # 检查皮肤对比度
```

## 皮肤系统

- 皮肤定义：`src/skins/default-skins.json`
- 项目配置：`.wasteland/skins.json`
- 默认皮肤：`warlord-stern`（热沙总督）
- 测试：`src/commands/__tests__/skin.test.ts`

## 主题系统

- 颜色：`src/theme/wasteland/colors.ts`
- 装饰：`src/theme/wasteland/decorations.ts`
- 皮肤对比度：`npm run check:contrast`
