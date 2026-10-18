import { describe, it, expect } from 'vitest';
import { interpolateEnvVars, resolveConfigEnv } from '../mcp-config-loader.js';

describe('mcp-config-loader', () => {
  it('正确插值 ${PROJECT_ROOT} 和环境变量', () => {
    process.env.TEST_MCP_TOKEN = 'secret-123';
    const text = 'token=${TEST_MCP_TOKEN},root=${PROJECT_ROOT}';
    const res = interpolateEnvVars(text, '/home/user/project');
    expect(res).toBe('token=secret-123,root=/home/user/project');
  });

  it('保留未定义的环境变量原样或默认值', () => {
    const text = 'val=${NON_EXISTENT_VAR_xyz}';
    const res = interpolateEnvVars(text, '/root');
    expect(res).toBe('val=${NON_EXISTENT_VAR_xyz}');
  });

  it('递归解析配置对象中的 command, url, args 和 env', () => {
    process.env.TEST_PORT = '8080';
    const cfg = {
      command: 'node',
      args: ['--port', '${TEST_PORT}'],
      env: {
        ROOT_DIR: '${PROJECT_ROOT}/data',
      },
    };

    const resolved = resolveConfigEnv(cfg, '/var/app');
    expect(resolved.args).toEqual(['--port', '8080']);
    expect(resolved.env?.ROOT_DIR).toBe('/var/app/data');
  });
});
