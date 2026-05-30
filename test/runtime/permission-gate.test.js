/**
 * permission-gate.test.js - 权限门控测试
 *
 * 测试三种权限模式和自定义规则匹配。
 */

import { describe, it, expect, beforeAll } from "vitest";

let createPermissionGate;

beforeAll(async () => {
  const mod = await import("../../dist/core/runtime/permission-gate.js");
  createPermissionGate = mod.createPermissionGate;
});

describe("PermissionGate", () => {
  describe("default 模式", () => {
    it("允许 read 工具", () => {
      const gate = createPermissionGate({ mode: "default" });
      const result = gate.evaluate({ toolName: "read-file", args: {}, callId: "1" }, "read");
      expect(result.decision).toBe("allow");
      expect(result.mode).toBe("default");
    });

    it("对 execute 工具要求确认", () => {
      const gate = createPermissionGate({ mode: "default" });
      const result = gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute");
      expect(result.decision).toBe("ask");
      expect(result.mode).toBe("default");
    });

    it("对 low 风险工具要求确认", () => {
      const gate = createPermissionGate({ mode: "default" });
      const result = gate.evaluate({ toolName: "ask-user", args: {}, callId: "1" }, "low");
      expect(result.decision).toBe("ask");
      expect(result.mode).toBe("default");
    });
  });

  describe("accept_edits 模式", () => {
    it("允许 read 工具", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate({ toolName: "read-file", args: {}, callId: "1" }, "read");
      expect(result.decision).toBe("allow");
      expect(result.mode).toBe("accept_edits");
    });

    it("允许 low 风险工具", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate({ toolName: "ask-user", args: {}, callId: "1" }, "low");
      expect(result.decision).toBe("allow");
      expect(result.mode).toBe("accept_edits");
    });

    it("对 execute 工具要求确认", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute");
      expect(result.decision).toBe("ask");
      expect(result.mode).toBe("accept_edits");
    });
  });

  describe("bypass_permissions 模式", () => {
    it("允许所有工具", () => {
      const gate = createPermissionGate({ mode: "bypass_permissions" });

      expect(gate.evaluate({ toolName: "read-file", args: {}, callId: "1" }, "read").decision).toBe("allow");
      expect(gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute").decision).toBe("allow");
      expect(gate.evaluate({ toolName: "ask-user", args: {}, callId: "1" }, "low").decision).toBe("allow");
    });
  });

  describe("自定义规则", () => {
    it("按工具名匹配规则", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [{ toolName: "bash", decision: "deny", reason: "禁止 bash" }],
      });
      const result = gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute");
      expect(result.decision).toBe("deny");
      expect(result.reason).toBe("禁止 bash");
    });

    it("按风险等级匹配规则", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [{ riskLevel: "execute", decision: "allow", reason: "允许所有执行" }],
      });
      const result = gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute");
      expect(result.decision).toBe("allow");
      expect(result.reason).toBe("允许所有执行");
    });

    it("规则优先于模式", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [{ toolName: "bash", decision: "allow", reason: "特殊允许" }],
      });
      const result = gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute");
      expect(result.decision).toBe("allow");
      expect(result.reason).toBe("特殊允许");
    });

    it("无匹配规则时使用模式默认行为", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [{ toolName: "bash", decision: "deny" }],
      });
      const result = gate.evaluate({ toolName: "read-file", args: {}, callId: "1" }, "read");
      expect(result.decision).toBe("allow");
    });

    it("多条规则匹配时使用第一条", () => {
      const gate = createPermissionGate({
        mode: "default",
        rules: [
          { riskLevel: "execute", decision: "deny", reason: "第一条规则" },
          { riskLevel: "execute", decision: "allow", reason: "第二条规则" },
        ],
      });
      const result = gate.evaluate({ toolName: "bash", args: {}, callId: "1" }, "execute");
      expect(result.decision).toBe("deny");
      expect(result.reason).toBe("第一条规则");
    });
  });

  describe("默认值", () => {
    it("未指定模式时使用 default", () => {
      const gate = createPermissionGate();
      const result = gate.evaluate({ toolName: "read-file", args: {}, callId: "1" }, "read");
      expect(result.decision).toBe("allow");
      expect(result.mode).toBe("default");
    });

    it("无规则时使用模式默认行为", () => {
      const gate = createPermissionGate({ mode: "accept_edits" });
      const result = gate.evaluate({ toolName: "write-file", args: {}, callId: "1" }, "low");
      expect(result.decision).toBe("allow");
      expect(result.mode).toBe("accept_edits");
    });
  });
});
