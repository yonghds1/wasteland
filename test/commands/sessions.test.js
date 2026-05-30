/**
 * sessions.test.js - Sessions 命令测试
 *
 * 测试 sessions 命令的结构和基本功能。
 */

import { describe, it, expect, beforeAll } from "vitest";

let createSessionsCommand;
let createResumeCommand;

beforeAll(async () => {
  const sessionsMod = await import("../../dist/commands/sessions.js");
  createSessionsCommand = sessionsMod.createSessionsCommand;

  const resumeMod = await import("../../dist/commands/resume.js");
  createResumeCommand = resumeMod.createResumeCommand;
});

describe("Sessions 命令", () => {
  describe("命令结构", () => {
    it("创建 sessions 命令", () => {
      const command = createSessionsCommand();
      expect(command).toBeTruthy();
      expect(command.name()).toBe("sessions");
      expect(command.description()).toContain("session");
    });

    it("命令有正确的选项", () => {
      const command = createSessionsCommand();
      const optionNames = command.options.map(o => o.long);

      expect(optionNames).toContain("--limit");
      expect(optionNames).toContain("--search");
      expect(optionNames).toContain("--provider");
      expect(optionNames).toContain("--mode");
      expect(optionNames).toContain("--sort");
      expect(optionNames).toContain("--json");
    });

    it("命令有 show 子命令", () => {
      const command = createSessionsCommand();
      const showCommand = command.commands.find(c => c.name() === "show");
      expect(showCommand).toBeTruthy();
    });

    it("命令有 delete 子命令", () => {
      const command = createSessionsCommand();
      const deleteCommand = command.commands.find(c => c.name() === "delete");
      expect(deleteCommand).toBeTruthy();
    });

    it("命令有 stats 子命令", () => {
      const command = createSessionsCommand();
      const statsCommand = command.commands.find(c => c.name() === "stats");
      expect(statsCommand).toBeTruthy();
    });
  });

  describe("Resume 命令", () => {
    it("创建 resume 命令", () => {
      const command = createResumeCommand();
      expect(command).toBeTruthy();
      expect(command.name()).toBe("resume");
    });

    it("命令有正确的选项", () => {
      const command = createResumeCommand();
      const optionNames = command.options.map(o => o.long);

      expect(optionNames).toContain("--message");
      expect(optionNames).toContain("--provider");
      expect(optionNames).toContain("--role");
      expect(optionNames).toContain("--debug");
      expect(optionNames).toContain("--permission-mode");
    });

    it("命令接受可选的 session-id 参数", () => {
      const command = createResumeCommand();
      const args = command._args;
      expect(args.length).toBeGreaterThan(0);
      expect(args[0].required).toBe(false);
    });
  });
});
