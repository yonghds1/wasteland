/**
 * sessions.test.js - Sessions 命令测试
 *
 * 测试 sessions 命令的结构和基本功能。
 */

import assert from "node:assert/strict";
import { test, describe, before, after } from "node:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Sessions 命令", () => {
  let createSessionsCommand;

  before(async () => {
    const mod = await import("../../dist/commands/sessions.js");
    createSessionsCommand = mod.createSessionsCommand;
  });

  describe("命令结构", () => {
    test("创建 sessions 命令", () => {
      const command = createSessionsCommand();

      assert.ok(command, "应该创建命令");
      assert.equal(command.name(), "sessions");
      assert.ok(command.description().includes("session"), "描述应该提到 session");
    });

    test("命令有正确的选项", () => {
      const command = createSessionsCommand();
      const options = command.options;

      const optionNames = options.map(o => o.long);
      assert.ok(optionNames.includes("--limit"), "应该有 --limit 选项");
      assert.ok(optionNames.includes("--search"), "应该有 --search 选项");
      assert.ok(optionNames.includes("--provider"), "应该有 --provider 选项");
      assert.ok(optionNames.includes("--mode"), "应该有 --mode 选项");
      assert.ok(optionNames.includes("--sort"), "应该有 --sort 选项");
      assert.ok(optionNames.includes("--json"), "应该有 --json 选项");
    });

    test("命令有 show 子命令", () => {
      const command = createSessionsCommand();
      const subcommands = command.commands;

      const showCommand = subcommands.find(c => c.name() === "show");
      assert.ok(showCommand, "应该有 show 子命令");
      assert.ok(showCommand.description().includes("详情"), "show 描述应该提到详情");
    });

    test("命令有 delete 子命令", () => {
      const command = createSessionsCommand();
      const subcommands = command.commands;

      const deleteCommand = subcommands.find(c => c.name() === "delete");
      assert.ok(deleteCommand, "应该有 delete 子命令");
      assert.ok(deleteCommand.description().includes("删除"), "delete 描述应该提到删除");
    });

    test("命令有 stats 子命令", () => {
      const command = createSessionsCommand();
      const subcommands = command.commands;

      const statsCommand = subcommands.find(c => c.name() === "stats");
      assert.ok(statsCommand, "应该有 stats 子命令");
      assert.ok(statsCommand.description().includes("统计"), "stats 描述应该提到统计");
    });
  });

  describe("Resume 命令", () => {
    let createResumeCommand;

    before(async () => {
      const mod = await import("../../dist/commands/resume.js");
      createResumeCommand = mod.createResumeCommand;
    });

    test("创建 resume 命令", () => {
      const command = createResumeCommand();

      assert.ok(command, "应该创建命令");
      assert.equal(command.name(), "resume");
      assert.ok(command.description().includes("恢复"), "描述应该提到恢复");
    });

    test("命令有正确的选项", () => {
      const command = createResumeCommand();
      const options = command.options;

      const optionNames = options.map(o => o.long);
      assert.ok(optionNames.includes("--message"), "应该有 --message 选项");
      assert.ok(optionNames.includes("--provider"), "应该有 --provider 选项");
      assert.ok(optionNames.includes("--role"), "应该有 --role 选项");
      assert.ok(optionNames.includes("--debug"), "应该有 --debug 选项");
      assert.ok(optionNames.includes("--permission-mode"), "应该有 --permission-mode 选项");
    });

    test("命令接受可选的 session-id 参数", () => {
      const command = createResumeCommand();
      const args = command._args;

      assert.ok(args.length > 0, "应该有参数");
      assert.equal(args[0].required, false, "session-id 参数应该是可选的");
    });
  });
});
