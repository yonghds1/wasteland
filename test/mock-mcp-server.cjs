const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let initialized = false;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);

    if (msg.method === 'initialize') {
      initialized = true;
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server', version: '1.0.0' }
        }
      };
      console.log(JSON.stringify(response));
    }

    if (msg.method === 'tools/list' && initialized) {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'write_code',
              description: 'Write code to implement a feature',
              inputSchema: {
                type: 'object',
                properties: {
                  task: { type: 'string', description: 'The coding task' }
                },
                required: ['task']
              }
            },
            {
              name: 'review_code',
              description: 'Review code for issues',
              inputSchema: {
                type: 'object',
                properties: {
                  code: { type: 'string', description: 'Code to review' }
                },
                required: ['code']
              }
            }
          ]
        }
      };
      console.log(JSON.stringify(response));
    }

    if (msg.method === 'tools/call' && initialized) {
      const toolName = msg.params?.name || 'unknown';
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            { type: 'text', text: `Mock response from ${toolName}: Task completed successfully!\n\nCode written:\n\`\`\`typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n\`\`\`` }
          ]
        }
      };
      console.log(JSON.stringify(response));
    }

    if (msg.method === 'shutdown') {
      const response = { jsonrpc: '2.0', id: msg.id, result: {} };
      console.log(JSON.stringify(response));
    }

  } catch (e) {
    // Ignore parse errors
  }
});

// Handle process events
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
