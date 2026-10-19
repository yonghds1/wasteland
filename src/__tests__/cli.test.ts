/**
 * cli.test.ts - CLI 顶层入口与参数路由测试
 *
 * 测试范围：
 * 1. 模块导入期副作用防护（无真实进程执行）；
 * 2. --help 与 --version 正确输出；
 * 3. 未知子命令与无效参数的错误处理及非零退出码；
 * 4. 关键子命令完整注册（chat, tui, logs, init, sessions, config, export 等）；
 * 5. 参数解析与路由策略（resolveEffectiveArgv）。
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Command } from "commander";
import {
  createProgram,
  run,
  resolveEffectiveArgv,
  REGISTERED_SUBCOMMANDS,
} from "../cli.js";
import { initI18n } from "../locales/index.js";

/** 递归为 Command 树注入 exitOverride，确保在测试中以 CommanderError 捕获而非 process.exit */
function enableTestExitOverride(cmd: Command): Command {
  cmd.exitOverride();
  for (const sub of cmd.commands) {
    enableTestExitOverride(sub);
  }
  return cmd;
}

describe("CLI 顶层模块与命令集成", () => {
  beforeAll(async () => {
    // 预先装载 i18n 资源，消除动态命令定义时的 fallback 告警
    await initI18n("en");
  });

  describe("1. 模块导入与无副作用防护", () => {
    it("导入模块不触发真实 run() 执行或进程退出", () => {
      // 验证导出的工厂与核心函数可用，且导入期 process.exitCode 保持未设定/正常
      expect(typeof createProgram).toBe("function");
      expect(typeof run).toBe("function");
      expect(process.exitCode).toBeUndefined();
    });

    it("createProgram 每次调用均返回全新的独立 Command 实例", () => {
      const p1 = createProgram();
      const p2 = createProgram();
      expect(p1).toBeInstanceOf(Command);
      expect(p2).toBeInstanceOf(Command);
      expect(p1).not.toBe(p2);
    });
  });

  describe("2. --help 与 --version 输出规范", () => {
    it("--help 正确输出用法描述与帮助文本且 exitCode 为 0", async () => {
      const program = enableTestExitOverride(createProgram());

      let stdout = "";
      program.configureOutput({
        writeOut: (str) => {
          stdout += str;
        },
      });

      try {
        await program.parseAsync(["node", "wasteland", "--help"]);
      } catch (err: unknown) {
        const error = err as { code: string; exitCode: number };
        expect(error.code).toBe("commander.helpDisplayed");
        expect(error.exitCode).toBe(0);
      }

      expect(stdout).toContain("wasteland");
      expect(stdout).toContain("chat");
      expect(stdout).toContain("config");
      expect(stdout).toContain("tui");
    });

    it("--version 正确输出符合语义化版本的版本号且 exitCode 为 0", async () => {
      const program = enableTestExitOverride(createProgram());

      let stdout = "";
      program.configureOutput({
        writeOut: (str) => {
          stdout += str;
        },
      });

      try {
        await program.parseAsync(["node", "wasteland", "--version"]);
      } catch (err: unknown) {
        const error = err as { code: string; exitCode: number };
        expect(error.code).toBe("commander.version");
        expect(error.exitCode).toBe(0);
      }

      // 版本号符合 x.y.z 格式
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("3. 未知参数与错误处理", () => {
    it("传入未知根选项时抛出 commander.unknownOption 并记录错误输出", async () => {
      const program = enableTestExitOverride(createProgram());

      let stderr = "";
      program.configureOutput({
        writeErr: (str) => {
          stderr += str;
        },
      });

      await expect(
        program.parseAsync(["node", "wasteland", "--unknown-flag-xyz"])
      ).rejects.toMatchObject({
        code: "commander.unknownOption",
        exitCode: 1,
      });

      expect(stderr).toContain("--unknown-flag-xyz");
    });

    it("chat 子命令传入未知选项时同样返回非零退出并提示未知参数", async () => {
      const program = enableTestExitOverride(createProgram());

      let stderr = "";
      const chatCmd = program.commands.find((c) => c.name() === "chat");
      chatCmd?.configureOutput({
        writeErr: (str) => {
          stderr += str;
        },
      });

      await expect(
        program.parseAsync(["node", "wasteland", "chat", "--unsupported-option-abc"])
      ).rejects.toMatchObject({
        code: "commander.unknownOption",
        exitCode: 1,
      });

      expect(stderr).toContain("--unsupported-option-abc");
    });
  });

  describe("4. 关键子命令注册完整性", () => {
    it("包含全部核心子命令：chat, tui, logs, init, sessions, config, export 等", () => {
      const program = createProgram();
      const registeredNames = new Set(program.commands.map((cmd) => cmd.name()));
      const registeredAliases = new Set(program.commands.flatMap((cmd) => cmd.aliases()));

      // 验证主要命令
      expect(registeredNames.has("chat")).toBe(true);
      expect(registeredNames.has("tui")).toBe(true);
      expect(registeredNames.has("logs")).toBe(true);
      expect(registeredNames.has("sessions")).toBe(true);
      expect(registeredNames.has("config")).toBe(true);
      expect(registeredNames.has("export")).toBe(true);
      expect(registeredNames.has("resume")).toBe(true);
      expect(registeredNames.has("skin")).toBe(true);
      expect(registeredNames.has("skills")).toBe(true);
      expect(registeredNames.has("context")).toBe(true);

      // setup 命令及其 init 别名
      expect(registeredNames.has("setup")).toBe(true);
      expect(registeredAliases.has("init")).toBe(true);
    });

    it("REGISTERED_SUBCOMMANDS 集合与路由需求保持一致", () => {
      const expected = [
        "chat",
        "tui",
        "logs",
        "init",
        "setup",
        "sessions",
        "config",
        "export",
        "resume",
        "skin",
        "skills",
        "context",
      ];
      for (const cmd of expected) {
        expect(REGISTERED_SUBCOMMANDS.has(cmd)).toBe(true);
      }
    });
  });

  describe("5. resolveEffectiveArgv 参数解析与路由策略", () => {
    describe("管道直通与默认模式 (cliArgs.length === 0)", () => {
      it("非 TTY（管道输入）时自动追加 chat 进入无头模式，严禁添加 tui", () => {
        const argv = ["node", "wasteland"];
        const resolved = resolveEffectiveArgv(argv, false /* isStdinTTY */);
        expect(resolved).toEqual(["node", "wasteland", "chat"]);
      });

      it("交互式 TTY 时无参数默认启动 tui", () => {
        const argv = ["node", "wasteland"];
        const resolved = resolveEffectiveArgv(argv, true /* isStdinTTY */);
        expect(resolved).toEqual(["node", "wasteland", "tui"]);
      });
    });

    describe("顶层直传 Prompt 支持", () => {
      it("用户直接传文本 prompt 时自动重定向到 chat 执行流程", () => {
        const argv = ["node", "wasteland", "帮我写个函数"];
        const resolved = resolveEffectiveArgv(argv, true);
        expect(resolved).toEqual(["node", "wasteland", "chat", "帮我写个函数"]);
      });

      it("用户直接传 -p / --prompt 时自动重定向到 chat 执行流程", () => {
        const argv = ["node", "wasteland", "-p", "hello"];
        const resolved = resolveEffectiveArgv(argv, true);
        expect(resolved).toEqual(["node", "wasteland", "chat", "-p", "hello"]);
      });

      it("用户直接传 -m / --message 时自动重定向到 chat 执行流程", () => {
        const argv = ["node", "wasteland", "-m", "hello"];
        const resolved = resolveEffectiveArgv(argv, true);
        expect(resolved).toEqual(["node", "wasteland", "chat", "-m", "hello"]);
      });

      it("用户带选项直传 prompt 时（如 --debug）自动重定向到 chat", () => {
        const argv = ["node", "wasteland", "--debug", "帮我写个函数"];
        const resolved = resolveEffectiveArgv(argv, true);
        expect(resolved).toEqual(["node", "wasteland", "chat", "--debug", "帮我写个函数"]);
      });
    });

    describe("已注册子命令与帮助/版本标志透传", () => {
      it("帮助标志 (-h, --help) 不被重定向", () => {
        expect(resolveEffectiveArgv(["node", "wasteland", "--help"], true)).toEqual([
          "node",
          "wasteland",
          "--help",
        ]);
        expect(resolveEffectiveArgv(["node", "wasteland", "-h"], true)).toEqual([
          "node",
          "wasteland",
          "-h",
        ]);
      });

      it("版本标志 (-V, --version) 不被重定向", () => {
        expect(resolveEffectiveArgv(["node", "wasteland", "--version"], true)).toEqual([
          "node",
          "wasteland",
          "--version",
        ]);
        expect(resolveEffectiveArgv(["node", "wasteland", "-V"], true)).toEqual([
          "node",
          "wasteland",
          "-V",
        ]);
      });

      it("所有已注册子命令均保持原样不被重定向", () => {
        for (const cmd of REGISTERED_SUBCOMMANDS) {
          const argv = ["node", "wasteland", cmd, "arg1"];
          expect(resolveEffectiveArgv(argv, true)).toEqual(argv);
        }
      });
    });
  });
});
