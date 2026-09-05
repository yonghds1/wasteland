#!/bin/bash
# basic-usage.sh - wasteland 基础使用示例

echo "=== wasteland 基础使用示例 ==="
echo ""

# 检查 provider 配置
if [ -z "$jdcloud_api_key" ]; then
    echo "❌ jdcloud_api_key 未设置"
    echo "请设置环境变量: export jdcloud_api_key='your-key'"
    exit 1
fi

echo "✅ jdcloud_api_key 已设置"
echo ""

# 示例 1: 单次消息
echo "=== 示例 1: 单次消息 ==="
wasteland chat --provider jdcloud --message "你好，请用一句话介绍你自己"
echo ""

# 示例 2: Tool Calling - 读取文件
echo "=== 示例 2: 读取文件 ==="
wasteland chat --provider jdcloud --message "读取 package.json 的前 5 行"
echo ""

# 示例 3: Tool Calling - 列出目录
echo "=== 示例 3: 列出目录 ==="
wasteland chat --provider jdcloud --message "列出当前目录的文件"
echo ""

# 示例 4: Tool Calling - 执行命令
echo "=== 示例 4: 执行命令 ==="
wasteland chat --provider jdcloud --message "查看 git 状态"
echo ""

echo "=== 示例完成 ==="
