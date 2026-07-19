#!/bin/bash

# 多 Agent 端到端测试脚本
# 使用 .wasteland/settings.json 中的配置

echo "=== 多 Agent 端到端测试 ==="
echo ""

# 检查 API 密钥
if [ -z "$jdcloud_api_key" ]; then
    echo "⚠️  jdcloud_api_key 未设置，跳过 jdcloud provider 测试"
else
    echo "✅ jdcloud_api_key 已设置"
fi

if [ -z "$xiaomi_api_key" ]; then
    echo "⚠️  xiaomi_api_key 未设置，跳过 xiaomi provider 测试"
else
    echo "✅ xiaomi_api_key 已设置"
fi

echo ""

# 测试 1: 使用 local provider 测试基础功能
echo "=== 测试 1: Local Provider 基础功能 ==="
npx tsx src/cli.ts chat --provider local --message "你好，请回复：测试成功" 2>&1 | head -20
echo ""

# 测试 2: 测试 sessions 命令
echo "=== 测试 2: Sessions 命令 ==="
npx tsx src/cli.ts sessions --limit 5 2>&1
echo ""

# 测试 3: 测试 resume 命令（如果存在 session）
echo "=== 测试 3: Resume 命令 ==="
LATEST_SESSION=$(npx tsx src/cli.ts sessions --limit 1 --json 2>/dev/null | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$LATEST_SESSION" ]; then
    echo "找到最新 session: $LATEST_SESSION"
    npx tsx src/cli.ts resume "$LATEST_SESSION" --message "继续之前的工作" 2>&1 | head -20
else
    echo "没有找到 session，跳过 resume 测试"
fi
echo ""

# 测试 4: 测试多 Agent（使用 local provider）
echo "=== 测试 4: 多 Agent 测试（Local Provider）==="
npx tsx src/cli.ts chat --provider local --message "请创建一个子 Agent 来分析 package.json" 2>&1 | head -30
echo ""

# 测试 5: 测试 ask-user 工具
echo "=== 测试 5: Ask-User 工具测试 ==="
npx tsx src/cli.ts chat --provider local --message "请问我一个问题：你今天心情如何？" 2>&1 | head -20
echo ""

echo "=== 测试完成 ==="
echo ""
echo "如果需要测试真实 provider，请设置环境变量："
echo "  export jdcloud_api_key='your-jdcloud-api-key'"
echo "  export xiaomi_api_key='your-xiaomi-api-key'"
echo ""
echo "然后运行："
echo "  npm run dev -- chat --provider jdcloud --message '你好'"
echo "  npm run dev -- chat --provider xiaomi --message '你好'"
