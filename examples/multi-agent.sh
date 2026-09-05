#!/bin/bash
# multi-agent.sh - wasteland 多 Agent 使用示例

echo "=== wasteland 多 Agent 使用示例 ==="
echo ""

# 检查 provider 配置
if [ -z "$jdcloud_api_key" ]; then
    echo "❌ jdcloud_api_key 未设置"
    echo "请设置环境变量: export jdcloud_api_key='your-key'"
    exit 1
fi

echo "✅ jdcloud_api_key 已设置"
echo ""

# 示例 1: 自动创建子 Agent
echo "=== 示例 1: 自动创建子 Agent ==="
wasteland chat --provider jdcloud --message "分析这个项目的主要功能"
echo ""

# 示例 2: 显式创建子 Agent
echo "=== 示例 2: 显式创建子 Agent ==="
wasteland chat --provider jdcloud --message "创建一个 researcher 子 Agent 来搜索 RxJS 最佳实践"
echo ""

# 示例 3: 并行执行
echo "=== 示例 3: 并行执行 ==="
wasteland chat --provider jdcloud --message "同时执行：1. 读取 README.md 2. 列出目录结构"
echo ""

echo "=== 示例完成 ==="
