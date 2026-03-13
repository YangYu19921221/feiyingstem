#!/bin/bash

# 停止开发服务

echo "⏹️  停止开发服务..."

# 停止后端
if [ -f "logs/backend.pid" ]; then
    PID=$(cat logs/backend.pid)
    if ps -p $PID > /dev/null; then
        kill $PID
        echo "✅ 后端服务已停止 (PID: $PID)"
    fi
    rm logs/backend.pid
fi

# 停止前端
if [ -f "logs/frontend.pid" ]; then
    PID=$(cat logs/frontend.pid)
    if ps -p $PID > /dev/null; then
        kill $PID
        echo "✅ 前端服务已停止 (PID: $PID)"
    fi
    rm logs/frontend.pid
fi

# 清理端口占用
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "✅ 清理端口 8000"
lsof -ti:5173 | xargs kill -9 2>/dev/null && echo "✅ 清理端口 5173"

echo "🎉 所有服务已停止"
