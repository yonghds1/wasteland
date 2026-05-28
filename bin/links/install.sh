#!/bin/bash

# install.sh - 将符号链接安装到系统 PATH
#
# 用法: sudo ./bin/links/install.sh
#
# 或者手动复制链接到 /usr/local/bin

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
INSTALL_DIR="/usr/local/bin"

echo "将符号链接安装到 $INSTALL_DIR..."

# 检查权限
if [ ! -w "$INSTALL_DIR" ]; then
    echo "需要管理员权限来安装到 $INSTALL_DIR"
    echo "请使用: sudo $0"
    exit 1
fi

# 先复制 wasteland.js 入口文件
cp -f "$PROJECT_DIR/bin/wasteland.js" "$INSTALL_DIR/"
echo "已安装: wasteland.js"

# 复制所有符号链接（使用绝对路径）
for link in "$SCRIPT_DIR"/*; do
    if [ -L "$link" ]; then
        LINK_NAME=$(basename "$link")
        if [ "$LINK_NAME" != "install.sh" ]; then
            ln -sf "wasteland.js" "$INSTALL_DIR/$LINK_NAME"
            echo "已安装: $LINK_NAME -> wasteland.js"
        fi
    fi
done

echo "安装完成！"
echo "现在可以使用以下命令:"
echo "  wasteland --help"
echo "  joe --help"
