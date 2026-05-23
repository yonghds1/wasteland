import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/rxc.js", import.meta.url));

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

test("prints the hello command output", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "hello", "Trellis"]);

  assert.equal(stdout.trim(), "Hello, Trellis!");
});

test("shows help output", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"]);

  assert.match(stdout, /Usage: rxc/);
  assert.match(stdout, /hello/);
  assert.match(stdout, /chat/);
});

test("prints the rxjs chat reply for one-shot input", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--message", "你好"]);

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：你好");
});

test("reads stdin through the same runtime path", async () => {
  const { stdout } = await runCliWithInput(["chat"], "hello");

  assert.equal(stdout.trim(), "assistant[1]> 你好，我已经收到你的输入：hello");
});

test("persists a local session transcript for one-shot chat", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rx-cli-session-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = {
    ...process.env,
    RX_CLI_SESSION_DIR: sessionDir,
  };

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--message", "你好"], {
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

test("routes a local tool call through the main chat runtime path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rx-cli-read-file-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = {
    ...process.env,
    RX_CLI_SESSION_DIR: sessionDir,
  };

  await writeFile(path.join(tempRoot, "note.txt"), "hello from tool\n", "utf8");

  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--message", "/read note.txt"], {
    cwd: tempRoot,
    env,
  });

  assert.match(stdout, /tool\[1\]> request read-file/);
  assert.match(stdout, /permission\[1\]> read-file: allow \(default\)/);
  assert.match(stdout, /tool\[1\]> start read-file/);
  assert.match(stdout, /tool\[1\]> result read-file: hello from tool/);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"type":"tool_call"/);
  assert.match(transcript, /"type":"permission"/);
  assert.match(transcript, /"type":"tool_result"/);
  assert.match(transcript, /"toolName":"read-file"/);
});

test("blocks execute-risk tools in default permission mode", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "chat", "--message", "/bash pwd"]);

  assert.match(stdout, /tool\[1\]> request bash/);
  assert.match(stdout, /permission\[1\]> bash: ask \(default\)/);
  assert.match(stdout, /tool\[1\]> failed bash: 模式 default 对 execute 工具要求确认。/);
});

test("allows execute-risk tools in bypass_permissions mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rx-cli-bash-tool-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const env = {
    ...process.env,
    RX_CLI_SESSION_DIR: sessionDir,
  };

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

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"toolName":"bash"/);
  assert.match(transcript, /"status":"success"/);
});
