#!/bin/bash

# create-aliases.sh - 创建角色别名符号链接
#
# 用法: ./scripts/create-aliases.sh [skin-id]
#
# 根据皮肤配置中的角色别名，创建指向 wasteland.js 的符号链接
# 切换皮肤时运行此脚本，更新符号链接

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
SKIN_ID="${1:-immortan-joe}"

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

# 创建符号链接的目录
LINK_DIR="$PROJECT_DIR/bin/links"
mkdir -p "$LINK_DIR"

# 清除旧的符号链接
print_info "清除旧的符号链接..."
rm -f "$LINK_DIR"/*

# 创建主命令符号链接（wasteland）
MAIN_LINK="$LINK_DIR/wasteland"
ln -s "../wasteland.js" "$MAIN_LINK"
print_info "创建主命令链接: wasteland"

# 读取皮肤配置中的角色别名
# 通过 Node.js 脚本从皮肤配置动态读取
ROLE_ALIASES=()

# 获取角色别名的脚本
GET_ALIASES_SCRIPT="$SCRIPT_DIR/get-role-aliases.js"

if [ -f "$GET_ALIASES_SCRIPT" ] && command -v node &> /dev/null; then
    print_info "从皮肤配置读取角色别名..."

    # 调用 Node.js 脚本获取别名
    ALIASES_JSON=$(node "$GET_ALIASES_SCRIPT" "$SKIN_ID" 2>/dev/null || echo '["joe"]')

    # 解析 JSON 数组
    if command -v jq &> /dev/null; then
        # 使用 jq 解析
        mapfile -t ROLE_ALIASES < <(echo "$ALIASES_JSON" | jq -r '.[]')
    else
        # 手动解析简单的 JSON 数组 ["joe"]
        ROLE_ALIASES=($(echo "$ALIASES_JSON" | tr -d '[]",' | tr ' ' '\n'))
    fi
else
    print_warn "无法读取皮肤配置，使用默认角色别名"
    ROLE_ALIASES=("joe")
fi

print_info "角色别名: ${ROLE_ALIASES[*]}"

# 创建角色别名符号链接
for alias in "${ROLE_ALIASES[@]}"; do
    ALIAS_LINK="$LINK_DIR/$alias"
    ln -s "../wasteland.js" "$ALIAS_LINK"
    print_info "创建角色别名链接: $alias -> wasteland.js"
done

# 创建安装脚本
INSTALL_SCRIPT="$LINK_DIR/install.sh"
cat > "$INSTALL_SCRIPT" << 'EOF'
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
echo "  wasteland --help"
echo "  joe --help (兼容别名)"
EOF
chmod +x "$INSTALL_SCRIPT"

print_info "创建安装脚本: $INSTALL_SCRIPT"

# 显示结果
echo ""
print_info "符号链接创建完成！"
echo ""
echo "链接位置: $LINK_DIR"
echo ""
echo "使用方法:"
echo "  1. 直接使用: $LINK_DIR/wasteland --help"
echo "  2. 或安装到系统: sudo $LINK_DIR/install.sh"
echo ""
echo "可用命令:"
echo "  wasteland"
for alias in "${ROLE_ALIASES[@]}"; do
    echo "  $alias"
done
echo ""
echo "切换皮肤时，重新运行此脚本更新符号链接:"
echo "  ./scripts/create-aliases.sh <skin-id>"
