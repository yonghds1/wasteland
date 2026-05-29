#!/bin/bash

# install.sh - 将符号链接安装到系统 PATH
#
# 用法: sudo ./bin/links/install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
INSTALL_DIR="/usr/local/bin"

echo "将符号链接安装到 $INSTALL_DIR..."

if [ ! -w "$INSTALL_DIR" ]; then
    echo "需要管理员权限来安装到 $INSTALL_DIR"
    echo "请使用: sudo $0"
    exit 1
fi

cp -f "$PROJECT_DIR/bin/wasteland.js" "$INSTALL_DIR/"
echo "已安装: wasteland.js"

for link in "$SCRIPT_DIR"/*; do
    if [ -L "$link" ]; then
        LINK_NAME=$(basename "$link")
        if [ "$LINK_NAME" != "install.sh" ]; then
            ln -sf "wasteland.js" "$INSTALL_DIR/$LINK_NAME"
            echo "已安装: $LINK_NAME -> wasteland.js"
        fi
    fi
done

echo ""
echo "安装完成！可用命令:"
echo "  wasteland --help"
for link in "$SCRIPT_DIR"/*; do
    if [ -L "$link" ]; then
        LINK_NAME=$(basename "$link")
        if [ "$LINK_NAME" != "install.sh" ] && [ "$LINK_NAME" != "wasteland" ]; then
            echo "  $LINK_NAME --help"
        fi
    fi
done
