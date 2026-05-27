/**
 * permission-gate.test.js - 权限门控测试
 *
 * 测试三种权限模式和自定义规则匹配。
 */

import assert from "node:assert/strict";
import { test, describe, before } from "node:test";

describe("PermissionGate", () => {
  let createPermissionGate;

  before(async () => {
    const mod = await import("../../dist/runtime/permission-gate.js");
    createPermissionGate = mod.createPermissionGate;
  });

  describe("default 模式", () => {
    test("允许 read 工具", () => {
      const gate = createPermissionGate({ mode: "default" });
      const result = gate.evaluate(
        { toolName: "read-file", args: {}, callId: "1" },
        "read",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.mode, "default");
    });

    test("对 execute 工具要求确认", () => {
      const gate = createPermissionGate({ mode: "default" });
      const result = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );

      assert.equal(result.decision, "ask");
      assert.equal(result.mode, "default");
    });

    test("对 low 风险工具要求确认", () => {
      const gate = createPermissionGate({ mode: "default" });
      const result = gate.evaluate(
        { toolName: "ask-user", args: {}, callId: "1" },
        "low",
      );

      assert.equal(result.decision, "ask");
      assert.equal(result.mode, "default");
    });
  });

  describe("accept_edits 模式", () => {
    test("允许 read 工具", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate(
        { toolName: "read-file", args: {}, callId: "1" },
        "read",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.mode, "accept_edits");
    });

    test("允许 low 风险工具", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate(
        { toolName: "ask-user", args: {}, callId: "1" },
        "low",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.mode, "accept_edits");
    });

    test("对 execute 工具要求确认", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );

      assert.equal(result.decision, "ask");
      assert.equal(result.mode, "accept_edits");
    });
  });

  describe("bypass_permissions 模式", () => {
    test("允许所有工具", () => {
      const gate = createPermissionGate({ mode: "bypass_permissions" });

      const readResult = gate.evaluate(
        { toolName: "read-file", args: {}, callId: "1" },
        "read",
      );
      assert.equal(readResult.decision, "allow");

      const executeResult = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );
      assert.equal(executeResult.decision, "allow");

      const lowResult = gate.evaluate(
        { toolName: "ask-user", args: {}, callId: "1" },
        "low",
      );
      assert.equal(lowResult.decision, "allow");
    });
  });

  describe("自定义规则", () => {
    test("按工具名匹配规则", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [
          { toolName: "bash", decision: "deny", reason: "禁止 bash" },
        ],
      });

      const result = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );

      assert.equal(result.decision, "deny");
      assert.equal(result.reason, "禁止 bash");
    });

    test("按风险等级匹配规则", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [
          { riskLevel: "execute", decision: "allow", reason: "允许所有执行" },
        ],
      });

      const result = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.reason, "允许所有执行");
    });

    test("规则优先于模式", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [
          { toolName: "bash", decision: "allow", reason: "特殊允许" },
        ],
      });

      // default 模式下 execute 应该 ask，但规则覆盖为 allow
      const result = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.reason, "特殊允许");
    });

    test("无匹配规则时使用模式默认行为", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [
          { toolName: "bash", decision: "deny" },
        ],
      });

      // read-file 不匹配规则，使用 default 模式行为
      const result = gate.evaluate(
        { toolName: "read-file", args: {}, callId: "1" },
        "read",
      );

      assert.equal(result.decision, "allow");
    });

    test("多条规则匹配时使用第一条", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [
          { riskLevel: "execute", decision: "deny", reason: "第一条规则" },
          { riskLevel: "execute", decision: "allow", reason: "第二条规则" },
        ],
      });

      const result = gate.evaluate(
        { toolName: "bash", args: {}, callId: "1" },
        "execute",
      );

      assert.equal(result.decision, "deny");
      assert.equal(result.reason, "第一条规则");
    });
  });

  describe("默认值", () => {
    test("未指定模式时使用 default", () => {
      const gate = createPermissionGate();
      const result = gate.evaluate(
        { toolName: "read-file", args: {}, callId: "1" },
        "read",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.mode, "default");
    });

    test("无规则时使用模式默认行为", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate(
        { toolName: "write-file", args: {}, callId: "1" },
        "low",
      );

      assert.equal(result.decision, "allow");
      assert.equal(result.mode, "accept_edits");
    });
  });
});
