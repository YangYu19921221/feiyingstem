@echo off
chcp 65001 >nul
echo 🚀 英语学习助手 - 启动中...

REM 检查Python
python --version
if %errorlevel% neq 0 (
    echo ❌ Python未安装或未加入PATH
    pause
    exit /b
)

REM 检查虚拟环境
if not exist "venv\" (
    echo 📦 创建虚拟环境...
    python -m venv venv
)

REM 激活虚拟环境
echo 🔧 激活虚拟环境...
call venv\Scripts\activate.bat

REM 安装依赖
if not exist "venv\installed" (
    echo 📥 安装依赖包...
    pip install -r requirements.txt
    echo. > venv\installed
) else (
    echo ✅ 依赖已安装
)

REM 检查.env文件
if not exist ".env" (
    echo ⚠️  .env文件不存在,从模板复制...
    copy .env.example .env
    echo ⚠️  请编辑.env文件,填入你的API Key!
)

REM 启动服务
echo 🌟 启动FastAPI服务...
echo 📖 API文档: http://localhost:8000/docs
echo 🔍 健康检查: http://localhost:8000/health
echo.

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
