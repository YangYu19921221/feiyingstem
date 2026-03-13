#!/bin/bash

echo "========================================="
echo "🔧 WebSocket自动修复工具"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 步骤1: 检查后端状态
echo "📡 步骤1: 检查后端服务..."
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    echo -e "${GREEN}✅ 后端服务正常运行${NC}"
else
    echo -e "${RED}❌ 后端服务未运行!${NC}"
    echo "请先启动后端: cd backend && uvicorn app.main:app --reload"
    exit 1
fi
echo ""

# 步骤2: 生成有效token
echo "🔑 步骤2: 生成有效Token..."
cd /Users/apple/Desktop/英语助手/backend
source venv/bin/activate

TOKEN=$(python3 << 'EOF'
from jose import jwt
from datetime import datetime, timedelta, timezone

SECRET_KEY = "your-secret-key-change-in-production"
token_data = {
    "sub": "1",
    "username": "student",
    "exp": datetime.now(timezone.utc) + timedelta(days=7)
}
token = jwt.encode(token_data, SECRET_KEY, algorithm="HS256")
print(token)
EOF
)

echo -e "${GREEN}✅ Token已生成${NC}"
echo "Token: ${TOKEN:0:50}..."
echo ""

# 步骤3: 测试WebSocket连接
echo "🧪 步骤3: 测试WebSocket连接..."

# 创建临时测试脚本
cat > /tmp/test_ws.py << EOF
import asyncio
import websockets
import json
import sys

async def test():
    uri = f"ws://127.0.0.1:8000/api/v1/competition/ws/competition?token=$TOKEN&season_id=1"
    try:
        async with websockets.connect(uri) as ws:
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            data = json.loads(msg)
            if data.get('type') == 'connected':
                print("SUCCESS")
                return True
    except Exception as e:
        print(f"ERROR: {e}")
        return False

asyncio.run(test())
EOF

RESULT=$(python3 /tmp/test_ws.py 2>&1)

if echo "$RESULT" | grep -q "SUCCESS"; then
    echo -e "${GREEN}✅ WebSocket连接成功!${NC}"
    echo ""

    # 步骤4: 保存token到文件
    echo "💾 步骤4: 保存有效Token..."

    cat > /Users/apple/Desktop/英语助手/有效token.txt << TOKENFILE
========================================
有效的WebSocket Token
生成时间: $(date)
有效期: 7天
========================================

Token:
$TOKEN

========================================
使用方法:
========================================

在浏览器控制台(F12)执行:

localStorage.setItem('access_token', '$TOKEN');
location.reload();

========================================
WebSocket URL:
========================================

ws://localhost:8000/api/v1/competition/ws/competition?token=$TOKEN&season_id=1

========================================
TOKENFILE

    echo -e "${GREEN}✅ Token已保存到: /Users/apple/Desktop/英语助手/有效token.txt${NC}"
    echo ""

    # 步骤5: 打开说明文件
    echo "📖 步骤5: 显示使用说明..."
    echo ""
    echo "========================================="
    echo "🎯 下一步操作:"
    echo "========================================="
    echo ""
    echo "1. 打开前端竞赛页面:"
    echo "   ${YELLOW}http://localhost:5173/student/competition${NC}"
    echo ""
    echo "2. 按F12打开浏览器控制台"
    echo ""
    echo "3. 复制粘贴以下命令:"
    echo ""
    echo -e "${GREEN}localStorage.setItem('access_token', '$TOKEN');${NC}"
    echo -e "${GREEN}location.reload();${NC}"
    echo ""
    echo "========================================="
    echo ""
    echo "Token已保存到桌面文件: 有效token.txt"
    echo "可以随时查看!"
    echo ""

    # 打开文本文件
    open /Users/apple/Desktop/英语助手/有效token.txt

    echo -e "${GREEN}🎉 修复完成!${NC}"

else
    echo -e "${RED}❌ WebSocket测试失败${NC}"
    echo "错误信息: $RESULT"
    echo ""
    echo "请检查:"
    echo "1. 后端是否正常运行"
    echo "2. 数据库中是否有ID=1的student用户"
    exit 1
fi

# 清理临时文件
rm -f /tmp/test_ws.py
