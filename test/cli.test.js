import { describe, it, expect } from "vitest";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const srcCliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsxCliPath = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const isolatedHomeDir = path.join(os.tmpdir(), `joe-test-home-${process.pid}`);

// Helper: build CLI command args using tsx to run from source
function cliArgs(...args) {
  return [tsxCliPath, srcCliPath, ...args];
}

function createCleanEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };

  delete env.JOE_PROVIDER;
  delete env.JOE_PERMISSION_MODE;
  delete env.JOE_MAX_STEPS_PER_TURN;
  delete env.JOE_DEBUG;
  delete env.JOE_HOME;
  delete env.JOE_SESSION_DIR;
  delete env.RX_CLI_SESSION_DIR;
  delete env.OPENAI_API_KEY;

  return {
    ...env,
    HOME: isolatedHomeDir,
    USERPROFILE: isolatedHomeDir,
    ...overrides,
  };
}

async function writeJsonFile(targetPath, value) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createJsonServer(handler) {
  const server = createServer(async (request, response) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", async () => {
      try {
        await handler(request, body, response);
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(undefined));
    server.on("error", reject);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("测试 HTTP server 未返回可用端口。");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(undefined);
        });
      });
    },
  };
}

function runCliWithInput(args, input, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgs(...args), {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`CLI exited with code ${code}\nSTDERR:\n${stderr}`));
    });

    child.stdin.end(input);
  });
}

it("shows help output", async () => {
  const { stdout } = await execFileAsync(process.execPath, cliArgs("--help"));

  expect(stdout).toMatch(/Usage: joe/);
  expect(stdout).toMatch(/chat/);
  expect(stdout).toMatch(/config/);
  expect(stdout).toMatch(/current/);
});

it("fails before entering runtime when provider is unsupported", async () => {
  await expect(
    execFileAsync(process.execPath, cliArgs("chat", "--provider", "missing", "--message", "你好")),
  ).rejects.toThrow(/当前不支持 provider: missing/);
});

it("prints the rxjs chat reply for one-shot input", async () => {
  const { stdout } = await execFileAsync(process.execPath, cliArgs("chat", "--provider", "local", "--message", "你好"));

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：你好");
});

it("reads stdin through the same runtime path", async () => {
  const { stdout } = await runCliWithInput(["chat", "--provider", "local"], "hello");

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：hello");
});

it("persists a local session transcript for one-shot chat", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-session-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(process.execPath, cliArgs("chat", "--provider", "local", "--message", "你好"), {
    env,
  });

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：你好");

  const files = await readdir(sessionDir);

  expect(files.length).toBe(1);

  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  expect(transcript).toMatch(/"type":"session"/);
  expect(transcript).toMatch(/"role":"user"/);
  expect(transcript).toMatch(/"role":"assistant"/);
  expect(transcript).toMatch(/"type":"session_end"/);
});

it("supports legacy RX_CLI_SESSION_DIR for session transcript output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-session-legacy-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RX_CLI_SESSION_DIR: sessionDir,
  });

  await execFileAsync(process.execPath, cliArgs("chat", "--message", "你好"), {
    cwd: tempRoot,
    env,
  });

  const files = await readdir(sessionDir);

  expect(files.length).toBe(1);
});

it("routes a local tool call through the main chat runtime path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-read-file-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  await writeFile(path.join(tempRoot, "note.txt"), "hello from tool\n", "utf8");

  const { stdout } = await execFileAsync(process.execPath, cliArgs("chat", "--message", "/read note.txt"), {
    cwd: tempRoot,
    env,
  });

  expect(stdout).toMatch(/tool\[1\]> request read-file/);
  expect(stdout).toMatch(/permission\[1\]> read-file: allow \(default\)/);
  expect(stdout).toMatch(/tool\[1\]> start read-file/);
  // 新格式包含文件元数据头和行号
  expect(stdout).toMatch(/tool\[1\]> result read-file: 📄 note\.txt/);
  expect(stdout).toMatch(/1│hello from tool/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 read-file 已完成。/);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  expect(transcript).toMatch(/"type":"tool_call"/);
  expect(transcript).toMatch(/"type":"permission"/);
  expect(transcript).toMatch(/"type":"tool_result"/);
  expect(transcript).toMatch(/"toolName":"read-file"/);
});

