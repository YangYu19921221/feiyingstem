@echo off
chcp 65001 >nul
title 英语学习助手 - 启动服务

echo ========================================
echo     英语学习助手 - 服务启动程序
echo ========================================
echo.

:: 检查Python是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [信息] 检测到Python已安装
echo.

:: 进入后端目录
cd /d "%~dp0backend"

:: 检查虚拟环境是否存在
if not exist "venv" (
    echo [信息] 首次运行，正在创建虚拟环境...
    python -m venv venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败
        pause
        exit /b 1
    )
    echo [信息] 虚拟环境创建成功
)

:: 激活虚拟环境
call venv\Scripts\activate.bat

:: 检查依赖是否已安装
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo [信息] 正在安装依赖包，请稍候...
    pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        echo [错误] 安装依赖失败
        pause
        exit /b 1
    )
    echo [信息] 依赖安装完成
)

:: 检查.env文件
if not exist ".env" (
    echo [信息] 创建配置文件...
    copy .env.example .env >nul
    echo [提示] 如需使用AI功能，请编辑 backend\.env 文件配置API密钥
)

echo.
echo ========================================
echo     服务即将启动
echo ========================================
echo.
echo [提示] 后端API地址: http://localhost:8000
echo [提示] 前端页面地址: http://localhost:8000
echo [提示] API文档地址: http://localhost:8000/docs
echo.
echo [提示] 按 Ctrl+C 可停止服务
echo.

:: 启动服务
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

pause
