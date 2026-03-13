#!/bin/bash

# 英语学习助手 - 开发环境一键启动脚本

echo "🚀 英语学习助手 - 启动开发环境"
echo "================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python3 未安装,请先安装 Python 3.9+${NC}"
    exit 1
fi

# 检查Node.js (如果前端存在)
if [ -d "frontend" ] && ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装,请先安装 Node.js 18+${NC}"
    exit 1
fi

# 启动后端
echo -e "${BLUE}📦 启动后端服务...${NC}"
cd backend

# 检查虚拟环境
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}创建Python虚拟环境...${NC}"
    python3 -m venv venv
fi

# 激活虚拟环境
source venv/bin/activate

# 检查依赖
if [ ! -f "venv/installed" ]; then
    echo -e "${YELLOW}安装Python依赖...${NC}"
    pip install -r requirements.txt -q
    touch venv/installed
fi

# 检查.env文件
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env文件不存在,从模板复制...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}⚠️  请编辑 backend/.env 文件,配置必要的环境变量${NC}"
fi

# 后台启动后端
echo -e "${GREEN}✅ 后端启动中...${NC}"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > ../logs/backend.log 2>&1 &
BACKEND_PID=$!

cd ..

# 等待后端启动
sleep 3

# 检查后端是否启动成功
if curl -s http://localhost:8000/health > /dev/null; then
    echo -e "${GREEN}✅ 后端启动成功!${NC}"
    echo -e "   📖 API文档: ${BLUE}http://localhost:8000/docs${NC}"
    echo -e "   🔍 健康检查: ${BLUE}http://localhost:8000/health${NC}"
else
    echo -e "${RED}❌ 后端启动失败,请查看 logs/backend.log${NC}"
    exit 1
fi

# 启动前端 (如果存在)
if [ -d "frontend" ]; then
    echo ""
    echo -e "${BLUE}🎨 启动前端服务...${NC}"
    cd frontend

    # 检查依赖
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}安装前端依赖...${NC}"
        npm install
    fi

    # 后台启动前端
    npm run dev > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!

    cd ..

    sleep 3

    echo -e "${GREEN}✅ 前端启动成功!${NC}"
    echo -e "   🌐 访问地址: ${BLUE}http://localhost:5173${NC}"
else
    echo ""
    echo -e "${YELLOW}⚠️  前端项目未创建${NC}"
    echo -e "   运行以下命令创建前端项目:"
    echo -e "   ${BLUE}npm create vite@latest frontend -- --template react-ts${NC}"
fi

# 输出信息
echo ""
echo "================================"
echo -e "${GREEN}🎉 开发环境已启动!${NC}"
echo ""
echo "📝 日志文件:"
echo "   后端: logs/backend.log"
if [ -d "frontend" ]; then
    echo "   前端: logs/frontend.log"
fi
echo ""
echo "⏹️  停止服务:"
echo "   按 Ctrl+C 或运行: ./stop-dev.sh"
echo ""
echo "================================"

# 保存PID
mkdir -p logs
echo $BACKEND_PID > logs/backend.pid
if [ ! -z "$FRONTEND_PID" ]; then
    echo $FRONTEND_PID > logs/frontend.pid
fi

# 等待用户中断
echo ""
echo "按 Ctrl+C 停止所有服务..."
wait
