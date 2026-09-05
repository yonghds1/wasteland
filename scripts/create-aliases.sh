#!/bin/bash

# create-aliases.sh - 创建角色别名符号链接
#
# 用法: ./scripts/create-aliases.sh [skin-id]
#
# 根据皮肤配置中的角色别名，创建指向 wasteland.js 的符号链接
# 切换皮肤时运行此脚本，更新符号链接
#
# 工作方式：
#   1. 读取皮肤配置中的角色别名（默认皮肤无额外别名）
#   2. 在 bin/links/ 目录创建本地软链（开发用）
#   3. 将软链复制到 npm bin 目录（全局可用）

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 皮肤 ID
SKIN_ID="${1:-warlord-stern}"

# 入口文件
ENTRY_FILE="$PROJECT_DIR/bin/wasteland.js"

# 检查入口文件是否存在
if [ ! -f "$ENTRY_FILE" ]; then
    print_error "入口文件不存在: $ENTRY_FILE"
    exit 1
fi

# 检查项目是否已构建
if [ ! -f "$PROJECT_DIR/dist/cli.js" ]; then
    print_warn "项目未构建，正在构建..."
    cd "$PROJECT_DIR"
    npm run build
fi

# 创建符号链接的目录（本地开发用）
LOCAL_LINK_DIR="$PROJECT_DIR/bin/links"
mkdir -p "$LOCAL_LINK_DIR"

# 清除旧的符号链接
print_info "清除旧的符号链接..."
rm -f "$LOCAL_LINK_DIR"/*

# 创建主命令符号链接（wasteland）
ln -sf "../wasteland.js" "$LOCAL_LINK_DIR/wasteland"
print_info "创建主命令链接: wasteland"

# 获取角色别名
ROLE_ALIASES=()
GET_ALIASES_SCRIPT="$SCRIPT_DIR/get-role-aliases.js"

if [ -f "$GET_ALIASES_SCRIPT" ] && command -v node &> /dev/null; then
    print_info "从皮肤配置读取角色别名..."
    ALIASES_JSON=$(node "$GET_ALIASES_SCRIPT" "$SKIN_ID" 2>/dev/null || echo '[]')

    if command -v jq &> /dev/null; then
        mapfile -t ROLE_ALIASES < <(echo "$ALIASES_JSON" | jq -r '.[]')
    else
        ROLE_ALIASES=($(echo "$ALIASES_JSON" | tr -d '[]",' | tr ' ' '\n'))
    fi
else
    print_info "使用默认角色别名"
    ROLE_ALIASES=()
fi

print_info "角色别名: ${ROLE_ALIASES[*]}"

# 创建角色别名符号链接（本地 + npm bin）
NPM_BIN_DIR="$(npm prefix -g 2>/dev/null)/bin"
if [ ! -d "$NPM_BIN_DIR" ]; then
    NPM_BIN_DIR="/usr/local/bin"
fi

for alias in "${ROLE_ALIASES[@]}"; do
    # 跳过与主命令同名的别名（wasteland 已在上面创建）
    if [ "$alias" = "wasteland" ]; then
        continue
    fi

    # 本地软链
    ln -sf "../wasteland.js" "$LOCAL_LINK_DIR/$alias"
    print_info "创建本地链接: $alias -> wasteland.js"

    # 复制到 npm bin 目录（使全局可用）
    if [ -d "$NPM_BIN_DIR" ] && [ -w "$NPM_BIN_DIR" ]; then
        ln -sf "$ENTRY_FILE" "$NPM_BIN_DIR/$alias"
        print_info "安装到 npm bin: $alias -> wasteland.js"
    else
        print_warn "无法写入 npm bin 目录 ($NPM_BIN_DIR)，跳过全局安装"
        print_warn "手动安装: sudo ln -s $ENTRY_FILE /usr/local/bin/$alias"
    fi
done

# 创建安装脚本（供无 sudo 权限时使用）
INSTALL_SCRIPT="$LOCAL_LINK_DIR/install.sh"
cat > "$INSTALL_SCRIPT" << 'INSTALL_EOF'
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
INSTALL_EOF
chmod +x "$INSTALL_SCRIPT"

# 显示结果
echo ""
print_info "符号链接创建完成！"
echo ""
echo "本地链接: $LOCAL_LINK_DIR"
echo ""
echo "可用命令:"
echo "  wasteland"
for alias in "${ROLE_ALIASES[@]}"; do
    echo "  $alias"
done
echo ""
echo "切换皮肤时，重新运行此脚本更新符号链接:"
echo "  ./scripts/create-aliases.sh <skin-id>"
