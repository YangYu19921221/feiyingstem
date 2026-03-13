#!/bin/bash

# 英语学习助手 - 后端启动脚本

echo "🚀 英语学习助手 - 启动中..."

# 检查Python版本
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "Python版本: $python_version"

# 检查虚拟环境
if [ ! -d "venv" ]; then
    echo "📦 创建虚拟环境..."
    python3 -m venv venv
fi

# 激活虚拟环境
echo "🔧 激活虚拟环境..."
source venv/bin/activate

# 安装依赖
if [ ! -f "venv/installed" ]; then
    echo "📥 安装依赖包..."
    pip install -r requirements.txt
    touch venv/installed
else
    echo "✅ 依赖已安装"
fi

# 检查.env文件
if [ ! -f ".env" ]; then
    echo "⚠️  .env文件不存在,从模板复制..."
    cp .env.example .env
    echo "⚠️  请编辑.env文件,填入你的API Key!"
fi

# 启动服务
echo "🌟 启动FastAPI服务..."
echo "📖 API文档: http://localhost:8000/docs"
echo "🔍 健康检查: http://localhost:8000/health"
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