it("blocks execute-risk tools in default permission mode", async () => {
  const { stdout } = await execFileAsync(process.execPath, cliArgs("chat", "--provider", "local", "--message", "/bash pwd"));

  expect(stdout).toMatch(/tool\[1\]> request bash/);
  expect(stdout).toMatch(/permission\[1\]> bash: ask \(default\)/);
  expect(stdout).toMatch(/tool\[1\]> failed bash: 模式 default 对 execute 工具要求确认。/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 bash 未执行：模式 default 对 execute 工具要求确认。/);
});

it("allows execute-risk tools in bypass_permissions mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-bash-tool-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/bash pwd"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request bash/);
  expect(stdout).toMatch(/permission\[1\]> bash: allow \(bypass_permissions\)/);
  expect(stdout).toMatch(/tool\[1\]> start bash/);
  expect(stdout).toMatch(new RegExp(`tool\\[1\\]> result bash: ${tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  expect(stdout).toMatch(/assistant\[1\]> 工具 bash 已完成。/);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  expect(transcript).toMatch(/"toolName":"bash"/);
  expect(transcript).toMatch(/"status":"success"/);
});

it("renders debug trace to stderr without polluting stdout", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-debug-trace-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  await writeFile(path.join(tempRoot, "note.txt"), "hello from tool\n", "utf8");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--debug", "--message", "/read note.txt"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request read-file/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 read-file 已完成。/);
  expect(stdout).not.toMatch(/trace /);
  expect(stderr).toMatch(/trace session\.start mode=single provider=local/);
  expect(stderr).toMatch(/trace turn=1 step=1 provider\.event type=tool_call toolName=read-file/);
  expect(stderr).toMatch(/trace turn=1 step=2 turn\.complete contentLength=/);
});

it("loads project .wasteland/settings.json for runtime defaults", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-project-config-"));
  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    runtime: {
      permissionMode: "bypass_permissions",
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--message", "/bash pwd"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout).toMatch(/permission\[1\]> bash: allow \(bypass_permissions\)/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 bash 已完成。/);
});

it("loads project .wasteland/settings.json above user ~/.wasteland/settings.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-project-over-user-config-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "joe-project-over-user-home-"));

  await writeJsonFile(path.join(tempHome, ".wasteland", "settings.json"), {
    runtime: {
      permissionMode: "bypass_permissions",
    },
  });
  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    runtime: {
      permissionMode: "default",
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--message", "/bash pwd"),
    {
      cwd: tempRoot,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  expect(stdout).toMatch(/permission\[1\]> bash: ask \(default\)/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 bash 未执行：模式 default 对 execute 工具要求确认。/);
});

it("loads user ~/.wasteland/settings.json when project config is absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-user-config-project-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "joe-user-config-home-"));

  await writeJsonFile(path.join(tempHome, ".wasteland", "settings.json"), {
    runtime: {
      permissionMode: "bypass_permissions",
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--message", "/bash pwd"),
    {
      cwd: tempRoot,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  expect(stdout).toMatch(/permission\[1\]> bash: allow \(bypass_permissions\)/);
});

it("loads qwen api key from project .wasteland/auth.json via generic $auth ref", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-project-auth-qwen-"));
  const server = await createJsonServer(async (request, body, response) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/compatible-mode/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer project-auth-secret");

    const payload = JSON.parse(body);

    expect(payload.model).toBe("qwen3-max");
    expect(payload.messages).toEqual([
      {
        role: "user",
        content: "你好",
      },
    ]);

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      id: "chatcmpl-project-env",
      object: "chat.completion",
      created: 1,
      model: "qwen3-max",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "这是来自 project auth 的回复。",
          },
        },
      ],
    }));
  });

  try {
    await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
      defaultProvider: "qwen",
      providers: {
        qwen: {
          baseUrl: `${server.baseUrl}/compatible-mode`,
          apiKey: {
            $auth: "OPENAI_API_KEY",
          },
          model: "qwen3-max",
        },
      },
    });
    await writeJsonFile(path.join(tempRoot, ".wasteland", "auth.json"), {
      OPENAI_API_KEY: "project-auth-secret",
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("chat", "--message", "你好"),
      {
        cwd: tempRoot,
        env: createCleanEnv(),
      },
    );

    expect(stdout.trim()).toBe("assistant[1]> 这是来自 project auth 的回复。");
  } finally {
    await server.close();
  }
});

it("finds project config dir from .wasteland/auth.json even when settings.json is absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-project-auth-only-"));
  const nestedDir = path.join(tempRoot, "packages", "demo");
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "joe-project-auth-only-home-"));

  await mkdir(nestedDir, { recursive: true });
  await writeJsonFile(path.join(tempHome, ".wasteland", "settings.json"), {
    defaultProvider: "qwen",
    providers: {
      qwen: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
        apiKey: {
          $auth: "OPENAI_API_KEY",
        },
        model: "qwen3-max",
      },
    },
  });
  await writeJsonFile(path.join(tempRoot, ".wasteland", "auth.json"), {
    OPENAI_API_KEY: "project-secret",
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("current"),
    {
      cwd: nestedDir,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  const payload = JSON.parse(stdout);

  expect(payload.cwd).toBe(nestedDir);
  expect(payload.sources.user).toBe(path.join(tempHome, ".wasteland", "settings.json"));
  expect(payload.sources.projectAuth).toBe(path.join(tempRoot, ".wasteland", "auth.json"));
  expect(payload.resolved.provider.settings.apiKey).toBe("***");
});

it("config current reports auth.json sources and redacts secrets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-config-auth-sources-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "joe-config-auth-home-"));

  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    defaultProvider: "qwen",
    providers: {
      qwen: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
        apiKey: {
          $auth: "OPENAI_API_KEY",
        },
        model: "qwen3-max",
      },
    },
  });
  await writeJsonFile(path.join(tempHome, ".wasteland", "auth.json"), {
    OPENAI_API_KEY: "user-secret",
  });
  await writeJsonFile(path.join(tempRoot, ".wasteland", "auth.json"), {
    OPENAI_API_KEY: "project-secret",
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("current"),
    {
      cwd: tempRoot,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  const payload = JSON.parse(stdout);

  expect(payload.sources.userAuth).toBe(path.join(tempHome, ".wasteland", "auth.json"));
  expect(payload.sources.projectAuth).toBe(path.join(tempRoot, ".wasteland", "auth.json"));
  expect(payload.resolved.provider.name).toBe("qwen");
  expect(payload.resolved.provider.settings.apiKey).toBe("***");
});

it("chat --role resolves model provider and role permission mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-role-explicit-"));

  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    runtime: {
      defaultRole: "reviewer",
    },
    providers: {
      local: {},
    },
    models: {
      reviewer_model: {
        provider: "local",
        model: "local",
      },
      coder_model: {
        provider: "local",
        model: "local",
      },
    },
    roles: {
      reviewer: {
        model: "reviewer_model",
        permissionMode: "default",
      },
      coder: {
        model: "coder_model",
        permissionMode: "bypass_permissions",
      },
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--role", "coder", "--message", "/bash pwd"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout).toMatch(/permission\[1\]> bash: allow \(bypass_permissions\)/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 bash 已完成。/);
});

it("chat uses runtime.defaultRole when role is not passed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-role-default-"));

  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    runtime: {
      defaultRole: "coder",
    },
    providers: {
      local: {},
    },
    models: {
      coder_model: {
        provider: "local",
        model: "local",
      },
    },
    roles: {
      coder: {
        model: "coder_model",
        permissionMode: "bypass_permissions",
      },
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--message", "/bash pwd"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout).toMatch(/permission\[1\]> bash: allow \(bypass_permissions\)/);
  expect(stdout).toMatch(/assistant\[1\]> 工具 bash 已完成。/);
});

it("config current prints resolved role model provider and redacts secrets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-config-current-"));

  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    runtime: {
      defaultRole: "chat",
      debug: true,
      maxStepsPerTurn: 12,
    },
    providers: {
      qwen: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
        apiKey: "super-secret-key",
      },
    },
    models: {
      chat_model: {
        provider: "qwen",
        model: "qwen3-max",
        temperature: 0.2,
      },
    },
    roles: {
      chat: {
        model: "chat_model",
        prompt: "prompts/chat.md",
      },
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("config", "current"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  const payload = JSON.parse(stdout);

  expect(payload.defaults.role).toBe("chat");
  expect(payload.resolved.role.name).toBe("chat");
  expect(payload.resolved.model.name).toBe("chat_model");
  expect(payload.resolved.provider.name).toBe("qwen");
  expect(payload.resolved.provider.settings.apiKey).toBe("***");
  expect(payload.resolved.provider.settings.model).toBe("qwen3-max");
  expect(payload.resolved.provider.settings.temperature).toBe(0.2);
  expect(payload.resolved.runtime.maxStepsPerTurn).toBe(12);
  expect(payload.resolved.runtime.debug).toBe(true);
});

it("top-level current aliases config current", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-current-alias-"));

  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    runtime: {
      defaultRole: "chat",
    },
    providers: {
      local: {},
    },
    models: {
      chat_model: {
        provider: "local",
        model: "local",
      },
    },
    roles: {
      chat: {
        model: "chat_model",
      },
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("current"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  const payload = JSON.parse(stdout);

  expect(payload.resolved.role.name).toBe("chat");
  expect(payload.resolved.model.name).toBe("chat_model");
});

it("dev shim accepts nested joe current form", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-dev-shim-current-"));

  await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
    providers: {
      local: {},
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("joe", "current"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  const payload = JSON.parse(stdout);

  expect(payload.resolved.provider.name).toBe("local");
});

it("persists default session transcripts under .wasteland/sessions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-session-default-"));

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--message", "你好"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：你好");

  const sessionDir = path.join(tempRoot, ".wasteland", "sessions");
  const files = await readdir(sessionDir);

  expect(files.length).toBe(1);
});

it("resolves generic $auth ref from process env before auth.json", async () => {
  const server = await createJsonServer(async (request, body, response) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/compatible-mode/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer env-secret");

    const payload = JSON.parse(body);

    expect(payload.model).toBe("qwen3-max");
    expect(payload.stream).toBe(false);
    expect(payload.messages).toEqual([
      {
        role: "user",
        content: "你好",
      },
    ]);

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "qwen3-max",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "这是来自 qwen stub 的回复。",
          },
        },
      ],
    }));
  });

  try {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-process-env-auth-"));

    await writeJsonFile(path.join(tempRoot, ".wasteland", "settings.json"), {
      defaultProvider: "qwen",
      providers: {
        qwen: {
          baseUrl: `${server.baseUrl}/compatible-mode`,
          apiKey: {
            $auth: "OPENAI_API_KEY",
          },
          model: "qwen3-max",
        },
      },
    });
    await writeJsonFile(path.join(tempRoot, ".wasteland", "auth.json"), {
      OPENAI_API_KEY: "project-secret",
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("chat", "--message", "你好"),
      {
        cwd: tempRoot,
        env: createCleanEnv({
          OPENAI_API_KEY: "env-secret",
        }),
      },
    );

    expect(stdout.trim()).toBe("assistant[1]> 这是来自 qwen stub 的回复。");
  } finally {
    await server.close();
  }
});

it("renders JSONL debug format to stderr with --debug --debug-format jsonl", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-debug-jsonl-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--debug", "--debug-format", "jsonl", "--message", "你好"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：你好");

  // Each line should be valid JSON
  const lines = stderr.trim().split("\n");
  expect(lines.length > 0).toBeTruthy();

  for (const line of lines) {
    const parsed = JSON.parse(line);
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.scope).toBeTruthy();
    expect(parsed.phase).toBeTruthy();
    expect(parsed.message).toBeTruthy();
  }
});

it("persists JSONL trace file in .wasteland/traces directory", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-debug-jsonl-file-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--debug", "--debug-format", "jsonl", "--message", "你好"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：你好");

  // Check trace file was created
  const traceDir = path.join(tempRoot, ".wasteland", "traces");
  const traceFiles = await readdir(traceDir);

  expect(traceFiles.length).toBe(1, "should have one trace file");

  const traceFile = traceFiles[0];
  expect(traceFile).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-f0-9]{6}\.jsonl$/);

  // Verify trace file content
  const traceContent = await readFile(path.join(traceDir, traceFile), "utf8");
  const traceLines = traceContent.trim().split("\n");

  expect(traceLines.length > 0).toBeTruthy();

  for (const line of traceLines) {
    const parsed = JSON.parse(line);
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.sessionId).toBeTruthy();
  }
});

it("session ID uses timestamp prefix format", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-session-id-format-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  await execFileAsync(process.execPath, cliArgs("chat", "--message", "你好"), {
    cwd: tempRoot,
    env,
  });

  const files = await readdir(sessionDir);
  expect(files.length).toBe(1);

  const sessionFile = files[0];
  // Format: 2026-05-23T14-30-00_abc123.jsonl
  expect(
    sessionFile,
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-f0-9]{6}\.jsonl$/,
    "session file should match timestamp_shortId.jsonl format",
  );
});

it("JSONL output can be piped to jq for parsing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-debug-jsonl-jq-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--debug", "--debug-format", "jsonl", "--message", "你好"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  // Extract session.start events by parsing each line
  const lines = stderr.trim().split("\n");
  const sessionStartEvents = lines
    .map((line) => JSON.parse(line))
    .filter((event) => event.phase === "session.start");

  expect(sessionStartEvents.length > 0).toBeTruthy();
  expect(sessionStartEvents[0].scope).toBe("session");
  expect(sessionStartEvents[0].data.mode).toBe("single");
});

it("pretty debug format is default when --debug is used without --debug-format", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-debug-pretty-default-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--debug", "--message", "你好"),
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  expect(stdout.trim()).toBe("assistant[1]> 你好，我已经收到你的输入：你好");

  // Pretty format should have "trace" prefix, not JSON
  expect(stderr).toMatch(/trace session\.start/);
  expect(stderr).not.toMatch(/"timestamp"/);
});

// ============================================================
// 新工具测试：glob、grep、list-directory、web-fetch
// ============================================================

it("glob tool finds files matching pattern", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-glob-tool-"));
  const sessionDir = path.join(tempRoot, "sessions");

  // 创建测试文件结构
  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await writeFile(path.join(tempRoot, "src", "main.ts"), "export {};\n", "utf8");
  await writeFile(path.join(tempRoot, "src", "utils.ts"), "export {};\n", "utf8");
  await writeFile(path.join(tempRoot, "package.json"), "{}\n", "utf8");
  await writeFile(path.join(tempRoot, "README.md"), "# test\n", "utf8");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/glob *.ts"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request glob/);
  expect(stdout).toMatch(/tool\[1\]> result glob/);
  // glob *.ts 在根目录下应该找不到文件（因为 .ts 文件在 src/ 下）
  expect(stdout).toMatch(/no matches found/);
});

it("glob tool finds files in subdirectory", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-glob-subdir-"));
  const sessionDir = path.join(tempRoot, "sessions");

  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await writeFile(path.join(tempRoot, "src", "main.ts"), "export {};\n", "utf8");
  await writeFile(path.join(tempRoot, "src", "utils.ts"), "export {};\n", "utf8");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/glob src/*.ts"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request glob/);
  expect(stdout).toMatch(/tool\[1\]> result glob/);
  expect(stdout).toMatch(/2 matches/);
  expect(stdout).toMatch(/main\.ts/);
  expect(stdout).toMatch(/utils\.ts/);
});

it("grep tool searches text in files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-grep-tool-"));
  const sessionDir = path.join(tempRoot, "sessions");

  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await writeFile(path.join(tempRoot, "src", "main.ts"), "export function main() {}\n// TODO: implement\n", "utf8");
  await writeFile(path.join(tempRoot, "src", "utils.ts"), "export function utils() {}\n// TODO: refactor\n", "utf8");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/grep TODO"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request grep/);
  expect(stdout).toMatch(/tool\[1\]> result grep/);
  expect(stdout).toMatch(/2 matches/);
  expect(stdout).toMatch(/TODO/);
});

it("grep tool filters by include pattern", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-grep-include-"));
  const sessionDir = path.join(tempRoot, "sessions");

  await writeFile(path.join(tempRoot, "code.ts"), "export const x = 1;\n", "utf8");
  await writeFile(path.join(tempRoot, "note.txt"), "This is a note\n", "utf8");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/grep export"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request grep/);
  expect(stdout).toMatch(/tool\[1\]> result grep/);
  expect(stdout).toMatch(/export/);
});

it("list-directory tool lists directory contents", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-listdir-tool-"));
  const sessionDir = path.join(tempRoot, "sessions");

  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await writeFile(path.join(tempRoot, "package.json"), "{}\n", "utf8");
  await writeFile(path.join(tempRoot, "README.md"), "# test\n", "utf8");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/list-directory"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> request list-directory/);
  expect(stdout).toMatch(/tool\[1\]> result list-directory/);
  // 注意：sessions 目录也会被列出，所以是 4 个条目
  expect(stdout).toMatch(/\d+ entries/);
  expect(stdout).toMatch(/src/);
  expect(stdout).toMatch(/package\.json/);
  expect(stdout).toMatch(/README\.md/);
});

it("list-directory tool shows hidden files when requested", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-listdir-hidden-"));
  const sessionDir = path.join(tempRoot, "sessions");

  await writeFile(path.join(tempRoot, ".gitignore"), "node_modules\n", "utf8");
  await writeFile(path.join(tempRoot, "visible.txt"), "hello\n", "utf8");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  // 不显示隐藏文件
  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/list-directory"),
    {
      cwd: tempRoot,
      env,
    },
  );

  expect(stdout).toMatch(/tool\[1\]> result list-directory/);
  // sessions 目录 + visible.txt = 2 个条目（隐藏文件 .gitignore 不显示）
  expect(stdout).toMatch(/\d+ entries/);
  expect(stdout).toMatch(/visible\.txt/);
});

it("web-fetch tool fetches HTTP content", async () => {
  const server = await createJsonServer(async (request, body, response) => {
    expect(request.method).toBe("GET");
    expect(request.url).toBe("/test");

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      message: "Hello from test server",
      timestamp: Date.now(),
    }));
  });

  try {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-webfetch-tool-"));
    const sessionDir = path.join(tempRoot, "sessions");

    const env = createCleanEnv({
      JOE_SESSION_DIR: sessionDir,
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", `/web-fetch ${server.baseUrl}/test`),
      {
        cwd: tempRoot,
        env,
      },
    );

    expect(stdout).toMatch(/tool\[1\]> request web-fetch/);
    expect(stdout).toMatch(/tool\[1\]> result web-fetch/);
    expect(stdout).toMatch(/200 OK/);
    expect(stdout).toMatch(/Hello from test server/);
  } finally {
    await server.close();
  }
});

it("web-fetch tool handles POST requests", async () => {
  const server = await createJsonServer(async (request, body, response) => {
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api");

    const payload = JSON.parse(body);
    expect(payload.name).toBe("test");

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      success: true,
      received: payload,
    }));
  });

  try {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-webfetch-post-"));
    const sessionDir = path.join(tempRoot, "sessions");

    const env = createCleanEnv({
      JOE_SESSION_DIR: sessionDir,
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", `/web-fetch ${server.baseUrl}/api POST {"name":"test"}`),
      {
        cwd: tempRoot,
        env,
      },
    );

    expect(stdout).toMatch(/tool\[1\]> result web-fetch/);
    expect(stdout).toMatch(/200 OK/);
    expect(stdout).toMatch(/success/);
  } finally {
    await server.close();
  }
});

it("web-fetch tool rejects invalid URLs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-webfetch-invalid-"));
  const sessionDir = path.join(tempRoot, "sessions");

  const env = createCleanEnv({
    JOE_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    cliArgs("chat", "--permission-mode", "bypass_permissions", "--message", "/web-fetch not-a-url"),
    {
      cwd: tempRoot,
      env,
    },
  );

  // 工具执行失败时，输出为 "failed" 而不是 "result: error"
  expect(stdout).toMatch(/tool\[1\]> failed web-fetch/);
  expect(stdout).toMatch(/无效.*URL|需要有效的/);
});
