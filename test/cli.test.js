import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/rxc.js", import.meta.url));
const isolatedHomeDir = path.join(os.tmpdir(), `rxc-test-home-${process.pid}`);

function createCleanEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };

  delete env.RXC_PROVIDER;
  delete env.RXC_PERMISSION_MODE;
  delete env.RXC_MAX_STEPS_PER_TURN;
  delete env.RXC_DEBUG;
  delete env.RXC_HOME;
  delete env.RXC_SESSION_DIR;
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
    const child = spawn(process.execPath, [cliPath, ...args], {
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

test("shows help output", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"]);

  assert.match(stdout, /Usage: rxc/);
  assert.match(stdout, /chat/);
  assert.match(stdout, /config/);
  assert.match(stdout, /current/);
});

test("fails before entering runtime when provider is unsupported", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, "chat", "--provider", "missing", "--message", "你好"]),
    /当前不支持 provider: missing/,
  );
});

test("prints the rxjs chat reply for one-shot input", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--provider", "local", "--message", "你好"]);

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");
});

test("reads stdin through the same runtime path", async () => {
  const { stdout } = await runCliWithInput(["chat", "--provider", "local"], "hello");

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：hello");
});

test("persists a local session transcript for one-shot chat", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-session-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RXC_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--provider", "local", "--message", "你好"], {
    env,
  });

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");

  const files = await readdir(sessionDir);

  assert.equal(files.length, 1);

  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"type":"session"/);
  assert.match(transcript, /"role":"user"/);
  assert.match(transcript, /"role":"assistant"/);
  assert.match(transcript, /"type":"session_end"/);
});

test("supports legacy RX_CLI_SESSION_DIR for session transcript output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-session-legacy-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RX_CLI_SESSION_DIR: sessionDir,
  });

  await execFileAsync(process.execPath, [cliPath, "chat", "--message", "你好"], {
    cwd: tempRoot,
    env,
  });

  const files = await readdir(sessionDir);

  assert.equal(files.length, 1);
});

test("routes a local tool call through the main chat runtime path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-read-file-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RXC_SESSION_DIR: sessionDir,
  });

  await writeFile(path.join(tempRoot, "note.txt"), "hello from tool\n", "utf8");

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--message", "/read note.txt"], {
    cwd: tempRoot,
    env,
  });

  assert.match(stdout, /tool\[1\]> request read-file/);
  assert.match(stdout, /permission\[1\]> read-file: allow \(default\)/);
  assert.match(stdout, /tool\[1\]> start read-file/);
  // 新格式包含文件元数据头和行号
  assert.match(stdout, /tool\[1\]> result read-file: 📄 note\.txt/);
  assert.match(stdout, /1│hello from tool/);
  assert.match(stdout, /assistant\[1\]> 工具 read-file 已完成。/);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"type":"tool_call"/);
  assert.match(transcript, /"type":"permission"/);
  assert.match(transcript, /"type":"tool_result"/);
  assert.match(transcript, /"toolName":"read-file"/);
});

test("blocks execute-risk tools in default permission mode", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--provider", "local", "--message", "/bash pwd"]);

  assert.match(stdout, /tool\[1\]> request bash/);
  assert.match(stdout, /permission\[1\]> bash: ask \(default\)/);
  assert.match(stdout, /tool\[1\]> failed bash: 模式 default 对 execute 工具要求确认。/);
  assert.match(stdout, /assistant\[1\]> 工具 bash 未执行：模式 default 对 execute 工具要求确认。/);
});

