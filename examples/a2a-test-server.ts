/**
 * A2A Test Server
 *
 * 一个简单的 A2A 协议测试服务器，用于验证 wasteland 的 A2A Client 集成。
 *
 * ## 启动方式
 *
 * ```bash
 * npx tsx examples/a2a-test-server.ts
 * ```
 *
 * ## 测试方式
 *
 * ```bash
 * # 1. 配置 settings.json
 * cat > .wasteland/settings.json << 'EOF'
 * {
 *   "a2aAgents": [
 *     {
 *       "name": "echo-agent",
 *       "url": "http://localhost:3456"
 *     }
 *   ]
 * }
 * EOF
 *
 * # 2. 运行 wasteland
 * wasteland chat --message "调用 echo-agent 说 hello"
 * ```
 */

import http from 'node:http';
import crypto from 'node:crypto';

// ============================================================
// A2A 类型定义
// ============================================================

type AgentCard = {
  name: string;
  description: string;
  url: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
};

type TaskState = 'submitted' | 'working' | 'completed' | 'failed';

type Task = {
  id: string;
  sessionId?: string;
  status: {
    state: TaskState;
    message?: { role: string; parts: Array<{ type: string; text: string }> };
  };
  artifacts?: Array<{
    parts: Array<{ type: string; text: string }>;
  }>;
};

// ============================================================
// Agent Card
// ============================================================

const agentCard: AgentCard = {
  name: 'echo-agent',
  description: 'A simple echo agent for testing A2A integration',
  url: 'http://localhost:3456',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  skills: [
    {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes back the input message',
      tags: ['echo', 'test'],
    },
    {
      id: 'uppercase',
      name: 'Uppercase',
      description: 'Converts input to uppercase',
      tags: ['text', 'transform'],
    },
  ],
};

// ============================================================
// Task 存储
// ============================================================

const tasks = new Map<string, Task>();

// ============================================================
// 请求处理
// ============================================================

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`[${req.method}] ${path}`);

  // GET /.well-known/agent.json - Agent Card
  if (path === '/.well-known/agent.json' && req.method === 'GET') {
    sendJSON(res, 200, agentCard);
    return;
  }

  // POST /tasks/send - 发送任务
  if (path === '/tasks/send' && req.method === 'POST') {
    const body = (await parseBody(req)) as {
      id?: string;
      sessionId?: string;
      message?: { role: string; parts: Array<{ type: string; text: string }> };
    };

    if (!body?.message?.parts?.length) {
      sendJSON(res, 400, { error: 'Invalid request: message.parts required' });
      return;
    }

    const taskId = body.id ?? crypto.randomUUID();
    const inputText = body.message.parts.map((p) => p.text).join('\n');

    // 处理任务
    let outputText: string;
    if (inputText.toLowerCase().includes('uppercase')) {
      outputText = inputText.toUpperCase();
    } else {
      outputText = `Echo: ${inputText}`;
    }

    const task: Task = {
      id: taskId,
      sessionId: body.sessionId,
      status: {
        state: 'completed',
        message: {
          role: 'agent',
          parts: [{ type: 'text', text: outputText }],
        },
      },
      artifacts: [
        {
          parts: [{ type: 'text', text: outputText }],
        },
      ],
    };

    tasks.set(taskId, task);

    console.log(`  Task ${taskId} completed: "${outputText.substring(0, 50)}..."`);
    sendJSON(res, 200, task);
    return;
  }

  // GET /tasks/:id - 获取任务状态
  const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === 'GET') {
    const taskId = taskMatch[1];
    const task = tasks.get(taskId);

    if (!task) {
      sendJSON(res, 404, { error: 'Task not found' });
      return;
    }

    sendJSON(res, 200, task);
    return;
  }

  // POST /tasks/:id/cancel - 取消任务
  if (taskMatch && req.method === 'POST' && path.endsWith('/cancel')) {
    const taskId = taskMatch[1];
    const task = tasks.get(taskId);

    if (!task) {
      sendJSON(res, 404, { error: 'Task not found' });
      return;
    }

    task.status.state = 'failed';
    task.status.message = {
      role: 'agent',
      parts: [{ type: 'text', text: 'Task cancelled' }],
    };

    sendJSON(res, 200, task);
    return;
  }

  // 404
  sendJSON(res, 404, { error: 'Not found' });
}

// ============================================================
// 启动服务器
// ============================================================

const PORT = parseInt(process.env.A2A_PORT ?? '3456', 10);

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error('Error:', error);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 A2A Test Server running on http://localhost:${PORT}`);
  console.log(`\n📋 Agent Card: http://localhost:${PORT}/.well-known/agent.json`);
  console.log(`\n📝 Send task: POST http://localhost:${PORT}/tasks/send`);
  console.log(`   Body: { "message": { "role": "user", "parts": [{ "type": "text", "text": "hello" }] } }`);
  console.log(`\n🔍 Get task: GET http://localhost:${PORT}/tasks/{id}`);
  console.log(`\n⏹️  Cancel task: POST http://localhost:${PORT}/tasks/{id}/cancel`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
