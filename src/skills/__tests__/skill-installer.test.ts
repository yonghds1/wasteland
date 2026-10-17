import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { installSkill, removeSkill, listInstalledSkills } from "../skill-installer.js";

describe("skill-installer", () => {
  let testCwd: string;

  beforeEach(async () => {
    testCwd = join(tmpdir(), "wf-test-installer-" + Date.now());
    await mkdir(testCwd, { recursive: true });
  });

  afterEach(async () => {
    await rm(testCwd, { recursive: true, force: true }).catch(() => {});
  });

  it("installs a directory skill with skill.json", async () => {
    const srcDir = join(testCwd, "my-source-skill");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "skill.json"),
      JSON.stringify({ name: "custom-skill", description: "test skill" })
    );

    const result = await installSkill({ source: srcDir, cwd: testCwd });
    expect(result.name).toBe("custom-skill");
    expect(result.format).toBe("json");
    expect(result.targetPath).toBe(join(testCwd, ".wasteland", "skills", "custom-skill"));

    const copiedManifest = JSON.parse(
      await readFile(join(result.targetPath, "skill.json"), "utf8")
    );
    expect(copiedManifest.name).toBe("custom-skill");

    const list = await listInstalledSkills({ cwd: testCwd });
    expect(list.some((s) => s.name === "custom-skill")).toBe(true);

    const removed = await removeSkill("custom-skill", { cwd: testCwd });
    expect(removed).toBe(true);
  });

  it("installs a single .ts skill file", async () => {
    const tsFile = join(testCwd, "single-skill.ts");
    await writeFile(tsFile, "export default {};");

    const result = await installSkill({ source: tsFile, cwd: testCwd });
    expect(result.name).toBe("single-skill");
    expect(result.format).toBe("ts");

    const list = await listInstalledSkills({ cwd: testCwd });
    expect(list.some((s) => s.name === "single-skill")).toBe(true);
  });

  it("rejects directories without skill.json or handler", async () => {
    const invalidDir = join(testCwd, "invalid-skill");
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, "random.txt"), "hello");

    await expect(installSkill({ source: invalidDir, cwd: testCwd })).rejects.toThrow(
      /must contain/
    );
  });
});
