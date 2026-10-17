import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SkillInstallOptions {
  source: string;
  global?: boolean;
  cwd?: string;
}

export interface SkillInstallResult {
  name: string;
  targetPath: string;
  format: string;
}

export interface InstalledSkillEntry {
  name: string;
  path: string;
  scope: "project" | "global";
}

export interface ScopeOptions {
  global?: boolean;
  cwd?: string;
}

function targetRoot(options: ScopeOptions): string {
  return join(options.global ? homedir() : (options.cwd ?? process.cwd()), ".wasteland", "skills");
}

function isGitRepo(source: string): boolean {
  return (
    source.includes("github.com") ||
    source.endsWith(".git") ||
    /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source)
  );
}

function normalizeRepoUrl(source: string): string {
  if (source.includes("://")) {
    return source;
  }
  return "https://github.com/" + source.replace(/\.git$/, "") + ".git";
}

async function inspectSkillSource(sourcePath: string): Promise<{ root: string; name: string; format: string }> {
  const stats = await stat(sourcePath);

  if (stats.isFile()) {
    const ext = extname(sourcePath).toLowerCase();
    if (![".json", ".ts", ".js"].includes(ext)) {
      throw new Error("Invalid skill file \"" + sourcePath + "\": expected .json, .ts, or .js");
    }

    let name: string = basename(sourcePath, ext);
    if (ext === ".json") {
      const raw = JSON.parse(await readFile(sourcePath, "utf8")) as { name?: string };
      if (typeof raw.name === "string" && raw.name.length > 0) {
        name = raw.name;
      }
    }

    if (!name) {
      throw new Error("Invalid skill: unable to determine name from " + sourcePath);
    }

    return { root: sourcePath, name, format: ext.slice(1) };
  }

  const entries = await readdir(sourcePath);
  if (entries.includes("skill.json")) {
    const raw = JSON.parse(await readFile(join(sourcePath, "skill.json"), "utf8")) as { name?: string };
    if (!raw.name) {
      throw new Error("Invalid skill: skill.json missing \"name\" field");
    }
    return { root: sourcePath, name: raw.name, format: "json" };
  }

  const handler = entries.find((e) => e === "handler.ts" || e === "handler.js");
  if (handler) {
    const ext = extname(handler);
    return { root: sourcePath, name: basename(sourcePath), format: ext.slice(1) };
  }

  throw new Error("Invalid skill directory \"" + sourcePath + "\": must contain skill.json or handler.ts/handler.js");
}

export async function installSkill(options: SkillInstallOptions): Promise<SkillInstallResult> {
  const source = options.source.trim();
  const resolvedLocal = source.startsWith("~")
    ? join(homedir(), source.slice(2))
    : resolve(options.cwd ?? process.cwd(), source);

  const isLocal =
    !isGitRepo(source) &&
    (source.startsWith(".") || source.startsWith("/") || source.startsWith("~") || existsSync(resolvedLocal));

  let tempDir: string | undefined;
  let sourceRoot = resolvedLocal;

  if (!isLocal) {
    tempDir = join(tmpdir(), "wasteland-skill-" + Date.now());
    await execFileAsync("git", ["clone", "--depth", "1", normalizeRepoUrl(source), tempDir]);
    sourceRoot = tempDir;
  }

  try {
    const meta = await inspectSkillSource(sourceRoot);
    const destDir = targetRoot(options);
    const targetPath = join(destDir, meta.name);

    await mkdir(destDir, { recursive: true });
    await rm(targetPath, { recursive: true, force: true });
    await cp(meta.root, targetPath, { recursive: true });

    return {
      name: meta.name,
      targetPath,
      format: meta.format,
    };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function removeSkill(name: string, options: ScopeOptions = {}): Promise<boolean> {
  const targetPath = join(targetRoot(options), name);
  if (!existsSync(targetPath)) {
    return false;
  }
  await rm(targetPath, { recursive: true, force: true });
  return true;
}

export async function listInstalledSkills(
  options: { cwd?: string } = {}
): Promise<InstalledSkillEntry[]> {
  const results: InstalledSkillEntry[] = [];
  const scopes: Array<[string, "project" | "global"]> = [
    [targetRoot({ cwd: options.cwd }), "project"],
    [targetRoot({ global: true }), "global"],
  ];

  for (const [dir, scope] of scopes) {
    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        results.push({
          name: item.name,
          path: join(dir, item.name),
          scope,
        });
      }
    } catch {
      // ignore
    }
  }

  return results;
}