test("allows execute-risk tools in bypass_permissions mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-bash-tool-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RXC_SESSION_DIR: sessionDir,
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--permission-mode", "bypass_permissions", "--message", "/bash pwd"],
    {
      cwd: tempRoot,
      env,
    },
  );

  assert.match(stdout, /tool\[1\]> request bash/);
  assert.match(stdout, /permission\[1\]> bash: allow \(bypass_permissions\)/);
  assert.match(stdout, /tool\[1\]> start bash/);
  assert.match(stdout, new RegExp(`tool\\[1\\]> result bash: ${tempRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(stdout, /assistant\[1\]> 工具 bash 已完成。/);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"toolName":"bash"/);
  assert.match(transcript, /"status":"success"/);
});

test("renders debug trace to stderr without polluting stdout", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-debug-trace-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RXC_SESSION_DIR: sessionDir,
  });

  await writeFile(path.join(tempRoot, "note.txt"), "hello from tool\n", "utf8");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--debug", "--message", "/read note.txt"],
    {
      cwd: tempRoot,
      env,
    },
  );

  assert.match(stdout, /tool\[1\]> request read-file/);
  assert.match(stdout, /assistant\[1\]> 工具 read-file 已完成。/);
  assert.doesNotMatch(stdout, /trace /);
  assert.match(stderr, /trace session\.start mode=single provider=local/);
  assert.match(stderr, /trace turn=1 step=1 provider\.event type=tool_call toolName=read-file/);
  assert.match(stderr, /trace turn=1 step=2 turn\.complete contentLength=/);
});

test("loads project .rxc/settings.json for runtime defaults", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-project-config-"));
  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
    runtime: {
      permissionMode: "bypass_permissions",
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--message", "/bash pwd"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.match(stdout, /permission\[1\]> bash: allow \(bypass_permissions\)/);
  assert.match(stdout, /assistant\[1\]> 工具 bash 已完成。/);
});

test("loads project .rxc/settings.json above user ~/.rxc/settings.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-project-over-user-config-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "rxc-project-over-user-home-"));

  await writeJsonFile(path.join(tempHome, ".rxc", "settings.json"), {
    runtime: {
      permissionMode: "bypass_permissions",
    },
  });
  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
    runtime: {
      permissionMode: "default",
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--message", "/bash pwd"],
    {
      cwd: tempRoot,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  assert.match(stdout, /permission\[1\]> bash: ask \(default\)/);
  assert.match(stdout, /assistant\[1\]> 工具 bash 未执行：模式 default 对 execute 工具要求确认。/);
});

test("loads user ~/.rxc/settings.json when project config is absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-user-config-project-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "rxc-user-config-home-"));

  await writeJsonFile(path.join(tempHome, ".rxc", "settings.json"), {
    runtime: {
      permissionMode: "bypass_permissions",
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--message", "/bash pwd"],
    {
      cwd: tempRoot,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  assert.match(stdout, /permission\[1\]> bash: allow \(bypass_permissions\)/);
});

test("loads qwen api key from project .rxc/auth.json via generic $auth ref", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-project-auth-qwen-"));
  const server = await createJsonServer(async (request, body, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/compatible-mode/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer project-auth-secret");

    const payload = JSON.parse(body);

    assert.equal(payload.model, "qwen3-max");
    assert.deepEqual(payload.messages, [
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
    await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
    await writeJsonFile(path.join(tempRoot, ".rxc", "auth.json"), {
      OPENAI_API_KEY: "project-auth-secret",
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath, "chat", "--message", "你好"],
      {
        cwd: tempRoot,
        env: createCleanEnv(),
      },
    );

    assert.equal(stdout.trim(), "assistant[1]> 这是来自 project auth 的回复。");
  } finally {
    await server.close();
  }
});

test("finds project config dir from .rxc/auth.json even when settings.json is absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-project-auth-only-"));
  const nestedDir = path.join(tempRoot, "packages", "demo");
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "rxc-project-auth-only-home-"));

  await mkdir(nestedDir, { recursive: true });
  await writeJsonFile(path.join(tempHome, ".rxc", "settings.json"), {
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
  await writeJsonFile(path.join(tempRoot, ".rxc", "auth.json"), {
    OPENAI_API_KEY: "project-secret",
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "current"],
    {
      cwd: nestedDir,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  const payload = JSON.parse(stdout);

  assert.equal(payload.cwd, nestedDir);
  assert.equal(payload.sources.user, path.join(tempHome, ".rxc", "settings.json"));
  assert.equal(payload.sources.projectAuth, path.join(tempRoot, ".rxc", "auth.json"));
  assert.equal(payload.resolved.provider.settings.apiKey, "***");
});

test("config current reports auth.json sources and redacts secrets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-config-auth-sources-"));
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "rxc-config-auth-home-"));

  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
  await writeJsonFile(path.join(tempHome, ".rxc", "auth.json"), {
    OPENAI_API_KEY: "user-secret",
  });
  await writeJsonFile(path.join(tempRoot, ".rxc", "auth.json"), {
    OPENAI_API_KEY: "project-secret",
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "current"],
    {
      cwd: tempRoot,
      env: createCleanEnv({
        HOME: tempHome,
        USERPROFILE: tempHome,
      }),
    },
  );

  const payload = JSON.parse(stdout);

  assert.equal(payload.sources.userAuth, path.join(tempHome, ".rxc", "auth.json"));
  assert.equal(payload.sources.projectAuth, path.join(tempRoot, ".rxc", "auth.json"));
  assert.equal(payload.resolved.provider.name, "qwen");
  assert.equal(payload.resolved.provider.settings.apiKey, "***");
});

test("chat --role resolves model provider and role permission mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-role-explicit-"));

  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
    [cliPath, "chat", "--role", "coder", "--message", "/bash pwd"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.match(stdout, /permission\[1\]> bash: allow \(bypass_permissions\)/);
  assert.match(stdout, /assistant\[1\]> 工具 bash 已完成。/);
});

test("chat uses runtime.defaultRole when role is not passed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-role-default-"));

  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
    [cliPath, "chat", "--message", "/bash pwd"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.match(stdout, /permission\[1\]> bash: allow \(bypass_permissions\)/);
  assert.match(stdout, /assistant\[1\]> 工具 bash 已完成。/);
});

test("config current prints resolved role model provider and redacts secrets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-config-current-"));

  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
    [cliPath, "config", "current"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  const payload = JSON.parse(stdout);

  assert.equal(payload.defaults.role, "chat");
  assert.equal(payload.resolved.role.name, "chat");
  assert.equal(payload.resolved.model.name, "chat_model");
  assert.equal(payload.resolved.provider.name, "qwen");
  assert.equal(payload.resolved.provider.settings.apiKey, "***");
  assert.equal(payload.resolved.provider.settings.model, "qwen3-max");
  assert.equal(payload.resolved.provider.settings.temperature, 0.2);
  assert.equal(payload.resolved.runtime.maxStepsPerTurn, 12);
  assert.equal(payload.resolved.runtime.debug, true);
});

test("top-level current aliases config current", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-current-alias-"));

  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
    [cliPath, "current"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  const payload = JSON.parse(stdout);

  assert.equal(payload.resolved.role.name, "chat");
  assert.equal(payload.resolved.model.name, "chat_model");
});

test("dev shim accepts nested rxc current form", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-dev-shim-current-"));

  await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
    providers: {
      local: {},
    },
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "rxc", "current"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  const payload = JSON.parse(stdout);

  assert.equal(payload.resolved.provider.name, "local");
});

test("persists default session transcripts under .rxc/sessions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-session-default-"));

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--message", "你好"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");

  const sessionDir = path.join(tempRoot, ".rxc", "sessions");
  const files = await readdir(sessionDir);

  assert.equal(files.length, 1);
});

test("resolves generic $auth ref from process env before auth.json", async () => {
  const server = await createJsonServer(async (request, body, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/compatible-mode/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer env-secret");

    const payload = JSON.parse(body);

    assert.equal(payload.model, "qwen3-max");
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.messages, [
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
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-process-env-auth-"));

    await writeJsonFile(path.join(tempRoot, ".rxc", "settings.json"), {
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
    await writeJsonFile(path.join(tempRoot, ".rxc", "auth.json"), {
      OPENAI_API_KEY: "project-secret",
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath, "chat", "--message", "你好"],
      {
        cwd: tempRoot,
        env: createCleanEnv({
          OPENAI_API_KEY: "env-secret",
        }),
      },
    );

    assert.equal(stdout.trim(), "assistant[1]> 这是来自 qwen stub 的回复。");
  } finally {
    await server.close();
  }
});

test("renders JSONL debug format to stderr with --debug --debug-format jsonl", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-debug-jsonl-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--debug", "--debug-format", "jsonl", "--message", "你好"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");

  // Each line should be valid JSON
  const lines = stderr.trim().split("\n");
  assert.ok(lines.length > 0, "stderr should have JSONL output");

  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.ok(parsed.timestamp, "each line should have timestamp");
    assert.ok(parsed.sessionId, "each line should have sessionId");
    assert.ok(parsed.scope, "each line should have scope");
    assert.ok(parsed.phase, "each line should have phase");
    assert.ok(parsed.message, "each line should have message");
  }
});

test("persists JSONL trace file in .rxc/traces directory", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-debug-jsonl-file-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--debug", "--debug-format", "jsonl", "--message", "你好"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");

  // Check trace file was created
  const traceDir = path.join(tempRoot, ".rxc", "traces");
  const traceFiles = await readdir(traceDir);

  assert.equal(traceFiles.length, 1, "should have one trace file");

  const traceFile = traceFiles[0];
  assert.match(traceFile, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-f0-9]{6}\.jsonl$/, "trace file should match timestamp_shortId.jsonl format");

  // Verify trace file content
  const traceContent = await readFile(path.join(traceDir, traceFile), "utf8");
  const traceLines = traceContent.trim().split("\n");

  assert.ok(traceLines.length > 0, "trace file should have content");

  for (const line of traceLines) {
    const parsed = JSON.parse(line);
    assert.ok(parsed.timestamp, "each line should have timestamp");
    assert.ok(parsed.sessionId, "each line should have sessionId");
  }
});

test("session ID uses timestamp prefix format", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-session-id-format-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = createCleanEnv({
    RXC_SESSION_DIR: sessionDir,
  });

  await execFileAsync(process.execPath, [cliPath, "chat", "--message", "你好"], {
    cwd: tempRoot,
    env,
  });

  const files = await readdir(sessionDir);
  assert.equal(files.length, 1);

  const sessionFile = files[0];
  // Format: 2026-05-23T14-30-00_abc123.jsonl
  assert.match(
    sessionFile,
    /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_[a-f0-9]{6}\.jsonl$/,
    "session file should match timestamp_shortId.jsonl format",
  );
});

test("JSONL output can be piped to jq for parsing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-debug-jsonl-jq-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--debug", "--debug-format", "jsonl", "--message", "你好"],
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

  assert.ok(sessionStartEvents.length > 0, "should have session.start event");
  assert.equal(sessionStartEvents[0].scope, "session");
  assert.equal(sessionStartEvents[0].data.mode, "single");
});

test("pretty debug format is default when --debug is used without --debug-format", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-debug-pretty-default-"));

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "chat", "--debug", "--message", "你好"],
    {
      cwd: tempRoot,
      env: createCleanEnv(),
    },
  );

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");

  // Pretty format should have "trace" prefix, not JSON
  assert.match(stderr, /trace session\.start/);
  assert.doesNotMatch(stderr, /"timestamp"/);
});
