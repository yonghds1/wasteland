import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** JSON locale 根对象。 */
type LocaleData = Record<string, unknown>;

/** 两份 locale 之间的键结构差异。 */
export type LocaleParityResult = {
  /** 只存在于第一份 locale 的 leaf key。 */
  missingFromRight: string[];
  /** 只存在于第二份 locale 的 leaf key。 */
  missingFromLeft: string[];
};

/** 递归收集 JSON 对象中的全部 leaf key。 */
export function collectLeafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as LocaleData).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return collectLeafKeys(child, path);
  });
}

/** 比较两份 locale 对象的 leaf key 是否双向一致。 */
export function compareLocaleParity(left: LocaleData, right: LocaleData): LocaleParityResult {
  const leftKeys = new Set(collectLeafKeys(left));
  const rightKeys = new Set(collectLeafKeys(right));

  return {
    missingFromRight: [...leftKeys].filter((key) => !rightKeys.has(key)).sort(),
    missingFromLeft: [...rightKeys].filter((key) => !leftKeys.has(key)).sort(),
  };
}

/** 读取并解析单个 locale JSON 文件。 */
async function readLocale(filePath: string): Promise<LocaleData> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as LocaleData;
}

/** 执行 locale parity 检查，失败时抛出包含文件名和缺失 key 的错误。 */
export async function checkLocaleParity(leftPath: string, rightPath: string): Promise<void> {
  const [left, right] = await Promise.all([readLocale(leftPath), readLocale(rightPath)]);
  const result = compareLocaleParity(left, right);
  const messages: string[] = [];

  for (const key of result.missingFromRight) {
    messages.push(`${rightPath} is missing key: ${key}`);
  }
  for (const key of result.missingFromLeft) {
    messages.push(`${leftPath} is missing key: ${key}`);
  }

  if (messages.length > 0) {
    throw new Error(`Locale parity check failed:\n${messages.join('\n')}`);
  }
}

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const defaultEnglishPath = resolve(scriptDirectory, '../src/locales/en.json');
const defaultChinesePath = resolve(scriptDirectory, '../src/locales/zh.json');

/** CLI 入口。可选路径参数用于独立验证任意两份 locale。 */
async function main(): Promise<void> {
  const leftPath = resolve(process.argv[2] ?? defaultEnglishPath);
  const rightPath = resolve(process.argv[3] ?? defaultChinesePath);
  await checkLocaleParity(leftPath, rightPath);
  console.log(`Locale parity check passed: ${leftPath} <-> ${rightPath}`);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
